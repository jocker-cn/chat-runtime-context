# 单次响应事件查看

模块只保存与展示接入方上报的事件，没有协议、运行状态或开始/结束 API。它不依赖 AG-UI、Runtime、Agent、Message Card 或其他模块的通知类型。

## 上报接口

```ts
const traces = createResponseTraceStore();

// responseId 由调用方选择，用于关联同一次响应。
traces.report("response-123", {
  type: "your-event-type",
  name: "你自己的名称",
  content: originalPayload, // 可选，任意可复制的数据
});
```

只需要自己的 `type`，`name` 可选；时间默认取本次上报时间。没有预置的工具、思考或错误类型枚举。

```ts
type ResponseTraceReport = {
  type: string;
  name?: string;
  content?: unknown;
  id?: string;
  startedAt?: number;
  endedAt?: number;
  details?: unknown;
};
```

不传 `id` 时追加一行；再次上报相同 `id` 时更新该事件，保留首次出现的顺序与默认起点。模块不自动拼接 delta 或推断阶段关系。流式内容如何合并由调用方决定。

```ts
traces.report("response-123", {
  id: "stage-1", type: "custom-stream", name: "正文",
  content: accumulatedText, startedAt: 1000,
});
traces.report("response-123", {
  id: "stage-1", type: "custom-stream",
  content: finalText, endedAt: 1500,
});

// 完成与错误也只是普通事件，不触发模块内部状态转换。
traces.report("response-123", { type: "your-completed-event", name: "完成" });
traces.report("response-123", { type: "your-error-event", name: "错误", content: errorPayload });
```

每次上报生成独立、冻结的只读快照，不修改调用方对象和已返回的旧快照。显示组件不能编辑、取消、重试或执行事件。

## 展示与时间

概览为紧凑时间图和 `event / content` 表格：名称优先展示 `name`，未传时展示 `type`。点击内容或时间条，在同一弹窗内查看完整内容并返回列表；`details` 可在内页折叠查看。

- 总耗时是已上报事件的最早起点到最晚时间点之间的跨度，不是运行生命周期统计。
- 最晚时间点取各事件的 `endedAt ?? startedAt`；未上报的请求等待时间不在其中。
- 各事件耗时仅取明确的起止时间；未提供结束时间则显示“—”，不自动补齐。
- 同一响应的时间应使用同一毫秒基准；重叠区间不相加。
- JSON 可缩进查看，非 JSON 原文展示；不增加类型分类、状态摘要、工具计数或侧栏。

## 在任意组件接入

```tsx
const trace = useResponseTrace(traces, responseId);
const [open, setOpen] = useState(false);

return <>
  <button onClick={() => setOpen(true)}>查看响应过程</button>
  <ResponseTraceDialog open={open} trace={trace} onClose={() => setOpen(false)} />
</>;
```

`useResponseTrace` 直接返回当前记录或 undefined，没有 recording/ready/成功/失败状态。弹窗自行处理关闭和空列表，无需调用方加条件渲染。是否允许生成中打开，由接入方已有业务状态决定。

Message Card 被删除/卸载时入口自然消失，不做消息保活、恢复或自动重建。记录按当前拥有者的生命周期保存在内存中；拥有者释放时调用 `traces.dispose()`。没有跨刷新恢复、全局单例或 Provider。

## AG-UI 接入

使用独立的 `src/plugins/ag-ui-response-trace/` 观察器，不复用或修改原来的 `observeAgUiAgentLifecycle`：

```ts
const traces = createResponseTraceStore();
const observer = createAgUiResponseTraceObserver(traces);
observer.observe(agent, "agent-a");

// 任意消息入口：只用实际消息 ID，不查找 Runtime、Turn 或 Branch。
const responseId = observer.resolveMessage({ sourceId: "agent-a", messageId: message.id });

// 拥有者释放时：
observer.dispose();
traces.dispose();
```

AG-UI 的事件解析、运行 ID 与实际消息 ID 关联、错误上报均在这个独立插件内。标准文本/推理/工具事件由 agUiEvents 处理；当前 demo 的原生内容在转换前作为标准 RAW 事件保留，由 backendEvents 处理，避免原始字段和阶段边界被消息转换丢弃。两种输入不会重复记账。插件不维护记录器的终态。

runtime 只创建和注册观察器并在释放时清理，不配置 parseMessage、不编写 Agent 事件回调、不反查最后一条 user 或扫描 Turn/Branch。旧的生命周期观察器可与新观察器独立使用。

Assistant 与 AI 错误 Card 通过 extensions 获取记录器与消息 ID 解析能力；按钮仍使用自己的 branchStatus。替换协议时只替换相应观察器/事件处理插件，通用记录器与弹窗不变。无需修改 core，未增加 onRunCancelled/captureRawEvents 选项。
