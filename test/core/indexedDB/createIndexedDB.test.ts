import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createIndexedDB, IndexedDBError, type IndexedDBOptions } from "../../../src/core/indexedDB";

type Item = { id: string; name: string; group: string };
type Stores = {
  items: { key: string; value: Item; indexes: { group: string; name: string } };
  files: { key: string; value: Uint8Array };
};
const item = (id: string, group = "default"): Item => ({ id, name: `name-${id}`, group });

function createDatabase(options: Partial<IndexedDBOptions> = {}) {
  return createIndexedDB<Stores>({
    name: "test",
    version: 1,
    factory: new FakeIDBFactory(),
    upgrade({ database, oldVersion }) {
      if (oldVersion < 1) {
        const items = database.createObjectStore("items", { keyPath: "id" });
        items.createIndex("group", "group");
        items.createIndex("name", "name", { unique: true });
        database.createObjectStore("files");
      }
    },
    ...options,
  });
}

function nativeResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("IndexedDB shared operations", () => {
  it("supports typed inline/out-of-line keys, CRUD, ranges and structured-clone isolation", async () => {
    const database = createDatabase();
    expect(await database.get("items", "missing")).toBeUndefined();
    expect(await database.add("items", item("a"))).toBe("a");
    await database.put("items", item("b"));
    await database.put("items", { ...item("a"), group: "changed" });
    expect(await database.count("items")).toBe(2);
    expect(await database.getAll("items", FakeIDBKeyRange.lowerBound("b"), 1)).toEqual([item("b")]);
    expect(await database.count("items", "a")).toBe(1);
    const stored = (await database.get("items", "a"))!;
    stored.group = "not-persisted";
    expect((await database.get("items", "a"))?.group).toBe("changed");
    const bytes = new Uint8Array([1, 2, 3]);
    await database.put("files", bytes, "blob"); bytes[0] = 9;
    expect(await database.get("files", "blob")).toEqual(new Uint8Array([1, 2, 3]));
    await database.delete("items", FakeIDBKeyRange.upperBound("a"));
    expect(await database.getAll("items")).toEqual([item("b")]);
    await database.clear("items");
    expect(await database.count("items")).toBe(0);
    database.close();
  });

  it("provides typed secondary index queries within a transaction", async () => {
    const database = createDatabase();
    await database.add("items", item("a", "one"));
    await database.add("items", item("b", "one"));
    await database.add("items", item("c", "two"));
    const result = await database.transaction(["items"], "readonly", async (tx) => {
      const group = tx.store("items").index("group");
      return { first: await group.get("one"), all: await group.getAll("one", 1), count: await group.count("one") };
    });
    expect(result).toEqual({ first: item("a", "one"), all: [item("a", "one")], count: 2 });
    expectTypeOf(database.get<"items">).returns.toEqualTypeOf<Promise<Item | undefined>>();
    if (false) {
      // @ts-expect-error Unknown object stores cannot be accessed.
      database.get("unknown", "a");
      // @ts-expect-error Object-store value types are enforced.
      database.put("items", new Uint8Array());
      database.transaction(["items"], "readonly", (tx) => {
        // @ts-expect-error Only declared transaction stores are available.
        tx.store("files");
        // @ts-expect-error Unknown indexes cannot be accessed.
        tx.store("items").index("unknown");
      });
    }
    database.close();
  });

  it("commits all stores before resolving and returns the callback result", async () => {
    const factory = new FakeIDBFactory();
    const a = createDatabase({ factory }); const b = createDatabase({ factory });
    const result = await a.transaction(["items", "files"], "readwrite", async (tx) => {
      await tx.store("items").put(item("a"));
      await tx.store("files").put(new Uint8Array([7]), "a");
      return "saved";
    });
    expect(result).toBe("saved");
    expect(await b.get("items", "a")).toEqual(item("a"));
    expect(await b.get("files", "a")).toEqual(new Uint8Array([7]));
    a.close(); b.close();
  });

  it("rolls back all writes and preserves a business validation error", async () => {
    const database = createDatabase(); const conflict = new Error("ETag conflict");
    await expect(database.transaction(["items", "files"], "readwrite", async (tx) => {
      await tx.store("items").put(item("a"));
      await tx.store("files").put(new Uint8Array([1]), "a");
      throw conflict;
    })).rejects.toBe(conflict);
    expect(await database.count("items")).toBe(0);
    expect(await database.count("files")).toBe(0);
    database.close();
  });

  it("rolls back earlier writes when a later unique-index request fails", async () => {
    const database = createDatabase();
    await expect(database.transaction(["items", "files"], "readwrite", async (tx) => {
      await tx.store("files").put(new Uint8Array([1]), "blob");
      await tx.store("items").add(item("a"));
      await tx.store("items").add({ ...item("b"), name: item("a").name });
    })).rejects.toMatchObject({ code: "request", cause: { name: "ConstraintError" } });
    expect(await database.count("items")).toBe(0);
    expect(await database.count("files")).toBe(0);
    database.close();
  });

  it("does not report success if a caught request error aborts the transaction", async () => {
    const database = createDatabase();
    await database.put("items", item("a"));
    await expect(database.transaction(["items"], "readwrite", async (tx) => {
      await tx.store("items").add(item("a")).catch(() => {});
      return "not-saved";
    })).rejects.toMatchObject({ code: "transaction", cause: { name: "ConstraintError" } });
    expect(await database.count("items")).toBe(1);
    database.close();
  });

  it("rejects non-cloneable data, readonly writes and invalid transaction scopes", async () => {
    const database = createDatabase();
    await expect(database.put("items", { ...item("a"), name: (() => {}) as unknown as string })).rejects.toMatchObject({ code: "request", cause: { name: "DataCloneError" } });
    await expect(database.transaction(["items"], "readonly", (tx) => tx.store("items").put(item("a")))).rejects.toMatchObject({ code: "request", cause: { name: "ReadOnlyError" } });
    await expect(database.transaction([], "readonly", () => {})).rejects.toMatchObject({ code: "transaction" });
    expect(await database.count("items")).toBe(0);
    database.close();
  });
});

describe("IndexedDB connection lifecycle and migrations", () => {
  it("opens lazily once for concurrent operations and reopens after close", async () => {
    const factory = new FakeIDBFactory(); const open = vi.spyOn(factory, "open");
    const database = createDatabase({ factory });
    expect(open).not.toHaveBeenCalled();
    await Promise.all([database.open(), database.count("items"), database.getAll("files")]);
    expect(open).toHaveBeenCalledTimes(1);
    await database.put("items", item("a"));
    database.close();
    expect(await database.get("items", "a")).toEqual(item("a"));
    expect(open).toHaveBeenCalledTimes(2);
    database.close();
  });

  it("closes on versionchange so another module can upgrade while preserving records", async () => {
    const factory = new FakeIDBFactory(); const first = createDatabase({ factory });
    await first.put("items", item("a"));
    const upgrade = vi.fn(({ database, oldVersion, newVersion }: Parameters<NonNullable<IndexedDBOptions["upgrade"]>>[0]) => {
      expect(oldVersion).toBe(1); expect(newVersion).toBe(2);
      database.createObjectStore("new-store");
    });
    const next = createDatabase({ factory, version: 2, upgrade });
    await next.open();
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(await next.get("items", "a")).toEqual(item("a"));
    // The old wrapper does not reuse its now-closed v1 connection.
    await expect(first.open()).rejects.toMatchObject({ code: "open", cause: { name: "VersionError" } });
    first.close(); next.close();
  });

  it("retries after missing IndexedDB or a synchronous opening failure", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const database = createDatabase({ factory: undefined });
    await expect(database.open()).rejects.toMatchObject({ code: "unavailable" });
    const factory = new FakeIDBFactory(); vi.stubGlobal("indexedDB", factory);
    const open = vi.spyOn(factory, "open").mockImplementationOnce(() => { throw new Error("permission denied"); });
    await expect(database.open()).rejects.toMatchObject({ code: "open", cause: { message: "permission denied" } });
    await database.open();
    expect(open).toHaveBeenCalledTimes(2);
    database.close();
  });

  it("rolls back failed migrations and permits a fresh opening attempt", async () => {
    const factory = new FakeIDBFactory(); let fail = true;
    const database = createDatabase({ factory, upgrade({ database, oldVersion }) {
      expect(oldVersion).toBe(0);
      database.createObjectStore("items", { keyPath: "id" });
      if (fail) { fail = false; throw new Error("migration failed"); }
      database.createObjectStore("files");
    } });
    await expect(database.open()).rejects.toMatchObject({ code: "upgrade", cause: { message: "migration failed" } });
    await database.put("items", item("a"));
    expect(await database.get("items", "a")).toEqual(item("a"));
    database.close();
  });

  it("rejects async upgrade callbacks without an unhandled rejection", async () => {
    const database = createDatabase({ upgrade: async () => { throw new Error("must-not-await"); } });
    await expect(database.open()).rejects.toBeInstanceOf(IndexedDBError);
    database.close();
  });

  it("rejects a blocked upgrade, cancels its late migration and releases any connection", async () => {
    const factory = new FakeIDBFactory();
    const blocker = await nativeResult(factory.open("test", 1));
    const upgrade = vi.fn(({ database }: Parameters<NonNullable<IndexedDBOptions["upgrade"]>>[0]) => { database.createObjectStore("items", { keyPath: "id" }); });
    const database = createDatabase({ factory, version: 2, upgrade });
    await expect(database.open()).rejects.toMatchObject({ code: "blocked" });
    expect(upgrade).not.toHaveBeenCalled();
    blocker.close();
    // Queued after the blocked request: proves no late connection blocks it.
    const retry = factory.open("test", 2);
    retry.onupgradeneeded = () => { retry.result.createObjectStore("items", { keyPath: "id" }); };
    const recovered = await nativeResult(retry);
    expect(upgrade).not.toHaveBeenCalled();
    recovered.close();
    expect(await database.getAll("items")).toEqual([]);
    database.close();
  });

  it("cancels pending opening on close without leaking a late connection", async () => {
    const factory = new FakeIDBFactory(); const database = createDatabase({ factory });
    const opening = database.open();
    database.close();
    await expect(opening).rejects.toMatchObject({ code: "closed" });
    await database.put("items", item("a"));
    expect(await database.get("items", "a")).toEqual(item("a"));
    database.close();
    await nativeResult(factory.deleteDatabase("test"));
  });
});
