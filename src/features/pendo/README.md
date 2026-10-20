# Pendo 接入

迁移时只复制整个 `src/features/pendo/` 目录。运行时依赖只有 React；不需要 Vite、Next.js 专用包、queue、Chat Runtime 或当前项目的业务数据源。
通用模块不读取 `import.meta.env`、`process.env`、业务路由或 market，所有配置由宿主传入。

## 一次挂载，按 market 开关

`PendoProvider` 挂在 App 或需要分析的业务 layout，包住对应子树；不必每个页面挂一次。
在 Next.js 中放在持久的 layout/应用 Provider 组合层，避免因聊天 session 切换而改变 Provider 的 key 或重新挂载。
这是本项目对 Pendo 浏览器 SDK 的 React Context 封装；SDK 连接属于应用/浏览器页面，聊天 session 的观察与清理属于业务组件。
保持 Provider 挂载，通过 `enabled` 控制，不需要在每个埋点处判断 market。
`enabled` 默认 `false`；Public App ID 缺失/无效时也保持关闭。

```tsx
"use client";

import type { ReactNode } from "react";
import { PendoProvider } from "@/features/pendo";

const enabledMarkets = new Set(["us", "eu"]); // 换成业务自己的名单

export function BusinessAnalytics({ children, publicAppId, market, analyticsAllowed, visitorId }: {
  children: ReactNode;
  publicAppId: string;
  market: string;
  analyticsAllowed: boolean;
  visitorId?: string;
}) {
  return <PendoProvider
    publicAppId={publicAppId}
    enabled={enabledMarkets.has(market) && analyticsAllowed}
    visitorId={visitorId}
    region="io"
    environment="development"
  >{children}</PendoProvider>;
}
```

market 白名单只是示例，`region` 是 Pendo 应用的数据区域，两者没有自动映射关系。
根据现有登录/权限/配置状态传入 market、analyticsAllowed 和稳定用户 ID；未知状态可先关闭。
`analyticsAllowed` 表示业务自己的总开关，不是模块新增的权限或确认流程。

### Next.js App Router

通用 Provider 文件已经包含 `"use client"`。上面的业务包装组件同样是 Client Component。
在服务端 layout 中组合它，或者在已有客户端 App 壳内使用它均可：

```tsx
// app/layout.tsx（Server Component）
import type { ReactNode } from "react";
import { BusinessAnalytics } from "./BusinessAnalytics";

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html><body>
    <BusinessAnalytics
      publicAppId={process.env.NEXT_PUBLIC_PENDO_PUBLIC_APP_ID ?? ""}
      market="us"
      analyticsAllowed={true}
    >{children}</BusinessAnalytics>
  </body></html>;
}
```

示例里的 market 和总开关应替换为真实业务状态；若它们会在运行中变化，由客户端业务包装组件读取现有状态再传给 Provider。
Public App ID 可来自宿主环境变量、接口配置或普通参数。环境变量的读取只发生在宿主，模块本身不要求任何变量名。
`NEXT_PUBLIC_*` 是公开的构建期配置；需要运行时配置时由宿主动态读取配置并传参。
只传 Pendo 的 Public App ID，不传服务端 Integration Key 或 Track Event shared secret。

Pages Router 同样可在 `pages/_app.tsx` 的客户端应用树中包一次 Provider。
服务端导入/渲染不会读取浏览器全局对象或加载 SDK，SDK 仅在客户端 effect 中加载。

参考：[Next.js Server/Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)、
[环境变量](https://nextjs.org/docs/app/guides/environment-variables)。

## 可选业务事件

自动 Page/Feature 采集只需 Provider 和 Pendo 后台标签，无需任何 ChatSidecar。
自定义业务事件通过 `usePendo().track`；它只接受事件名称与属性，不依赖队列或特定业务对象：

```tsx
"use client";

import { usePendo } from "@/features/pendo";

export function ExportButton({ exportReport }: { exportReport(): void }) {
  const { track } = usePendo();
  return <button onClick={() => {
    exportReport();
    track({ name: "report_export_requested", properties: { format: "csv" } });
  }}>导出</button>;
}
```

不需要在调用前判断 `enabled`。关闭、没有 Provider、无效配置、SDK 被拦截或上报异常时，分析调用不会阻止原有业务操作。
`enabled=false` 时不加载 SDK、不缓存或发送业务事件；切回启用不会补发关闭期间的事件。
若原来已启用，关闭后释放此 Provider 的连接；最后一个使用方关闭时清理脚本/SDK并丢弃封装中的未发送事件，不显式 flush。
正常卸载最后一个 Provider 时则在清理前尽力 flush，详见下文；配置/身份切换不执行这次卸载 flush。
同一页面建议只有一个 Provider；相同配置可共享连接，但不同配置的并行 Provider 不会抢占已运行的 SDK。

没有 queue 时，自定义“发送”事件可以放在现有业务实际接收提交的位置；“完成/失败”事件放在最终结果回调或现有状态订阅中。
这些语义由业务定义。自动点击采集本身不能判断一次请求是否成功，不需要为此先迁移 queue。
也可以在业务目录实现一个只读订阅的 sidecar，再调用 `track`；通用目录不保存业务事件名/观察器。

## AI 对话事件：由业务节点主动提交

`usePendo().trackAgent(eventType, agenticProperties, properties?)` 封装 Pendo Conversations API，
与普通 `track` 共用现有 Provider、SDK、就绪前缓冲、禁用保护和退出 flush。
无需增加 Provider、queue、Runtime 或 `PendoChatSidecar`；通用模块不订阅消息、不接管 SSE，也不判断回答何时结束。
现有 demo 不会自动上传任何对话正文；只有宿主显式调用 `trackAgent` 才提交该内容。

先在 Pendo **Product → Agent Analytics → Add agent** 中为目标 App 创建 Agent，启用 **Full conversations**，取得其 Agent ID。
`agentId` 是 Pendo Agent 标识，不是 `publicAppId`、模型名称或业务内部 Agent 名称。

```tsx
"use client";

import { usePendo, type AgentReactionProperties } from "@/features/pendo";

// 示例业务 hook；也可以直接把 trackAgent 调用放进现有聊天组件的回调。
export function useChatAnalytics(pendoAgentId: string) {
  const { trackAgent, track } = usePendo();

  // 1. 业务实际接收一条用户提交时。
  function onPromptSubmitted(sessionId: string, messageId: string, text: string) {
    trackAgent("prompt", {
      agentId: pendoAgentId, conversationId: sessionId, messageId, content: text,
    });
  }

  // 2. 你们自己的回答结束节点：传入已经汇总完成的最终文本。
  function onAnswerCompleted(sessionId: string, messageId: string, finalText: string, elapsedMs: number) {
    trackAgent("agent_response", {
      agentId: pendoAgentId, conversationId: sessionId, messageId, content: finalText,
    }, { duration: elapsedMs }); // 可选的普通事件属性，单位由业务约定
  }

  // 3. 用户评价时，复用被评价回答的 messageId。
  function onReaction(sessionId: string, responseMessageId: string, reaction: AgentReactionProperties["content"]) {
    trackAgent("user_reaction", {
      agentId: pendoAgentId, conversationId: sessionId,
      messageId: responseMessageId, content: reaction, // positive / negative / unreact
    });
  }

  // 失败/取消仍走普通业务事件，不伪造一条已完成的 AI 回答。
  function onRunFailed() {
    track({ name: "ai_run_finished", properties: { outcome: "error" } });
  }

  return { onPromptSubmitted, onAnswerCompleted, onReaction, onRunFailed };
}
```

在聊天组件中调用示例 hook，把返回的函数接到业务已有节点即可；不在模块顶层调用 hook 或执行埋点。

| API / 字段 | 约定 |
| --- | --- |
| `trackAgent("prompt", ...)` | 每条实际提交的提问调用一次，不是在每次输入或按钮渲染时调用 |
| `trackAgent("agent_response", ...)` | 每条完整回答调用一次；以业务明确的结束节点为准，不按 SSE 分片或连接关闭上报 |
| `trackAgent("user_reaction", ...)` | 评价及取消评价时调用；`content` 类型限制为 positive / negative / unreact |
| `agentId` / `conversationId` / `messageId` / `content` | 必传，均为字符串；不会由封装随机生成或推断 |
| `conversationId` | 同一聊天会话一致；若不同环境/租户的会话 ID 可能重复，由宿主添加稳定前缀 |
| `messageId` | 同一会话内消息唯一，提问和回答不同；反馈使用对应回答 ID；重试时保持原消息 ID |
| `agentModelsUsed` / `toolsUsed` / `agentSubagentsUsed` | 可选字符串数组，封装不推断模型、工具或子 Agent |
| `agentFilesUploaded` | 可选 `{ type, name }[]`，只传文件元信息，不传文件正文 |
| `agentUserReactionComments` | 仅评价事件，可选字符串数组 |
| 第三个参数 `properties` | 可选普通事件属性；配置了 environment 时封装自动附加，以 Provider 配置值为准 |

导出的 `TrackAgent`、`AgentMessageProperties`、`AgentReactionProperties` 类型可直接用于业务回调参数。
同一会话不同轮次保持 conversationId，消息 ID 稳定；封装不本地去重，不补发历史消息，也不在失败后自动重试。
挂载 effect 可能在 StrictMode 重放，业务必须避免把历史加载或重复结束通知当作新消息。
SDK 未提供 `trackAgent` 或调用抛错时安全忽略，不降级为普通 `track`，因为后者不能填充 Agent Analytics。

`content`、文件名和文字反馈由调用方主动提供；现有 `excludeAllText: true` 只限制自动 DOM 文本采集，不能屏蔽这些主动上传的内容。
需要按环境/market 单独控制 AI 内容或脱敏时，由宿主在这些业务调用前按自身配置处理；普通埋点可继续使用。
本封装只提供对话事件，不生成后端 trace、token 数或工具执行轨迹。

参考：[Conversations API](https://support.pendo.io/hc/en-us/articles/41103585431707-Send-conversation-events-using-the-client-side-or-server-side-API)、
[对话字段](https://support.pendo.io/hc/en-us/articles/51793357149467-Conversation-properties)。

## 参数和生命周期

| 参数 | 含义 |
| --- | --- |
| `publicAppId` | 必传，Pendo Web 应用的公开安装标识 |
| `enabled` | 默认 false；由宿主合并 market、环境或其他条件 |
| `region` | 默认 io；支持 io/eu/jpn/au/us1，与 Pendo 应用区域一致 |
| `visitorId` | 可选，稳定用户标识；不传时按 App ID 保存随机 anonymous 身份 |
| `accountId` | 可选，组织/租户标识 |
| `environment` | 可选，写入 visitor 和自定义事件；模块不假定 local |

配置内容不变时，普通重渲染不重复初始化。Public App ID、区域、身份或环境变更时释放旧连接并重新初始化，旧身份的缓冲事件会丢弃。
匿名 ID 使用 `pendo-sidecar:<App ID>:visitor` 保存；存储不可用时退化为当前页面内存身份。
未传 `visitorId` 时不会继承此 demo 旧版本的 `local-…` 身份。
已有其他来源的 `window.pendo` 时不会接管或清理它；宿主应避免重复安装。

SDK 就绪前最多缓冲 100 个事件（普通 track 与 trackAgent 共用额度及顺序）；脚本失败后丢弃，不自动重试。
AI 对话入队时复制消息字段及模型/工具/附件/评价数组，避免调用方随后修改消息对象而改变已接收的事件。
清理在微任务中确认最后一个连接退出，以支持 React StrictMode 的 effect 重放。
已启用且 SDK 就绪时，模块监听 `visibilitychange` 和 `pagehide`：页面隐藏时调用
`flushNow({ hidden: true })`，页面离开时调用 `flushNow({ unload: true })`。
最后一个 Provider 正常卸载时也先调用 `flushNow({ unload: true })`，再执行 teardown、移除脚本和监听器。
flush 前会同步把封装中已接收的事件交给 SDK，减少“track 后同一轮任务立刻离开”的丢失窗口；通常的业务 track 仍将 SDK 调用延后到微任务。
market 禁用、无效配置、身份/应用切换和脚本加载失败时丢弃旧缓冲，不显式 flush；StrictMode 重挂载与仍有共享使用方时不做卸载 flush。
`flushNow` 返回 void，调用不等待服务端确认。SDK 未就绪、网络故障或浏览器被强制结束时仍可能丢失；不会阻止导航、延迟业务或为其添加重试循环。
SDK 不支持 flushNow 或调用抛错时按 best effort 忽略，仍继续清理。
StrictMode 会重放业务自己的 mount effect；需要恰好一次语义的业务观察器须自行去重，模块不会按同名事件全局去重。
本目录不绑定构建器的 HMR 钩子；修改 SDK 模块实现后完整刷新浏览器。

保留原有采集限制：禁止元素文本、focus/change/submit 自动事件、Guides 和 Session Replay；URL 查询参数和 hash 清除。
自动 load/click 仍启用。自定义 `properties` 由调用方提供，模块不会自动过滤其中的敏感内容，也不会自动屏蔽 URL pathname 中的业务数据。

自动点击不会出现在 Track Events 列表。调试时进入 Settings → Subscription settings → Applications → 当前应用 → Raw Events 查看 click；
若需按钮的使用统计，在 Product → Features 中通过 Tag Features 标记按钮并命名，再查看 Feature 详情或添加到 Dashboard。
Raw Events 高流量时可能抽样展示；必要时使用 Pendo SDK debugger 的事件日志验证采集。
参考：[事件类型与后台入口](https://support.pendo.io/hc/en-us/articles/23335876011803-Events-overview)、
[flushNow API](https://web-sdk.pendo.io/public/events/#flushnowoptions--void)。

## 移除

先将 `enabled` 设为 false 即可停用。彻底移除时删掉 Provider、业务里的 `usePendo`/track/trackAgent 调用或观察器，再删除本目录。
通用模块不会修改业务控制器、请求、消息或状态。
