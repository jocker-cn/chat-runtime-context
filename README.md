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
`SocketAdapterAgent.abortRun()` 对同一次 run 做幂等处理，停止本次订阅但保留 WebSocket 连接。
默认发给 BE 的消息为：

```json
{ "event": "cancel", "threadId": "当前后端会话 ID", "runId": "当前后端运行 ID" }
```

- 通过 `WebSocketBackendTransport` 的 `serializeCancel(input)` 可适配不同 BE 协议。
- 初始化或连接建立前取消的未发送 run 不会发给 BE；正常完成或普通退订不发送 cancel。
- BE 应在响应中回传 `runId`（可同时回传 `threadId`），前端会丢弃标识不匹配的迟到消息。
  兼容旧协议的无标识响应仍会接收，但无法区分它是否来自已取消的 run。
- 自定义 `BackendTransport` 需要实现 `cancel(input)` 才能通知 BE；不实现时只停止本地订阅。
- 本地取消不代表 BE 已确认停止。发送失败通过 Agent 的错误通道报告，不自动重试，也不等待 BE 回执。
