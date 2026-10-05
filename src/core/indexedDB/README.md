# IndexedDB

通用浏览器本地存储层，不依赖 React 或 AI 配置领域，也不保存业务校验规则。没有新增运行时依赖。

- `contracts.ts`：表的 key/value/index 类型、操作接口及通用错误。
- `createIndexedDB.ts`：延迟建库、版本升级、连接管理、Promise 化读写及事务提交/回滚。
- `index.ts`：统一出口，也由 `src/core/index.ts` 导出。

## 普通模块接入

```ts
import { createIndexedDB } from "@/core/indexedDB"; // 按宿主自己的路径配置引入

type Settings = { id: string; theme: string; group: string };
type Stores = {
  settings: { key: string; value: Settings; indexes: { group: string } };
  attachments: { key: string; value: Uint8Array };
};

const database = createIndexedDB<Stores>({
  name: "my-module",
  version: 1,
  upgrade({ database, oldVersion }) {
    if (oldVersion < 1) {
      const settings = database.createObjectStore("settings", { keyPath: "id" });
      settings.createIndex("group", "group");
      database.createObjectStore("attachments");
    }
    // 升到 v2 时再加 if (oldVersion < 2) { ... }，不重建已有表。
  },
});

await database.put("settings", { id: "main", theme: "light", group: "user" });
const settings = await database.get("settings", "main"); // Settings | undefined
const all = await database.getAll("settings");
await database.put("attachments", new Uint8Array([1, 2]), "file-id");
await database.delete("attachments", "file-id");

const matches = await database.transaction(["settings"], "readonly", (tx) =>
  tx.store("settings").index("group").getAll("user"),
);

database.close(); // 释放当前连接；后续操作仍可按需重开
```

`get/getAll/count/add/put/delete/clear` 是单表便利操作，每次调用都有独立事务。查询可传 `IDBKeyRange`，`getAll` 可限制数量。内联 keyPath 表不传额外 key；外置键表由调用者传 key。表和索引的真实结构由同步 `upgrade` 定义，泛型负责调用侧的类型提示，**不会代替运行时数据/schema 校验**。

## 多表原子操作

```ts
// fetch、文件读取、摘要计算等先完成，再进入事务。
const bytes = await loadFile();
await database.transaction(["settings", "attachments"], "readwrite", async (tx) => {
  const previous = await tx.store("settings").get("main");
  checkBusinessRules(previous); // 抛错会回滚；原业务错误原样传给调用者。
  await tx.store("settings").put({ id: "main", theme: "dark", group: "user" });
  await tx.store("attachments").put(bytes, "file-id");
});
// 此处才表示整个事务已成功提交，而不是某条 put 请求刚成功。
```

事务回调只等待 `tx.store(...)` 返回的请求，不要等待网络、计时器、WebCrypto 或其他外部异步任务，也不要把 tx/store 保存到回调外继续使用。IndexedDB 可能在没有待处理请求时自动提交，封装不做 keep-alive，也不能保证在已经提交后回滚外部任务的错误。该边界来自 [IndexedDB 事务生命周期规范](https://w3c.github.io/IndexedDB/#transaction-lifecycle)。

请求错误不被静默吞掉。即使业务 catch 某条请求错误导致回调继续，事务 abort 仍然让整个操作失败。readonly 回调里写入会按原生规则拒绝。

## 连接与错误

- 同一实例并发打开共用连接；不同模块自行决定数据库名称和表结构，不用全局单例。
- `versionchange` 自动释放旧连接；`close()` 会取消仍在打开的请求，并关闭晚到的连接，不清空数据。
- 升级被其他页面阻塞时返回 `IndexedDBError`（`code: "blocked"`）；晚到的升级不会继续执行。关闭旧页面后可重试。
- 其他错误代码：`unavailable/open/upgrade/closed/request/transaction`。原生错误保留在 `cause`，如 `QuotaExceededError`、`ConstraintError`。业务层自行映射为用户提示。
- 不静默回退内存、不自动删库、不自动重试写入。版本升级由使用模块显式定义，必须同步执行。
- 可注入 `factory` 以使用 `fake-indexeddb` 等测试环境。

AI 配置模块已使用此封装，仍在其 Repository 内维护 `definitions/blobs` schema、领域格式检查、ETag、唯一标识和不可变发布版本。数据库名与 v1 物理结构未变，无须迁移现有数据。
