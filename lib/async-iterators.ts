import { instanceOfAny, Func } from './util';
import { addTraps } from './wrap-idb-value';
import { IDBPObjectStore, IDBPIndex, IDBPCursor } from '.';

const advanceMethodProps = ['continue', 'continuePrimaryKey', 'advance'];
const methodMap: { [s: string]: Func } = {};
const advanceResults = new WeakMap<IDBPCursor, Promise<IDBPCursor | null>>();
const proxiedCursorToOriginal = new WeakMap<IDBPCursor, IDBPCursor>();

const cursorIteratorTraps: ProxyHandler<any> = {
  get(target, prop) {
    if (!advanceMethodProps.includes(prop as string)) return target[prop];

    let cachedFunc = methodMap[prop as string];

    if (!cachedFunc) {
      cachedFunc = methodMap[prop as string] = function (this: IDBPCursor, ...args: any) {
        advanceResults.set(
          this,
          (proxiedCursorToOriginal.get(this) as any)[prop](...args),
        );
      };
    }

    return cachedFunc;
  },
};

async function* iterate(this: IDBPObjectStore | IDBPIndex | IDBPCursor):
  AsyncIterableIterator<any> {
  // tslint:disable-next-line:no-this-assignment
  let cursor: typeof this | null = this;

  if (!(cursor instanceof IDBCursor)) {
    cursor = await (cursor as IDBPObjectStore | IDBPIndex).openCursor();
  }

  cursor = cursor as IDBPCursor;
  const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
  proxiedCursorToOriginal.set(proxiedCursor, cursor);

  while (cursor) {
    yield proxiedCursor;
    // If one of the advancing methods was not called, call continue().
    cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
    advanceResults.delete(proxiedCursor);
  }
}

function isIteratorProp(target: any, prop: number | string | symbol) {
  return prop === Symbol.asyncIterator &&
    instanceOfAny(target, [IDBCursor, IDBObjectStore, IDBIndex]);
}

addTraps(oldTraps => ({
  get(target, prop, receiver) {
    if (isIteratorProp(target, prop)) return iterate;
    return oldTraps.get!(target, prop, receiver);
  },
  has(target, prop) {
    return isIteratorProp(target, prop) || oldTraps.has!(target, prop);
  },
}));
