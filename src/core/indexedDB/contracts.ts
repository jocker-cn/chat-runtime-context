export interface IndexedDBStoreSchema {
  key: IDBValidKey;
  value: unknown;
  indexes?: Record<string, IDBValidKey>;
}

export type IndexedDBSchema = Record<string, IndexedDBStoreSchema>;
export type IndexedDBStoreName<Schema extends IndexedDBSchema> = keyof Schema & string;
export type IndexedDBQuery<Key extends IDBValidKey> = Key | IDBKeyRange;

export interface IndexedDBReader<Key extends IDBValidKey, Value> {
  get(query: IndexedDBQuery<Key>): Promise<Value | undefined>;
  getAll(query?: IndexedDBQuery<Key> | null, count?: number): Promise<Value[]>;
  count(query?: IndexedDBQuery<Key>): Promise<number>;
}

export interface IndexedDBStore<Store extends IndexedDBStoreSchema>
  extends IndexedDBReader<Store["key"], Store["value"]> {
  add(value: Store["value"], key?: Store["key"]): Promise<Store["key"]>;
  put(value: Store["value"], key?: Store["key"]): Promise<Store["key"]>;
  delete(query: IndexedDBQuery<Store["key"]>): Promise<void>;
  clear(): Promise<void>;
  index<Name extends keyof NonNullable<Store["indexes"]> & string>(name: Name):
    IndexedDBReader<NonNullable<Store["indexes"]>[Name], Store["value"]>;
}

export interface IndexedDBTransaction<Schema extends IndexedDBSchema> {
  store<Name extends IndexedDBStoreName<Schema>>(name: Name): IndexedDBStore<Schema[Name]>;
}

export interface IndexedDBUpgradeContext {
  database: IDBDatabase;
  transaction: IDBTransaction;
  oldVersion: number;
  newVersion: number | null;
}

export interface IndexedDBOptions {
  name: string;
  version: number;
  /** Declare object stores, indexes and version migrations synchronously. */
  upgrade?(context: IndexedDBUpgradeContext): void;
  /** Optional injection for tests or a non-default IndexedDB environment. */
  factory?: IDBFactory;
}

export interface IndexedDBDatabase<Schema extends IndexedDBSchema> {
  /** Open lazily; concurrent calls on this instance share the same connection. */
  open(): Promise<void>;
  get<Name extends IndexedDBStoreName<Schema>>(store: Name, query: IndexedDBQuery<Schema[Name]["key"]>): Promise<Schema[Name]["value"] | undefined>;
  getAll<Name extends IndexedDBStoreName<Schema>>(store: Name, query?: IndexedDBQuery<Schema[Name]["key"]> | null, count?: number): Promise<Schema[Name]["value"][]>;
  count<Name extends IndexedDBStoreName<Schema>>(store: Name, query?: IndexedDBQuery<Schema[Name]["key"]>): Promise<number>;
  add<Name extends IndexedDBStoreName<Schema>>(store: Name, value: Schema[Name]["value"], key?: Schema[Name]["key"]): Promise<Schema[Name]["key"]>;
  put<Name extends IndexedDBStoreName<Schema>>(store: Name, value: Schema[Name]["value"], key?: Schema[Name]["key"]): Promise<Schema[Name]["key"]>;
  delete<Name extends IndexedDBStoreName<Schema>>(store: Name, query: IndexedDBQuery<Schema[Name]["key"]>): Promise<void>;
  clear<Name extends IndexedDBStoreName<Schema>>(store: Name): Promise<void>;
  /** Only await requests from this transaction. Do external async work before it. */
  transaction<Name extends IndexedDBStoreName<Schema>, Result>(
    stores: readonly Name[],
    mode: "readonly" | "readwrite",
    work: (transaction: IndexedDBTransaction<Pick<Schema, Name>>) => Result | Promise<Result>,
  ): Promise<Result>;
  /** Close the connection/cancel pending opening. A later operation can reopen. */
  close(): void;
}

export type IndexedDBErrorCode = "unavailable" | "open" | "upgrade" | "blocked" | "closed" | "request" | "transaction";

export class IndexedDBError extends Error {
  constructor(
    public readonly code: IndexedDBErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "IndexedDBError";
  }
}
