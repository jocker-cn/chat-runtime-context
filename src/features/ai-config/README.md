# AI definitions / Skill packages

本模块实现正式 Agent、Skill、MCP 的领域合约与第一阶段 Skill 管理。没有 BE 调用、真实 MCP 连接或脚本执行。

## 分层

- `domain/`：版本化 JSON 可序列化 POJO、错误、AJV 结构与语义校验。
- `adapters/`：Agent Skills 标准主文件 YAML/Markdown 解析、文件清单/摘要、ZIP 导入导出。正文不复制成另一套配置字段。
- `data/`：异步 Repository；IndexedDB 本地实现与用于测试的内存实现。通用建库/升级、CRUD 和事务使用 `src/core/indexedDB`，这里只保留业务表结构与领域校验。
- `controllers/`：保存/发布/停用/归档、固定版本依赖检查、Skill 目录订阅和纯编辑 ViewModel。
- `ui/`：Skill 文件树、表单/源码编辑、附件选择、校验结果及版本查看。样式引用统一 `src/theme/tokens.css`。

## 接入

```ts
const workspace = new SkillWorkspace(createIndexedDbAiRepository());
await workspace.start();

// 轻量目录，不包含包正文；稳定 snapshot 可交给 useSyncExternalStore。
const summaries = workspace.getSnapshot().published;

// 选择后按固定版本读取主文件，预览不偷偷切换到最新版。
const instructions = await workspace.publishedSource({
  id: summaries[0].id,
  revision: summaries[0].revision,
});
```

UI 通过 `SkillLibrary workspace={workspace}` 使用领域逻辑；更换 BE Repository 不需要重写 Skill 编辑器。

## 管理页面布局

四类管理页面复用纯展示组件 `ui/DefinitionManager.tsx`：可搜索的目录、独立滚动的编辑区，以及始终可见的操作栏。组件不处理 Repository、发布、连接或工具调用。

- Skill 默认进入内容编辑：基本信息、文件树、主文件表单/源码、校验结果。可选元数据默认折叠。
- 文件包根目录、历史发布版本、启用/停用及归档集中在“版本与设置”；切换区域不会丢弃编辑内容。
- POC Agent/MCP/Plugin 使用同一布局：基本信息与功能配置分组，Agent 单独展示 Prompt 和关联能力。
- 页面不再显示重复的大标题、技术说明横幅或“返回聊天”；通过工作台左侧聊天历史切回对话。
- 搜索不替换当前编辑内容；Skill 及 POC 配置在切换编辑对象前检查未保存修改。存储协议及 BE 行为不变。

通用管理样式集中在 `DefinitionManager.module.css`，功能样式只负责内部布局，两者都引用现有 tokens。窄屏下目录移到编辑区上方并限制列表高度，长列表与编辑区分别滚动。

## 存储与版本

IndexedDB namespace 为 `chat-runtime.ai-config.v1`。第一阶段只有两个物理 object store：

- `definitions`：元数据、可变草稿、不可变发布版本、可变启用状态。按 scope + kind + slug 建唯一索引，整个记录事务写入。
- `blobs`：内容寻址的文件字节；配置中只存 path、mediaType、sizeBytes、sha256、blobId。

草稿与版本在领域上独立，当前合并存于一条记录便于原子提交；不是将所有文件拼入一个 localStorage JSON。后续 BE 可将目录/草稿/版本拆为分页资源接口。本地 `list()` 返回仅元数据，但实现仍读取本地定义记录；大规模目录分页优化尚未实现。

每次写入检查 ETag；发布 revision 连续递增，旧发布内容不可修改或移除。归档只隐藏目录并停用，不删除历史与文件。浏览器本地数据可被清理，并非跨设备真源。

保存成功只在 Repository commit 成功后提示；不静默回退内存保存。MCP 配置只保存公开连接/认证声明，不保存秘密。Agent 引用必须指向已发布且可用的能力，真正权限/模型 profile 校验仍需 BE。

## 文件包边界

符合 [Agent Skills specification](https://agentskills.io/specification) 的 `SKILL.md` 为内容真源，表单更新同一文件，保留 YAML 注释和非表单字段。未知顶层字段保留原文但阻止发布，当前不假定未知执行语义；扩展元数据使用标准 `metadata`。

支持：

- 创建、编辑、删除配套文件（主文件不可删除），references/assets/scripts 均可保存。
- 标准 frontmatter、机器名/根目录对应、表单/源码切换、错误与行号。
- UTF-8 Markdown 或单根 ZIP 导入；完整 ZIP 导出，包括原始二进制字节。
- ZIP 中央目录预检查、路径遍历/大小写冲突/文件目录冲突、符号链接/加密/不支持压缩方式拒绝。
- 限制 200 文件、单文件 2 MiB、解压总计 20 MiB、压缩包 12 MiB；流式解压检查实际字节，避免只信任声明大小。
- 文件 SHA-256 完整性检查、脚本保存提示；不执行代码、不渲染附件 HTML/SVG。
- 保存可修复的无效主文件草稿；发布时重新校验完整包。

ZIP 中只接受文件；空目录不作为独立领域对象保存，Unix 执行权限也不进入配置。平台压缩包安全策略比原始标准文件格式更严格；不声称接受所有 ZIP 扩展。

## 当前迁移边界

新 Skill `/` 条目只来自已发布版本。新建/未发布草稿不参与调用目录；引用节点和 UI invocation 带固定 revision，正文按需读取。现有 POC Agent 可选择新发布 Skill 的稳定 ID，但仍是旧的组合表单，不是正式 Agent 配置/执行协议。

旧 POC 自定义 Skill 提供显式导入为新草稿的入口，不自动发布、不删除旧 localStorage。内置发布检查示例是新包；这不是全量旧数据迁移。迁移报告、ID 保留/重复导入映射、版本差异比较、依赖影响分析、跨 tab 刷新订阅尚未实现。

Agent/MCP 正式 schema 已可调用校验器，正式配置 UI、模型/策略数据源、MCP 授权/发现、BE Resolver 按后续计划实施。UI invocation 目前仍未发送给 BE 执行。
