# Chat Runtime Context

基于 React、TypeScript 和 pnpm 的聊天 Runtime 项目。

## 项目进度入口

当前业务迭代入口为 `/extension-poc`。导航、工作台、工具机制、Skill 包、消息临时编辑与 Pendo 的已完成项及待办，见 [当前进度总览](CHAT_TURN_NAVIGATION_DESIGN.md#0-当前进度与阅读入口)；Agent/Skill/MCP 的阶段进度见 [实施记录](AGENT_SKILL_MCP_DESIGN.md#14-阶段-a--b-实施记录2026-10-02)。

AI 响应过程查看已实现：独立记录单次响应，结束后由 Message Card 的可选按钮打开紧凑时间图与 event/content 列表；事件名称、内容和起止时间由接入方提供，点击后在同一弹窗内查看详情。弹窗内部处理关闭和空记录。DeepSeek 最小求和工具闭环已通过实际联调，不做搜索或会话级轨迹平台。[模块接入说明](src/features/ai-response-trace/README.md)包含独立使用方式；机制与统计见 [响应过程设计](CHAT_TURN_NAVIGATION_DESIGN.md#22-ai-消息节点内展示完整响应过程)。进度于 2026-10-24 按代码核对；历史设计示例不等同于已实现 API。

## 本地开发

```sh
pnpm install
pnpm dev
```

## 测试与构建

```sh
pnpm test
pnpm build
```

## 可选 Pendo 旁路分析

当前 demo 仅观察 localhost / 127.0.0.1 / IPv6 回环地址上的 `/extension-poc`，使用 Pendo 云端；
不需要本地 Pendo 服务端或新增 npm 依赖。这个主机/路由限制属于 demo，通用模块没有此限制。
复制 `.env.example` 为 `.env.local`，填写 Pendo 应用详情中的 **Public App ID** 并启用：

```env
VITE_PENDO_ENABLED=true
VITE_PENDO_PUBLIC_APP_ID=your-public-web-app-id
VITE_PENDO_REGION=io
```

`io` 为当前美国区域，欧盟区域使用 `eu`。Public App ID 是公开的浏览器安装标识，
不要填写 Track Event shared secret、Integration Key 或模型密钥。修改环境变量后重启 Vite。
`.env.local` 已忽略；新环境默认关闭，不会自动发送测试数据。

**迁移到 Next.js + React + TypeScript：只复制 `src/features/pendo/`。**

AI 对话采集使用 `usePendo().trackAgent`，在业务发送、明确结束及评价节点主动提交；无需迁移 queue 或聊天 Sidecar。
它与普通 `track` 共用禁用保护、SDK 就绪前缓冲和退出 flush；现有 demo 不自动上传对话正文。
参数与完整示例见 [Pendo 模块说明](src/features/pendo/README.md#ai-对话事件由业务节点主动提交)。
完整接入与 market 开关示例见 [Pendo 接入说明](src/features/pendo/README.md)。
该目录只负责 SDK、身份和通用上报，通过 `PendoProvider` 参数接收配置，
不读取 Vite / Next 环境变量，也不依赖 chatData、queue、Runtime 或业务事件名。

在 App 或业务 layout 中挂载一次 `PendoProvider`，通过
`enabled={enabledMarkets.includes(market) && otherCondition}` 决定是否启用；默认关闭。
业务中可始终调用 `usePendo().track({ name, properties })`，关闭时为 no-op，无需每个埋点重复判断。
Page/Feature 自动统计只需 Provider 与后台标记；无需接入任何聊天组件。

本地 demo 的环境变量读取和业务事件投影在 `src/chat/demo/extension-poc/analytics/`：

- `ExtensionPocAnalytics`：在布局包一次 Provider，把 Vite 配置与本地限制转换成参数。
- `ExtensionPocLayout` 中的 `PendoWorkspaceSidecar`：观察已生效的功能区与会话目录。
- `ExtensionPocPage` 中的 `PendoChatSidecar`：只读订阅队列和 Runtime，观察 A/B 开关。

两个 Sidecar 只服务本地 demo，实际业务没有 queue 时不需要迁移它们。
如需自定义业务事件，在现有提交/结果回调或业务自己的只读观察器中调用通用 track 即可。
Sidecar 不渲染 DOM，不包装或替换业务方法，不修改 core、消息、队列或 WebSocket 协议。
第三方调用延后到微任务并捕获异常；SDK 被拦截或上报失败不阻止聊天。
SDK 就绪前最多缓存 100 个业务事件，加载失败后丢弃；不自动重试，刷新页面再尝试。
订阅随组件卸载或关闭释放，最后一个 Provider 退出时清理 SDK；StrictMode 共享一次初始化。
已就绪时，页面隐藏/离开及最后一个 Provider 正常卸载前会尽力调用 SDK 的 flushNow；
market 禁用、身份或应用配置切换则丢弃封装缓冲，不显式 flush。此操作不等待服务端确认，不能保证异常退出时送达。
观察器只访问状态/ID，不读取消息正文、工具参数或错误详情。会话与运行 ID 仅用于本地去重，不上传。

| 事件 | 口径 |
| --- | --- |
| `workspace_viewed` | 首次打开或实际切换功能区；属性 `view=chat/agent/skill/mcp/plugin` |
| `chat_session_created` | 会话目录增加新 ID；忽略初始目录及标题更新 |
| `chat_submitted` | 一条消息进入队列；领取、失败、重试不会重复计提交 |
| `agent_comparison_changed` | 用户更改 Agent B 开关；属性 `enabled` |
| `agent_run_finished` | 观察到 running 后进入 completed/error/cancelled；属性 agent/outcome/duration_ms |

一次用户提交可产生 A、B 两个运行结果。历史记录、初始状态、流式文本更新不计运行结果；
关闭页面/卸载前未观察到终态的运行不冒充完成。`cancelled` 表示本地 Runtime 取消，不表示 BE 已确认停止。
耗时从观察到 running 开始计算，不含排队时间。会话创建观察使用当前 mock 数据源已有的 subscribe/listSessions；
未来替换数据源时只需调整 demo 业务目录内的观察器。

可由宿主传入 visitorId/accountId；未传时浏览器按 App ID 持久保存随机 `anonymous-…` Visitor ID，
刷新保持；存储受限时退化为当前页面的内存身份。此版本不会沿用旧的 local 随机 ID。
demo 传入 `environment=local`，通用层不默认写入环境。SDK 禁止元素文本采集、focus/change/submit 自动事件、
Session Replay 和 Guides；清除 URL 查询参数与片段。自动 load/click 仍供后台标记 Page/Feature，
但不为其配置动态文本、表单字段或消息内容属性。后台 Feature 建议用稳定 CSS/属性选择器，不依赖消息文本。

验收：打开 `http://127.0.0.1:5173/extension-poc`，在控制台运行 `pendo.validateEnvironment()`，
然后新建会话、发送消息、切换配置页和 Agent B 开关，在应用的 Raw Events 中按 Visitor ID 查验。
后台正式报表存在处理延迟，先看原始事件。真实运行结果需要可用的聊天后端；后端离线时观察到的应是 error。

临时关闭：设置 `VITE_PENDO_ENABLED=false`，重启 Vite 并刷新页面。
完整移除 demo 接入：删去布局中的 `ExtensionPocAnalytics` 包装及两个 Sidecar 和相关 import，
再删除 `src/features/pendo`、`src/chat/demo/extension-poc/analytics`、
`test/features/pendo` 和 Pendo 环境变量即可；业务回调、core 和依赖清单无需回滚。

相关文档：[SDK 配置](https://web-sdk.pendo.io/config/)、
[采集控制](https://web-sdk.pendo.io/events/event-controls/)、
[SDK 清理](https://web-sdk.pendo.io/public/core/#teardown--void)。

## 远程操作测试

2026-08-30：添加此 README，用于验证远程编辑、Git 提交和 GitHub 推送流程。

## Socket 取消约定

调用 `runtime.cancel()` 即可。Runtime/Source 的 AbortSignal 与 cancel 调用链保持不变，
`BackendTransportAgent.abortRun()` 对同一次 run 做幂等处理，停止本次订阅但保留 WebSocket 连接。
默认发给 BE 的消息为：

```json
{ "event": "cancel", "threadId": "当前后端会话 ID", "runId": "当前后端运行 ID" }
```

- 自定义 `BackendTransport` 需要实现 `cancel(input)` 才能通知 BE；不实现时只停止本地订阅。
- 仅处理已进入 `run()` 的当前运行；不包含初始化阶段的取消追踪或跨 run 的迟到消息过滤。
- 本地取消不代表 BE 已确认停止。发送失败通过 Agent 的错误通道报告，不自动重试，也不等待 BE 回执。

## Transport Agent 工厂

使用 `createAgent()` 按运行时配置创建 WebSocket 或 SSE Agent：

```ts
const agent = createAgent({
  transport: "websocket", // 或 "sse"
  url: backendUrl,
  options: {
    agentId: "default",
    threadId: "thread-id",
    transport: {
      // WebSocket/SSE 对应的 transport options
    },
  },
});
```

`transport` 是判别字段，TypeScript 会据此约束 `options` 并返回对应的 Adapter Agent。两种实现最终都复用 `BackendTransportAgent` 的运行、取消和消息转换逻辑。
