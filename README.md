# Chat Runtime Context

基于 React、TypeScript 和 pnpm 的聊天 Runtime 项目。

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
