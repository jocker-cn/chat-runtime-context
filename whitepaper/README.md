# Chat Runtime Core Interactive Whitepaper

白皮书位于当前项目内，但使用独立 Vite 入口，不参与现有 Demo 的 `pnpm build`。

## Commands

```bash
pnpm whitepaper:dev
pnpm whitepaper:test
pnpm whitepaper:build
```

构建完成后只有一个可移植文件：

```text
whitepaper/dist/ChatRuntimeCoreWhitepaper.html
```

该文件内联 JavaScript、CSS、架构内容和生命周期视图使用的 React Flow，不依赖 CDN 或其他静态资源。导航使用 URL hash，因此可以直接从本地文件打开。

## Content model

- `src/data/architecture.ts`：静态架构 Scene、组件职责、字段和源码映射。
- `src/data/containment.ts`：架构页的递归组件包含结构；使用可读的原生 DOM，不做画布缩放。
- `src/data/scenarios.ts`：确定性生命周期事件。
- `src/lib/simulator.ts`：纯 reducer/replay，不连接真实 Runtime。
- `src/data/integration.ts`：最小接入步骤和可复制示例。

静态组件定义与动态 Turn/Branch/Message/Card 实例必须保持分离。动态演示不能修改架构 Scene 数据。

## Confluence checklist

在正式上传前确认：

1. Confluence Cloud 或 Data Center。
2. HTML 附件是否允许执行内联脚本，而不只是下载或预览源码。
3. 是否提供 HTML/iframe macro 或 Forge Custom UI。
4. 单附件大小限制是否高于最终 HTML 大小。
5. 内部安全策略是否允许 React Flow 使用的内联 style/script。

如果附件不执行脚本，可把同一个 HTML 部署到内部 HTTPS 地址，再通过 iframe macro 嵌入。
