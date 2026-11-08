# Pendo 接入

复制整个 `src/features/pendo/` 即可迁移。模块不依赖 React、Next.js、Vite、queue 或聊天 Runtime，不读取环境变量。
没有 Provider、Context、私有事件缓冲或 SDK 销毁流程。

## 根节点放官方脚本

`createPendoScript(config)` 只生成官方安装脚本字符串，不加载 SDK、不管理生命周期。官方 bootstrap 保持原写法，仅填入公司 App ID、visitor/account 和 environment，并保留既有采集限制。
配置关闭时返回空字符串，根节点不渲染 Script。没有 region 参数，固定使用 https://cdn.pendo.io/agent/static/{publicAppId}/pendo.js。

Next.js 根节点示例：

```tsx
import Script from "next/script";
import { createPendoScript } from "@/features/pendo";

const pendoScript = createPendoScript({
  enabled: enabledMarkets.includes(market),
  publicAppId: companyPendoAppId,
  visitorId: String(userId),
  environment,
});

return <>
  {pendoScript && <Script
    id="pendo-install"
    strategy="afterInteractive"
    dangerouslySetInnerHTML={{ __html: pendoScript }}
  />}
  {children}
</>;
```

等待业务用户、market 和环境配置确定后加载一次；不要放在每个聊天 Session 或按钮中。由 next/script 的固定 id 避免重复执行。
普通 HTML 可以将生成的内容放进根节点 script 标签；本地 Vite demo 在应用入口插入该内联 script。
序列化会转义内联脚本结束符，用户字段不会被拼成可执行代码。
脚本中的六个官方占位方法为 initialize、identify、updateOptions、pageLoad、track、trackAgent；SDK 下载前的调用由官方 _q 排队。
脚本额外写入 window.__appPendoConfig 的 enabled/environment，供轻量 client 判断开关、附加环境属性；它不是另一套 SDK 或事件队列。

publicAppId 使用公司订阅下业务 App 的公开安装标识，不传 Integration Key 或 Track Event shared secret。
App ID、用户和环境是页面启动配置；更换后刷新页面。登录切换由宿主使用官方 pendo.identify / clearSession 处理。
关闭配置保证新页面不安装 SDK；不会卸载已经加载的 SDK。运行中需要停止自动采集时，由宿主调用官方 stopSendingEvents，或关闭配置后刷新。
不要同时再粘贴第二份官方安装脚本。

| 参数 | 含义 |
| --- | --- |
| publicAppId | 必传，企业业务 App 的公开安装标识 |
| enabled | 默认 false；宿主传入 market 等条件的结果 |
| visitorId | 用户原始 ID，不拼环境；省略时使用 SDK 的匿名机制 |
| accountId | 可选，真实组织/租户 ID |
| environment | 可选，写入 visitor 元数据及封装提交的自定义事件 |

## 直接调用埋点方法

```ts
import { track, trackAgent, flushNow } from "@/features/pendo";

track({ name: "report_export_requested", properties: { format: "csv" } });

// 用户提交节点
trackAgent("prompt", {
  agentId: pendoAgentId,
  conversationId,
  messageId: promptId,
  content: promptText,
});

// 使用业务自己的回答结束节点；不要对每个 SSE chunk 调用。
trackAgent("agent_response", {
  agentId: pendoAgentId,
  conversationId,
  messageId: responseId,
  content: finalAnswer,
}, { durationMs });

trackAgent("user_reaction", {
  agentId: pendoAgentId,
  conversationId,
  messageId: responseId,
  content: "positive", // 也支持 negative / unreact
});

// 如业务主动离开应用时需要额外 flush：
flushNow({ unload: true });
```

track、trackAgent 和 flushNow 直接调用当前 window.pendo，保留 SDK 方法的调用上下文。
未开启、未初始化、SSR 没有 window、方法不存在或 SDK 抛错时安全忽略，不影响业务。
初始化前不自行缓存；初始化后、SDK 尚在下载时由官方 _q 排队，不再维护 100 条私有缓冲。
environment 由启动配置附加，事件属性不能覆盖它。AI 消息字段与数组提交时复制，避免调用方随后修改队列中的消息。
trackAgent 缺失时不降级为普通 Track Event。模块不监听 SSE、不推断结束、不重试、不去重，也不自动上传历史对话。
先在目标 App 的 Agent Analytics 中建立 Agent，使用取得的 Pendo Agent ID，而不是 App ID 或模型名称。
保留 AgentMessageProperties、AgentReactionProperties、TrackAgent、Track、AnalyticsEvent 类型供业务回调使用。

## 同一个用户按环境统计

用户 ID 保持原值。同一订阅下相同 ID 需要代表同一个人；Visitor 元数据跨 App 共享。
普通 Visitor Data → environment Segment 使用最新元数据，不等于按事件发生时环境拆分。
若要区分同一用户在不同环境的 Page / Feature / Track Event，在公司订阅的 **Settings → Metadata** 为 environment 开启 **Historical metadata**，再在支持的报表/产品使用规则中选择相应的历史事件属性。
从开启后开始记录，不补齐过去的事件。确认其他 App 是否写同名 environment，避免字段覆盖。
普通自定义 Track Event 本身也包含 environment 属性。

参考：[多 App 订阅](https://support.pendo.io/hc/en-us/articles/360035077512-Multi-app-subscriptions)、
[Historical metadata](https://support.pendo.io/hc/en-us/articles/13125305910299-Historical-metadata)。

## 自动采集与退出

保留既有采集限制：禁用 DOM 文本采集、focus/change/submit 自动事件、Guides 和 Session Replay；清除采集 URL 的 query/hash。自动 load/click 保留。
主动提交的 AI 正文、文件名和自定义属性不受 DOM 文本屏蔽限制，内容由业务明确提供。
页面隐藏和 pagehide 时尽力调用 flushNow；不删除 window.pendo、脚本或 SDK 的队列，不为 React 卸载增加隐式销毁。
flush 不等待服务端确认；网络故障、SDK 未加载或浏览器强制关闭仍可能丢失。

自动点击进入当前 App 的 Raw Events；按钮使用统计需要在 Product → Features 标记对应元素。
`src/chat/demo/extension-poc/analytics/` 仍只拥有 demo 的配置与队列/Runtime 观察，业务无需迁移这些 Sidecar。
删除接入时移除根节点初始化调用和业务埋点，再删除本目录；已加载的浏览器页面刷新后生效。

参考：[Conversations API](https://support.pendo.io/hc/en-us/articles/41103585431707-Send-conversation-events-using-the-client-side-or-server-side-API)、
[flushNow](https://web-sdk.pendo.io/public/events/#flushnowoptions--void)、
[身份 API](https://web-sdk.pendo.io/public/identity/)。

## Agent response content

`compactAgentResponse(content)` is an optional pure helper. It replaces fenced code blocks with an omission marker and keeps each Markdown table header and first two data rows. Remaining rows become an omitted-row count. Narrative text and inline code are preserved. Omitted content is unavailable to Pendo analysis.

The caller chooses whether to process the content; `trackAgent` never compacts messages automatically.

```ts
import { compactAgentResponse, trackAgent } from "@/features/pendo";

const content = compactAgentResponse(finalAnswer);
trackAgent("agent_response", {
  agentId: pendoAgentId,
  conversationId,
  messageId: responseId,
  content,
});
```
