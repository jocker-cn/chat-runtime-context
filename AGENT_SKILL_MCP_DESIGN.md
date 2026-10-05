# Agent、Skill、MCP 正式配置与持久化设计

> 日期：2026-10-02。状态：设计提案，尚未迁移现有 POC 或接入 BE。
>
> 承接 `CHAT_TURN_NAVIGATION_DESIGN.md` 第 19、20 节。本文件定义领域数据、标准映射、存储和执行边界；不改变 Chat Runtime 的 Turn/Branch，不把业务配置写进 `core/tools` 的展示注册表。

## 1. 结论与规范边界

推荐采用 **Agent 配置文档 + 标准 Skill 文件包 + MCP 连接定义**。三者统一管理 ID、权限、草稿和版本，但不统一成一份万能 `prompt`。

| 对象 | 实际含义 | 内容依据 | 本项目的正式保存形态 |
| --- | --- | --- | --- |
| Agent | 用什么模型、按什么指令、可使用哪些能力 | 产品/框架配置，不将某一家格式视为通用标准 | 平台版本化 JSON 配置，引用 Skill 与 MCP |
| Skill | 可复用的工作方法和配套文件 | Agent Skills 的 `SKILL.md` 包格式 | 完整文件包 + 解析索引 + 平台元数据 |
| MCP | 连接一个提供 tools/resources/prompts 的服务 | MCP 通信协议 | 连接定义 + 用户授权绑定 + 发现结果缓存 |

Skill 的目录及主文件格式有明确的开放规范：[Agent Skills specification](https://agentskills.io/specification)。Agent 配置应保持产品适配边界，例如 Claude Code 使用自己的 Markdown/frontmatter 与模型、工具等字段；A2A 的 AgentCard 描述对外服务与能力，并不取代内部 Prompt/执行配置。A2A 的 `AgentSkill` 也不是 `SKILL.md` 文件包。[Claude subagents](https://code.claude.com/docs/en/sub-agents)、[A2A specification](https://a2a-protocol.org/latest/specification/)

MCP 规定协议和能力交互；我们的连接 ID、标签、启停、版本和数据库模型是平台定义，不是 MCP 标准字段。查询时官方 Current 为 `2026-07-28`；具体执行支持哪些版本取决于将来的 BE SDK，不在前端写死“所有 MCP 都必须同一种握手”。[MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)

以下 JSON/TypeScript、数据库表名、API、权限策略均为 **本项目建议的应用协议**，不是声称存在一份统一的“AI 标准 JSON”。

## 2. 当前实现需要替换什么

目前 `extensionModel.ts` 的 Agent 是 `prompt + skillIds/mcpIds/pluginIds`，Skill 只有 `instructions`，MCP 只有 `endpoint`。它们适合 UI 验证，但不足以支撑正式执行：

- Skill 丢失文件包结构、标准 frontmatter、资源和来源，无法可靠导入/导出。
- MCP 无法区分 transport、认证要求、真实工具 schema 和连接/授权状态。
- Agent 未指定模型配置引用、输入输出要求、权限与执行限制。
- 全量同步 localStorage 无法可靠保存文件、实现分页加载、并发更新及持久化错误反馈。
- ID 引用未固定版本，编辑 Skill 会影响 Agent 下一次执行的内容。
- 现有 `buildInvocation` 会复制 Agent Prompt 等字段；正式请求应交由 BE 按授权和固定版本解析。

这轮只确定设计；不立即重写页面，不自动导入文件、不连接外部 MCP、不运行脚本，也不修改 BE。

## 3. 总体层级

```text
页面：Agent 编辑器 / Skill 包编辑器 / MCP 设置与授权页 / 二级菜单
  ↓ POJO、ViewModel、Controller 命令
领域：定义、草稿、发布、引用解析、菜单投影、调用意图
  ↓ 异步 Repository + 导入/导出 Adapter
数据：浏览器 IndexedDB Adapter / 后续 HTTP Adapter
  ↓ 将来接入 BE
BE：权限校验、定义解析、凭据管理、Skill 文件提供、MCP Client、Agent 执行
```

`core/tools` 只维护可发现的 UI 入口及运行时行为；业务领域建议放在独立 `src/features/ai-config/`。如果后续形成多个应用共用的能力，再提取领域包，不先塞入 Runtime Core。

禁止把 JSX、React 组件、Tiptap 实例、MCP SDK Client、WebSocket、连接句柄存进领域 POJO。二级详情继续由功能自己的 `renderItem` 提供，Workbench 继续是可选 API，不是配置的一部分。

## 4. 所有对象共用的管理层

### 4.1 定义、草稿、发布版本、启用绑定四者分开

```ts
type DefinitionKind = "agent" | "skill" | "mcp";
type Scope =
  | { type: "user"; id: string }
  | { type: "workspace"; id: string }
  | { type: "organization"; id: string };

interface DefinitionMeta {
  id: string;                     // 稳定、不透明 ID，不以名称作关联键
  kind: DefinitionKind;
  scope: Scope;
  slug: string;                   // 同 scope + kind 唯一的机器名称
  displayName: string;            // 中文名称/任意展示名称
  summary: string;
  tags: string[];
  ownerId: string;
  publishedRevision?: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  etag: string;                   // 元数据并发更新标记
}

interface DefinitionDraft<T> {
  definitionId: string;
  basedOnRevision?: number;
  spec: T;
  etag: string;                   // 草稿也有独立并发标记
  updatedAt: string;
}

interface DefinitionRevision<T> {
  definitionId: string;
  revision: number;               // 单个定义下递增，不等于 schemaVersion
  schemaVersion: 1;               // 平台正式协议从 1 开始；不等于旧 POC version:1
  spec: T;
  contentDigest: string;          // sha256:<hex>；不作为权限或安全审核证明
  publishedAt: string;
  publishedBy: string;
}

interface PublishedRef {
  id: string;
  revision: number;               // 发布引用必须固定，不能暗含 latest
}

interface AvailabilityBinding {
  definitionId: string;
  scope: Scope;
  enabled: boolean;              // 安装/启用状态与发布内容分离
  etag: string;
}
```

规则：

1. 草稿可反复保存；执行只使用已发布的不可变 revision。草稿预览不调用真实 LLM/MCP。
2. 发布校验成功后，在事务中写入 revision、依赖关系，再更新发布指针；失败不部分提交。
3. 修改定义创建新草稿，不覆盖旧 revision。回滚是切换发布指针，不能覆盖历史内容。
4. Agent 发布时 Skill/MCP 引用固定 `id + revision`。编辑页可提示有新版本，用户确认升级后重新发布 Agent。
5. 菜单可展示当前发布版本；引用节点在选择时保存其 revision，之后发布新版不会悄悄更换这次选择。
6. 禁用/撤销权限立即禁止新执行；旧快照只用于说明历史，不能绕过当前权限继续调用。
7. 有引用或历史记录的对象用归档，不级联清空 Agent 引用。彻底删除受引用检查、保留期和权限限制。
8. 所有 list/get/update/publish/run 均按当前认证主体校验 scope，前端传 ownerId 不具备授权效力。

`slug`、`displayName` 不等于标准 Skill 的 `name`。例如展示名“发布风险检查”、机器名 `release-risk-review`；输入框仍按展示名截断，真正关联使用 ID/revision。

### 4.2 内容完整性与来源

版本中保存导入来源（手动、上传、Git 固定 commit、可信插件固定版本）、导入时间、原始格式标识和校验报告。Git URL、包内说明、作者名字不是信任证明。

平台 JSON 内容摘要使用指定的 canonical JSON 算法；Skill 包摘要由排序后的规范化相对路径与各文件字节摘要计算。路径、排序、换行是否规范化必须写入算法版本；默认保留文件原始字节，不用 ZIP 压缩后字节作内容身份。

启用、安全审核和权限属于管理层；不在 `SKILL.md` 中伪造平台官方字段。

## 5. Skill：以标准文件包为内容真源

### 5.1 标准内容与平台索引

最小 Skill 是一个包含 YAML frontmatter 和 Markdown 正文的 `SKILL.md`。配套脚本、说明和素材可以放在 `scripts/`、`references/`、`assets/`，这些目录是组织约定，不把其他合理文件一律判成非法。[Agent Skills specification](https://agentskills.io/specification)

```text
release-risk-review/
  SKILL.md
  references/
    risk-levels.md
  assets/
    checklist-template.md
  scripts/                       # 可选；保存脚本不等于授权执行
```

本项目原创示例：

```markdown
---
name: release-risk-review
description: 分析发布变更、回滚准备和灰度指标。用户请求上线风险检查或发布检查单时使用。
license: Proprietary
metadata:
  author: release-team
  version: "1.0.0"
---

# 发布风险检查

先确认发布编号、变更范围和证据来源；缺失的信息明确标为待确认。
根据 references/risk-levels.md 分类风险，再生成检查单。
输出参考 assets/checklist-template.md。
没有审批时，不执行真实发布或回滚操作。
```

frontmatter 支持标准的 `name/description/license/compatibility/metadata/allowed-tools`。必填项、长度、名称与包根目录一致等规则按已选规范校验；平台生成的机器名先使用保守 ASCII kebab-case 子集，不把中文展示名写入 `name`。`allowed-tools` 属于实验字段，不能直接视为平台授权。[Agent Skills specification](https://agentskills.io/specification)

平台领域索引建议：

```ts
interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;           // Adapter 映射原文 allowed-tools
}

interface PackageFile {
  path: string;                    // 相对 Skill 根目录，例 SKILL.md
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  blobId: string;                  // 后端内部对象引用，不是永久公开 URL
}

interface SkillPackageSpec {
  format: "agent-skills";
  rootDirectory: string;
  entry: "SKILL.md";
  files: PackageFile[];
}

interface SkillParsedIndex {
  frontmatter: SkillFrontmatter;
  instructions: string;            // 从主文件解析出的 Markdown 正文
  parserVersion: string;
  sourceDigest: string;
  diagnostics: ValidationIssue[];
}

interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
  line?: number;
}
```

**内容真源只有文件包。** `SkillParsedIndex` 是可重建的派生结果，不允许同时单独写 `instructions` 与 `SKILL.md`，否则必然失同步。表单编辑由 Adapter 更新主文件并重建索引；源码编辑后重新解析。保留原始文件、扩展字段及语义，导出不依靠不完整索引重造文件。未知字段标注来源/兼容性，禁止无提示删除；可能影响执行且无法支持的字段不能“忽略后当作成功”。

### 5.2 不是所有 Skill 都有 inputSchema

基础 Agent Skills 格式不要求 JSON 参数表单，也没有通用“选择 Skill 就执行函数”的语义。输入框选择 Skill 默认表示 **激活该工作流**，不是立即运行脚本。

如果业务需要发布编号等参数，作为本项目独立的 `SkillInvocationContract` 管理（可选 JSON Schema、默认值、展示配置）；导出标准包时不把它塞成未说明的标准 frontmatter 字段。没有参数合约就接受任务文本，不强行制造空表单。

### 5.3 Agent 使用 Skill 的方式

区分 `available`（告诉模型存在、需要时加载）与 `activate`（明确为当前任务激活）。不把所有关联 Skill 正文永久拼进 system prompt。

模型发现目录、激活正文、再按需读取配套文件是三个不同动作。远程 Agent 也可由宿主提供文件读取工具或按需内容接口，无需访问浏览器本机路径。[Agent Skills integration guide](https://agentskills.io/client-implementation/adding-skills-support)

BE 编译上下文时记录实际激活的 revision、读取过的文件摘要和来源；同一个 Skill 同一 run 不重复注入。上下文整理不能把已激活的关键约束无提示丢失。

Skill 权限限制只能收窄宿主权限，不能因为文字里写“允许访问数据库”而自动扩大权限。`allowed-tools` 的工具名称/规则通过明确的 Adapter 映射到本平台能力；未知映射提示不支持，不能把它直接当作 MCP toolName。

### 5.4 导入、文件编辑与运行安全

- 支持粘贴完整 `SKILL.md`、创建表单、上传文件包；Git 导入由将来的 BE 固定 commit 后获取，不让浏览器自行执行仓库内容。
- 拒绝路径穿越、绝对路径、重复路径、大小写冲突、逃逸符号链接与 ZIP bomb；设文件数量、解压总量、单文件上限。
- YAML 使用安全解析，拒绝重复键、可执行自定义 tag，并限制 alias 展开；Markdown 展示禁用危险 HTML/脚本。
- 对外部包展示权限与可执行文件清单，确认导入/发布不等于确认运行。
- 脚本只能在将来的受控 runner 中执行；限制文件、网络、进程、时间和资源。没有 runner 时 UI 明确显示“不支持脚本执行”，不能假装已执行。
- `compatibility` 是自然语言环境声明，既展示给用户也由 BE 做可支持项检查，不把任意文本变成安装命令。
- 发布使用校验器并固定格式/parser 版本；发布后的包不再原地修改。

## 6. MCP：连接定义、授权绑定、能力缓存分开

### 6.1 保存的是连接配置，不是手工造一份工具目录

```ts
type McpTransport =
  | {
      type: "streamable-http";
      url: string;
      publicHeaders: Record<string, string>;  // 禁止凭据和敏感值
    }
  | {
      type: "stdio";
      runnerProfileId: string;               // 只在受控 BE runner 启动
      command: string;
      args: string[];
      publicEnv: Record<string, string>;      // 私密变量由授权绑定注入
    };

type McpAuthRequirement =
  | { type: "none" }
  | { type: "oauth"; requestedScopes: string[] }
  | { type: "static-secret"; delivery:
        | { type: "bearer" }
        | { type: "header"; name: string }
        | { type: "env"; name: string } };

interface McpConnectionSpec {
  transport: McpTransport;
  auth: McpAuthRequirement;
  protocol: { mode: "auto" } | { mode: "require"; version: string };
  limits: { requestTimeoutMs: number; maxResponseBytes: number };
}
```

这些是平台配置 DTO。`stdio`、Streamable HTTP 是 MCP 传输机制；浏览器无法启动 stdio 子进程，云 BE 也不能访问用户电脑上的 `D:\...`。stdio 运行位置、可执行程序和环境必须由受控 runner 定义。[MCP stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)、[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

当前 Web 项目建议先让 Streamable HTTP 可执行；stdio 模型保留，但在能力不支持时明确标为不可运行，不为了兼容提前实现旧 HTTP+SSE、自定义 transport。传统 `mcpServers` JSON 导入/导出通过客户端专用 Adapter，不视作协议规定的统一配置文件。

`auto` 仅在 BE 声明支持的协议集合内选择，不代表客户端会接受任意协议。官方新版本与旧版本在发现、会话等行为上有区别；它们由 SDK/协议 Adapter 处理。协议能力事实在运行观察中记录，不能与配置中的期望版本混为一谈。[MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)

### 6.2 凭据不是连接定义内容

```ts
interface McpAuthorizationBinding {
  id: string;
  connection: PublishedRef;
  principalId: string;
  workspaceId: string;
  credentialRef?: string;         // 私密存储引用；UI 可只收到 masked 状态
  status: "not-required" | "required" | "authorized" | "expired" | "revoked";
  grantedScopes: string[];
  expiresAt?: string;
}

interface McpObservation {
  connection: PublishedRef;
  authorizationBindingId: string;
  state: "unknown" | "checking" | "ready" | "auth-required" | "unreachable" | "unsupported";
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
  checkedAt?: string;
  error?: { code: string; safeMessage: string };
}
```

连接定义可在工作区共享；每个用户的授权绑定独立。发布新连接 revision 后必须重新评估绑定，不默认把旧凭据送给变更后的域名。OAuth 的 token、refresh token、client secret 只在 BE 凭据库；服务账户共享须由管理员显式配置并审计，不默认借用创建者身份。

MCP HTTP 授权依据官方授权流程，由 BE 完成受保护资源/授权服务发现与验证；stdio 凭据按环境注入处理。`static-secret` 是兼容具体服务的配置适配，不把 API Key Header 冒称为完整 MCP OAuth 支持。[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

保存配置、授权、测试连接、刷新能力是四个独立操作。未知状态不等于失败，目录为空不等于未连接；停用、权限失效时即使缓存还在也不可执行。

### 6.3 tools/resources/prompts 是服务发现结果

正式数据分为：

- ConnectionSpec：用户编辑的连接方式与认证要求。
- AuthorizationBinding：当前主体是否授权。
- CapabilitySnapshot：BE 获得的原始标准描述与索引，不允许用户编辑成虚假的服务返回。
- AgentBinding：Agent 明确允许使用哪些能力。

MCP tools 使用服务返回的 `name/description/inputSchema` 等定义，可有展示标题、输出 schema 和 annotations。发现通过 `tools/list`，执行通过 `tools/call`；名称只在单个 server 内唯一，不能使用远端 serverInfo.name 作为全局身份。[MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

工具引用建议使用 `(connectionId, connectionRevision, toolName)`，UI option ID 通过可逆编码生成；LLM 函数别名则由 BE 按提供商名称限制生成，保留双向映射，不简单拼接含任意字符的字符串。

CapabilitySnapshot 至少包括：

- 连接 revision、协议版本、发现时间、授权/主体分区、服务能力信息。
- tools 原始描述及各自 schema 摘要；resources 的 URI/模板索引；prompts 的名称/参数索引。
- 发现是否完成、分页游标、过期时间、列表摘要和校验错误。
- 合法的扩展元数据原样保存；使用匹配协议版本的 DTO/SDK，不用自己的不完整 `name + schema` 替换整个标准结果。

发现缓存按 **连接版本 + 授权主体/有效权限 + 协议版本** 隔离，不能把甲用户的私有工具列表发给乙用户。协议变更事件、权限变化、配置变化使缓存失效；按协议支持的方式刷新，不在 UI 里绑定某一版本的订阅机制。

不修改远端 schema 以制造“能用”的假象。无法映射到当前 LLM 提供商的 JSON Schema、需要额外宿主交互但未支持的能力，标注 unsupported；授权信息、schema 校验都由 BE 再验证。

### 6.4 工具权限与远端变更

Agent 默认按明确 toolName allowlist 绑定；发现新 tool 不自动加入授权集。需要“全部能力”的管理员场景可后续增加受策略约束的选项，第一版不默认全开放。

`readOnlyHint/destructiveHint` 等 annotations 是远端声明，不等于可信审批结论；平台风险分类及每次审批独立。写操作和未知风险默认要求审批，除非管理员策略已经明确允许。记录审批主体、参数摘要、scope 和有效期，不把选中 MCP 菜单当成批准所有未来操作。

已固定 MCP 连接 revision 不保证远端服务代码/工具 schema 不变。运行计划记录观察到的 schema digest；发现不一致时重新校验/审批或失败提示。历史展示可重现当时的配置事实，但无法保证远端副作用和结果可重放。

网络与执行边界：URL HTTPS、禁止 URL 内嵌密码；BE 做目标 allowlist、DNS/重定向 SSRF 防护和出站限制。内网端点只有管理员显式允许。stdio 使用结构化 args、不拼接 shell 命令，不允许普通用户指定任意服务器文件路径/命令。凭据不出现在 URL、日志、工具结果或模型上下文中。

## 7. Agent：执行配置，不再只有 Prompt

### 7.1 正式领域模型

```ts
type JsonSchema = Record<string, unknown>;

interface AgentSkillBinding {
  skill: PublishedRef;
  mode: "available" | "activate";
  required: boolean;
}

interface AgentMcpBinding {
  connection: PublishedRef;
  toolNames: string[];             // 明确 allowlist；空数组表示没有 tool 权限
  promptNames: string[];           // 只在主动选择/业务动作时加载
  resourceUris: string[];          // 仅授权特定资源；模板授权单独扩展
  required: boolean;
}

interface AgentSpec {
  instructions: string;            // Markdown；不是包含任何秘密的动态字符串
  inputSchema?: JsonSchema;        // Agent 自身可选的业务输入合约
  model: {
    profileId: string;             // 受控模型配置，凭据另存
    temperature?: number;
    maxOutputTokens?: number;
    providerOptions?: Record<string, unknown>; // 仅 profile Adapter 白名单允许的参数
  };
  skills: AgentSkillBinding[];
  mcp: AgentMcpBinding[];
  builtInCapabilityIds: string[];  // 受控宿主工具，不是 UI 菜单 option ID
  output:
    | { type: "text" }
    | { type: "json-schema"; schema: JsonSchema };
  execution: {
    maxSteps: number;
    maxConcurrentToolCalls: number;
    runTimeoutMs: number;
  };
  policyProfileId: string;         // 平台审批/网络/运行环境权限上限
}
```

`profileId` 是部署中的模型配置别名，管理提供商、model ID、base URL 和凭据引用。Agent 页面选择允许的 profile；高级参数由该 profile 的能力描述控制，不让用户提供任意 base URL 或注入 `messages/tools/apiKey`。运行快照记录实际 profile revision/model ID，模型别名对应的服务权重变化仍可能影响结果。

不把 `memory` 简化成 boolean。消息历史仍属于 thread/branch；跨会话长期记忆、RAG、文件读写和子 Agent 编排，后续通过明确 capability 与资源策略接入，不能默认获得。当前也不新增 Agent 的嵌套递归/流程图配置；以后以版本化编排定义引用多个 Agent。

模型不支持结构化输出、某个参数或 tool-calling 时发布校验/执行能力校验应报错，不静默忽略。范围和资源限额按 profile 与平台限制交叉校验，最终值不得超过平台上限。

### 7.2 Prompt、Skill 与工具的组合语义

建议顺序和边界：

1. 宿主安全与系统策略由 BE 提供，用户不能编辑覆盖。
2. Agent instructions 提供业务角色、任务处理方法、输出要求。
3. available Skills 只公开必要目录信息；activate Skills 作为清晰标识来源的工作流指令加载。
4. 业务参数通过 schema 校验，作为结构化任务数据；第一版不开放任意表达式或模板执行。
5. MCP resources、工具结果、用户引用和历史消息是有来源标识的数据，不提升为新的宿主指令。

有效能力 = 平台政策 ∩ 当前用户权限 ∩ Agent 明确绑定 ∩ 本次任务批准的选择。Skill 声明只能收窄，不能扩大。额外选择未绑定的 Skill/MCP 时生成待确认变更意图，由 BE 校验和审批；不会仅因前端出现高亮节点而自动授权。

`required:true` 的依赖不可用则 run 预检失败，不能静默删掉。可选依赖可按规则跳过，但向 UI/运行记录报告警告。两个 Compare 分支分别报告预检结果，一侧失败不阻断另一侧的独立执行。

### 7.3 导入/导出与插件关系

平台 Agent 使用自己的 versioned JSON。可增加 Claude 等产品格式 Adapter，展示映射成功、未支持和丢失字段；不能声称导出后能在所有 Agent 产品无损执行。A2A 对外暴露将来由 AgentSpec 投影成 AgentCard，不用 AgentCard 存内部凭据或取代执行配置。

第 19 节 Workbench Plugin 独立维护。Agent 引用的是插件贡献的**受控执行能力**或上下文能力，而不是“选中 Plugin 就执行远程 JS”。纯 UI Renderer 不必进入 AgentSpec。现有 POC `pluginIds` 迁移为待确认的业务能力映射，不能自动授予执行权限。

## 8. 用户界面设计

### 8.1 Agent 页面

- 基本信息：展示名、机器名、描述、标签、归属、草稿/发布/禁用状态。
- 指令：Markdown 编辑、预览、来源/版本说明。
- 模型：profile 下拉及支持的高级参数；不显示/保存 API Key。
- Skill：关联已发布版本、available/activate、必需/可选、更新提醒。
- MCP：选择已发布连接，再选具体 tools/prompts/resources；同时显示未授权/未连接/不支持状态。
- 输出与执行：文本/JSON Schema、步数/并发/运行时间和策略档位。
- 发布：完整校验报告、依赖列表、变更摘要。保存草稿不等于生效。

### 8.2 Skill 页面

- 基本信息与主文件标准字段分区，区分中文展示名和标准机器名。
- 主文件的表单模式/源码模式，共用同一文件内容；错误给出行号。
- 文件树：主文件、references、assets、scripts；文本编辑与附件管理按类型处理。
- 标准包导入/导出、文件大小/脚本风险提示、兼容性与校验结果。
- 版本比较与影响分析：哪些 Agent 使用该 revision；发布新版不自动改它们。

### 8.3 MCP 页面

- 连接信息与 transport 设置；stdio 没有可用 runner 时禁用运行操作。
- 认证要求与“当前用户授权”分区；只展示 masked 状态。
- 保存草稿、发布、授权、测试连接、刷新能力分别操作，不将网络调用隐含在保存里。
- tools/resources/prompts 分区详情，展示标准 schema、当前权限和支持状态。
- 连接错误、认证过期、目录为空、部分发现、不支持等状态分别显示。
- 没有 BE 时使用显式 mock 数据源/未接入提示；不显示假的“连接成功”。

### 8.4 现有 `/` 的语义

一级/二级菜单结构继续保留，不改为所有底层工具平铺：

- Agent 二级条目选择一个已发布定义；若需配置，则由 Agent 功能组件打开自己的弹窗。
- Skill 二级条目选择已发布包；业务模块决定是否要求参数、是否插入引用/激活标记。
- MCP 二级条目仍是连接；详情由 MCP 组件展示 tools/resources/prompts。选择连接只创建能力选择意图，不直接 `tools/call`。
- 如果后续要直接调用某一个 MCP tool，由 MCP 详情组件收集参数并请求 BE，不能用公共菜单猜测执行方式。
- 引用节点只保存 kind、ID、revision、显示标签和必要的调用意图 ID，不保存整份包/Prompt/认证数据；显示标签不是执行协议。
- 未发布、停用、无使用权限的项不参与默认调用列表；已选择的项后来失效时保留可解释引用并阻止执行，不偷偷切换别的版本。

二级条目从轻量 `DefinitionSummary` 投影。不要为显示菜单加载所有 Skill 文件或对每个 MCP 自动联网；打开详情才加载内容/缓存。数据未返回、出错和无数据必须可区分。

## 9. 如何保存：现在前端与以后 BE

### 9.1 前端阶段

推荐 IndexedDB，不继续把所有定义、文件和缓存拼成一个 localStorage JSON：

| Object store | 保存什么 |
| --- | --- |
| definitions | 可检索的目录元数据 |
| drafts | 草稿配置、独立 etag |
| revisions | 不可变正式版本 |
| packageFiles / blobs | Skill 文件清单与 Blob 内容 |
| availability | 工作区/用户启用绑定 |
| capabilityCache | 显式 mock 或后续 BE 返回的脱敏发现缓存 |

浏览器存储只是单设备暂存，可被清理，并非正式云端真源。大文件有配额限制；保存失败必须提示失败/未持久化，不能继续展示“保存成功”。不在浏览器持久化真正 OAuth token、API Key 或跨租户私密缓存。

Controller 的订阅快照仍然同步且缓存稳定，但其 load/save/import/publish 通过异步 Repository；加载状态不等于空目录。保存前 UI 可以维护编辑草稿，但持久化成功状态只能在 commit 返回后设置。

### 9.2 BE 阶段

建议关系数据库保存结构化管理数据与配置 JSON，文件正文/附件进入私有对象存储；技术选型可由 BE 决定，不要求绑定某个数据库产品。

| 数据类别 | 建议逻辑表/存储 | 关键约束 |
| --- | --- | --- |
| 定义目录 | ai_definition | scope/kind/slug 唯一、owner、归档、发布指针 |
| 草稿 | ai_definition_draft | definitionId 唯一、etag、防覆盖 |
| 已发布配置 | ai_definition_revision | definitionId + revision 唯一、不可变、spec JSON |
| 依赖索引 | ai_definition_dependency | 版本间引用、删除检查、影响分析；由 spec 派生 |
| Skill 文件 | ai_package_file + 私有 blob storage | revision/path 唯一、大小、摘要、对象引用 |
| 启用绑定 | ai_availability_binding | definition + 使用范围唯一 |
| 授权引用 | mcp_authorization_binding | 连接版本/主体/工作区；不存明文 token |
| 凭据 | Secret Manager / 加密 credential store | 独立权限、轮换、不可回读到一般 API |
| 发现缓存 | mcp_capability_snapshot | 授权主体与连接版本隔离；可重建 |
| 执行快照 | ai_run_plan / 执行审计 | run/branch、固定版本、实际模型与 schema 摘要 |

目录查询走 metadata/index；不要扫描包文件，也不要每次 list 返回整份 Prompt/Skill。内容 API 按 revision 加载，文件下载使用受鉴权接口或短期签名 URL；签名 URL 不长期保存、不写进模型上下文。

上传对象与数据库不具备天然原子事务：先上传到暂存区，校验完整性后在发布事务中引用；失败重试可幂等，未引用对象按保留策略回收。归档后历史引用仍可读（权限允许时），不能提前垃圾回收历史版本使用的 blob。

### 9.3 四种版本不能混为一谈

- 平台 schemaVersion：字段协议升级，由 migration 处理。
- definition revision：业务内容不可变版本。
- Skill 原始 metadata.version：作者标签，不能代替本平台 revision。
- MCP protocolVersion：通信版本，不是连接配置 revision。

ETag 用于并发写入；摘要用于内容身份；两者都不等于授权。客户端提交过期 ETag 返回冲突并提供差异/重载，不用最后一次保存悄悄覆盖。

## 10. 三层接口与 BE 合约

### 10.1 Repository 与 ViewModel

建议异步接口（完整 DTO/schema 在下一阶段建立）：

```ts
interface AiDefinitionRepository {
  list(query: { kind?: DefinitionKind; cursor?: string; search?: string }): Promise<{
    items: DefinitionMeta[]; nextCursor?: string;
  }>;
  getDraft(id: string): Promise<DefinitionDraft<unknown>>;
  saveDraft(id: string, spec: unknown, expectedEtag: string): Promise<DefinitionDraft<unknown>>;
  getRevision(ref: PublishedRef): Promise<DefinitionRevision<unknown>>;
  validateDraft(id: string): Promise<ValidationIssue[]>;
  publish(id: string, expectedEtag: string): Promise<PublishedRef>;
}
```

这里 `unknown` 是示意的 Repository 边界，正式实现使用按 kind 区分的 discriminated union + JSON Schema 校验，不能把 unknown 直接传给 UI。`list` 的 owner/scope 在 BE 鉴权层决定；前端 query 不得扩大可见范围。

UI 只用类型化 FormModel/MenuRow/DetailModel；Controller 不依赖原始文件/YAML/MCP SDK；Adapter 负责标准文件到领域内容的映射；Repository 负责取得/保存数据。换数据来源只换 Repository；换标准字段涉及对应 Domain Adapter 和业务编辑器，不能承诺新增业务语义永远零修改。

### 10.2 建议 REST 资源

- `GET /api/ai/definitions?kind=skill&cursor=...`：分页目录摘要。
- `POST /api/ai/definitions`：创建目录与初始草稿。
- `GET/PUT /api/ai/definitions/{id}/draft`：草稿；PUT 带 If-Match。
- `POST /api/ai/definitions/{id}/validate`、`/publish`：校验与发布，返回版本/诊断。
- `GET /api/ai/definitions/{id}/revisions/{revision}`：固定版本内容。
- `POST /api/ai/skill-imports`、`GET .../export`：导入/导出、校验报告与冲突处理。
- `POST /api/ai/mcp/{id}/authorizations`、`/checks`、`/discoveries`：独立授权/测试/发现任务，均指明 revision。
- `GET /api/ai/mcp/{id}/capabilities?...`：脱敏、按主体分区的发现结果。
- `POST /api/ai/run-plans`：解析本次任务版本、授权和执行限制；不是实际执行。

这些 API 是建议，不在本轮调用/创建。执行协议沿用聊天传输，由业务 Adapter 接入；不新增另一个互不关联的聊天状态机。

统一错误至少区分：validation、version_conflict、dependency_unavailable、permission_denied、credential_required、unsupported_capability、transport_error、provider_error、storage_error。返回安全消息、字段路径、traceId 和可重试提示；不回传完整上游响应/凭据。非幂等 tool 失败不能统一自动重试。

## 11. 执行请求与 Compare Agent

### 11.1 请求传引用与意图，BE 返回固定计划

本项目新增字段示意：

```json
{
  "schemaVersion": 1,
  "threadId": "release-discussion",
  "turnId": "turn-42",
  "branchId": "agent-a",
  "runId": "run-42-a",
  "agent": { "id": "agent-release", "revision": 3 },
  "skillSelections": [
    { "skill": { "id": "skill-risk", "revision": 2 }, "intent": "activate" }
  ],
  "mcpSelections": [
    { "connection": { "id": "mcp-release", "revision": 4 }, "toolNames": ["get_release"] }
  ],
  "referencedMessageIds": ["message-previous-answer"]
}
```

正文、消息历史仍属于既有聊天请求，扩展字段不复制所有定义内容。上例是扩展意图，不能仅凭前端发送的引用即获得权限；message ID 也须按 BE 的聊天可见性校验，不能跨用户读取。

BE run-plan 预检：认证与 scope → 固定定义版本 → 检查依赖/启用状态 → 解析模型 profile → 检查有效授权 → 发现/校验实际 schemas → 准备 Skill 文件与目录 → 形成计划与摘要。用户选择与 Agent 固定绑定的合并规则确定、可审计；本次额外授权需要确认，不自动全量启用。

返回计划包含计划 ID、每个引用的固定 revision/digest、当前依赖状态、实际模型信息、MCP 工具别名映射、有效限制、警告/待审批项。若客户端与 BE 间隔期间发生撤权，执行启动时再次验证，计划不构成永久权限票据。

### 11.2 Compare 分支互相隔离

- Compare 始终作为 Runtime；A/B 各自选择 Agent revision，各自有 runId/branchId 和运行计划。
- 共享的任务与 Skill 选择可由 UI 默认应用到两侧，但可显式调整；不能通过 `threadId` 字符串后缀猜测实际 Agent 定义。
- 不同 Agent 可以使用相同模型 profile/MCP 连接定义，但不能混用其对话状态、工具调用结果或凭据主体。
- A/B 并发仍受用户/模型/MCP 的总配额限制；缓存只能在相同授权分区共享。
- B 关闭仍只影响后续 Turn，不改写历史配置快照。Agent/Skill/MCP 编辑也不回写历史 Turn。

### 11.3 当前 BE 的实际接入缺口

已检查 `be` 项目：`AgUiRunMapper` 目前提取最新 user 文本、context、tools；`ChatStreamRequest` 只包含 threadId/message/context/tools，`DeepSeekStreamingChatService` 仍使用内置 SYSTEM_PROMPT 与应用模型配置。

因此，仅在 FE 添加引用字段不会使自定义 Agent 生效。BE 接入需新增明确解析路径/DTO 与配置 Resolver，不能把 Agent 配置藏在任意 context 然后期待自动执行。可以在既有业务传输 envelope 中建立 namespaced invocation 字段，由 mapper 校验后交给执行层；不需要为此改动通用 Chat Runtime Snapshot。

UI 工具和 MCP 工具在执行层要区分：UI 工具按现有前端回调处理，MCP 工具由 BE Client 执行；同名时用类型化引用和别名映射消歧。对 LLM 的 tool-call/result 保持对应，不能把“声明 schema”误当“已经执行工具”。本轮不修改这些 Java 类。

运行审计记录配置 revision、激活 Skill、MCP 请求/结果摘要、审批事实及模型错误，秘密/敏感正文脱敏。`Insufficient Balance` 等 provider_error、socket 消息大小错误、MCP 授权失败应分开呈现，不混为一条“连接异常”。

## 12. 旧 POC 迁移：一次性明确映射

不长期维护两套同步目录，也不让旧 localStorage 每次加载都覆盖新数据库。

| 旧字段 | 新结构 | 迁移动作 |
| --- | --- | --- |
| name | displayName + slug | 生成合法机器名；冲突由用户确认，不修改稳定 ID |
| skill.instructions | 包内 SKILL.md 正文 | 建立 frontmatter；description 不足时提示补全；先保存草稿 |
| agent.prompt | AgentSpec.instructions | 原文保留；补选 model/policy profile 后才能发布 |
| skillIds | AgentSkillBinding[] | 迁移为待固定版本引用；用户确认加载模式 |
| mcpIds / endpoint | AgentMcpBinding / HTTP 连接定义 | 认证状态未知；发现 tool 后显式授权；不默认全 tools |
| pluginIds | 待映射业务能力 | 不直接变成执行授权；保留迁移报告 |
| enabled | AvailabilityBinding | 未发布的草稿仍不可调用，不因为 enabled:true 自动发布 |

旧 version:1 是 POC Catalog 版本；新正式 schemaVersion:1 是不同协议，使用独立存储 namespace/明确 format，禁止只凭数字判断相同结构。

迁移流程：读取旧键 → 生成可下载备份与校验报告 → 用户确认 → 新存储事务导入草稿 → 核验数量/内容 → 记录 migration ID。旧键默认保留用于恢复，不未经确认删除。重复迁移以旧 ID + migration ID 防重复，发生 ID/kind 冲突停止并提示。

## 13. 实施计划与验收

### 阶段 A：领域合约与数据层

新建 `src/features/ai-config/domain/`、`adapters/`、`data/`、`controllers/`、`ui/`。先定义版本化 schema、运行时校验、Repository 和错误模型，再实现 IndexedDB/内存测试 Adapter；三种 spec 分文件，不建巨大万能类。

同步保留稳定订阅快照，数据写入改为异步。建立发布、归档、引用检查、ETag 冲突以及迁移报告。此阶段不执行真实外部能力。

### 阶段 B：先完整实现 Skill

SKILL.md 解析/校验、文件编辑、包导入导出、草稿/发布、版本比较。Skill 标准最明确，先用它验证文件存储和三层隔离，再迁移菜单的 Skill 贡献组件。

### 阶段 C：MCP 正式配置页

HTTP 配置、认证声明、授权/连接/发现状态与 capability 详情。无 BE 时有显式 mock Adapter；SDK、OAuth、网络安全的真实流程留到 BE。stdio 不支持时明确禁用。

### 阶段 D：Agent 组合与输入框迁移

模型/策略 profile 数据源、固定 Skill/MCP 引用、输入/输出/执行限制、依赖影响分析。将三种业务选择行为注册到现有工具机制，Tiptap 只承接结构化意图，不维护完整领域对象。

### 阶段 E：BE Resolver 与真实执行

实现租户授权、模型 profile、私密存储、Skill 文件供给、MCP Client 和审批，再接 run-plan/既有聊天传输。最后验证 A/B 分支并发、撤权、执行审计及错误恢复。

验收覆盖：

- 标准包最小/完整/非法/扩展字段导入导出，表单/源码一致，Unicode 展示名与机器名分离。
- 大附件、二进制文件、ZIP 路径攻击、YAML 展开、配额不足和刷新后恢复。
- 保存失败不误报成功；并发草稿修改冲突；发布事务失败可恢复；不同版本不可覆盖。
- 发布 Skill/MCP 新版本不改变已有 Agent 引用，历史仍可解释；归档不破坏引用。
- MCP 已保存但未授权、授权但未发现、空目录、部分发现、不支持协议、失效凭据分别展示。
- 多连接同名 tool 消歧；新工具不自动授权；工具 schema 变化需要重新验证。
- 跨用户/工作区缓存与凭据隔离；导出、日志、运行计划不泄漏秘密。
- Agent 必需依赖失效阻止运行；可选依赖降级有警告；model 参数不支持不静默忽略。
- 两级菜单不加载全包/自动联网；引用携带固定版本，菜单选择不自动批准副作用。
- A/B 独立预检、错误和 tool-call/result；撤权后不能凭旧计划继续调用；非幂等操作不盲目重试。

## 14. 阶段 A / B 实施记录（2026-10-02）

已落地领域 POJO/schema 与基本数据层，以及 Skill 的完整文件包编辑流程：

- Agent / Skill / MCP 区分类型，平台 schemaVersion、稳定 ID、scope、草稿、发布 revision、启用状态与 ETag 分离。
- AJV 结构校验、Agent 依赖检查、MCP 公开配置凭据限制、JSON Schema 的大小/深度限制。
- 原生 IndexedDB 与内存测试 Repository。第一版 definitions 中合并存元数据/草稿/版本/启用状态，blobs 单独存字节；领域仍分离，发布事务与包引用原子提交。
- SKILL.md 表单/源码共用内容源；文件树、文本和附件管理、Markdown/ZIP 导入与完整 ZIP 导出。
- 包路径、数量、大小、UTF-8、摘要及 ZIP 安全检查；草稿允许修复主文件内容错误，发布重新校验，脚本只存不执行。
- 发布历史只读查看、停用/归档保留历史；两级菜单仅选择已发布 Skill，Tiptap 节点固定 revision，内容按需读取。
- 新工作台使用中性灰白主题，样式通过集中 Design Tokens 接入；不修改原 demo 配色。

实现说明见 `src/features/ai-config/README.md`；主题入口为 `src/theme/tokens.css`。

尚未完成：版本 diff/依赖影响分析、全量旧数据迁移报告及幂等 ID 映射、跨 tab 实时刷新、目录分页/独立版本 API、真实 BE 权限与执行。Agent/MCP 正式 UI 迁移仍按 C/D 继续，当前页面保留原功能；不将这一阶段描述成三种业务全部可执行。

下一步可进入阶段 C：MCP 正式配置/认证声明/发现状态页面，然后阶段 D 的 Agent 组合。Workbench 与 BE 执行独立推进。
