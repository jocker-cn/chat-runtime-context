# Pendo 接入

迁移时只复制整个 `src/features/pendo/` 目录。运行时依赖只有 React；不需要 Vite、Next.js 专用包、queue、Chat Runtime 或当前项目的业务数据源。
通用模块不读取 `import.meta.env`、`process.env`、业务路由或 market，所有配置由宿主传入。

## 一次挂载，按 market 开关

`PendoProvider` 挂在 App 或需要分析的业务 layout，包住对应子树；不必每个页面挂一次。
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
若原来已启用，关闭后释放此 Provider 的连接；最后一个使用方退出时清理脚本/SDK并丢弃未发送事件。
同一页面建议只有一个 Provider；相同配置可共享连接，但不同配置的并行 Provider 不会抢占已运行的 SDK。

没有 queue 时，自定义“发送”事件可以放在现有业务实际接收提交的位置；“完成/失败”事件放在最终结果回调或现有状态订阅中。
这些语义由业务定义。自动点击采集本身不能判断一次请求是否成功，不需要为此先迁移 queue。
也可以在业务目录实现一个只读订阅的 sidecar，再调用 `track`；通用目录不保存业务事件名/观察器。

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

SDK 就绪前最多缓冲 100 个自定义事件；脚本失败后丢弃，不自动重试。
清理在微任务中确认最后一个连接退出，以支持 React StrictMode 的 effect 重放。
StrictMode 会重放业务自己的 mount effect；需要恰好一次语义的业务观察器须自行去重，模块不会按同名事件全局去重。
本目录不绑定构建器的 HMR 钩子；修改 SDK 模块实现后完整刷新浏览器。

保留原有采集限制：禁止元素文本、focus/change/submit 自动事件、Guides 和 Session Replay；URL 查询参数和 hash 清除。
自动 load/click 仍启用。自定义 `properties` 由调用方提供，模块不会自动过滤其中的敏感内容，也不会自动屏蔽 URL pathname 中的业务数据。

## 移除

先将 `enabled` 设为 false 即可停用。彻底移除时删掉 Provider、业务里的 `usePendo`/track 调用或观察器，再删除本目录。
通用模块不会修改业务控制器、请求、消息或状态。
