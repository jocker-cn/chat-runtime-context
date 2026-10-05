import {
  IndexedDBError,
  type IndexedDBDatabase,
  type IndexedDBOptions,
  type IndexedDBReader,
  type IndexedDBSchema,
  type IndexedDBStore,
  type IndexedDBStoreSchema,
} from "./contracts";

function requestResult<Result>(operation: () => IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    try {
      const request = operation();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new IndexedDBError("request", "IndexedDB 请求失败。", request.error));
    } catch (cause) {
      reject(new IndexedDBError("request", "IndexedDB 请求无法执行。", cause));
    }
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new IndexedDBError("transaction", "IndexedDB 事务已中止。", transaction.error));
  });
}

function reader<Key extends IDBValidKey, Value>(source: IDBObjectStore | IDBIndex): IndexedDBReader<Key, Value> {
  return {
    get: (query) => requestResult(() => source.get(query)),
    getAll: (query, count) => requestResult(() => source.getAll(query, count)),
    count: (query) => requestResult(() => source.count(query)),
  };
}

function store<Schema extends IndexedDBStoreSchema>(source: IDBObjectStore): IndexedDBStore<Schema> {
  return {
    ...reader<Schema["key"], Schema["value"]>(source),
    add: (value, key) => requestResult(() => source.add(value, key)) as Promise<Schema["key"]>,
    put: (value, key) => requestResult(() => source.put(value, key)) as Promise<Schema["key"]>,
    delete: (query) => requestResult(() => source.delete(query)),
    clear: () => requestResult(() => source.clear()),
    index: (name) => reader(source.index(name)),
  };
}

interface PendingOpen {
  promise: Promise<IDBDatabase>;
  cancel(): void;
}

export function createIndexedDB<Schema extends IndexedDBSchema>(options: IndexedDBOptions): IndexedDBDatabase<Schema> {
  const { name, version, upgrade, factory } = options;
  let connection: IDBDatabase | undefined;
  let opening: PendingOpen | undefined;

  function release(database: IDBDatabase) {
    if (connection === database) connection = undefined;
    database.close();
  }

  function open(): Promise<IDBDatabase> {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening.promise;

    const api = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!api) return Promise.reject(new IndexedDBError("unavailable", "当前环境不支持 IndexedDB。"));

    let resolve!: (database: IDBDatabase) => void;
    let reject!: (error: IndexedDBError) => void;
    const promise = new Promise<IDBDatabase>((accept, decline) => { resolve = accept; reject = decline; });
    let active = true;
    const pending: PendingOpen = {
      promise,
      cancel: () => fail(new IndexedDBError("closed", "IndexedDB 打开操作已关闭。")),
    };
    opening = pending;

    function fail(error: IndexedDBError) {
      if (!active) return;
      active = false;
      if (opening === pending) opening = undefined;
      reject(error);
    }

    try {
      const request = api.open(name, version);
      request.onupgradeneeded = (event) => {
        const transaction = request.transaction!;
        // A blocked/cancelled request can still resume. Do not run its migration.
        if (!active) { transaction.abort(); return; }
        try {
          const result: unknown = upgrade?.({ database: request.result, transaction, oldVersion: event.oldVersion, newVersion: event.newVersion });
          // TypeScript allows async functions where void is expected; reject them.
          if (result && typeof (result as PromiseLike<unknown>).then === "function") {
            void Promise.resolve(result).catch(() => {});
            throw new Error("数据库升级回调必须同步执行。");
          }
        } catch (cause) {
          fail(new IndexedDBError("upgrade", "IndexedDB 升级失败。", cause));
          transaction.abort();
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (!active) { database.close(); return; }
        active = false;
        if (opening === pending) opening = undefined;
        connection = database;
        database.onversionchange = () => release(database);
        database.onclose = () => release(database);
        resolve(database);
      };
      request.onerror = () => fail(new IndexedDBError("open", "IndexedDB 打开失败。", request.error));
      request.onblocked = () => fail(new IndexedDBError("blocked", "数据库升级被其他页面的连接阻止，请关闭旧页面后重试。"));
    } catch (cause) {
      fail(new IndexedDBError("open", "IndexedDB 无法打开。", cause));
    }
    return promise;
  }

  const transaction: IndexedDBDatabase<Schema>["transaction"] = async (names, mode, work) => {
    const database = await open();
    let native: IDBTransaction;
    try {
      native = database.transaction([...names], mode);
    } catch (cause) {
      throw new IndexedDBError("transaction", "IndexedDB 事务无法创建。", cause);
    }
    const completed = transactionCompletion(native);
    // Observe aborts immediately, even while work is still awaiting a request.
    void completed.catch(() => {});
    try {
      const result = await work({ store: (name) => store(native.objectStore(name)) });
      // A successful request is not necessarily a committed transaction.
      await completed;
      return result;
    } catch (error) {
      try { native.abort(); } catch { /* Already aborted/completed. */ }
      await completed.catch(() => {});
      // Preserve errors thrown by business validation, including their identity.
      throw error;
    }
  };

  return {
    open: async () => { await open(); },
    get: (name, query) => transaction([name], "readonly", (tx) => tx.store(name).get(query)),
    getAll: (name, query, count) => transaction([name], "readonly", (tx) => tx.store(name).getAll(query, count)),
    count: (name, query) => transaction([name], "readonly", (tx) => tx.store(name).count(query)),
    add: (name, value, key) => transaction([name], "readwrite", (tx) => tx.store(name).add(value, key)),
    put: (name, value, key) => transaction([name], "readwrite", (tx) => tx.store(name).put(value, key)),
    delete: (name, query) => transaction([name], "readwrite", (tx) => tx.store(name).delete(query)),
    clear: (name) => transaction([name], "readwrite", (tx) => tx.store(name).clear()),
    transaction,
    close() {
      opening?.cancel();
      if (connection) release(connection);
    },
  };
}
