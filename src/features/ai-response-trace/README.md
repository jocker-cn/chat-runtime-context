# 单次 AI 响应过程查看

录制与消息展示独立：请求前订阅 Agent，按 source/thread/run 保存事件，在 run finalized 后生成只读记录。消息被筛选或清空不删除事件；关闭弹窗不清除记录。没有全局单例或 Provider，数据仅在当前记录域的内存中保存。

## 展示契约

组件不识别工具、思考或其他业务类型。每行由接入方提供：

```ts
type ResponseTraceEntry = {
  id: string;          // 本次响应内唯一
  event: string;       // 接入方定义的名称，原样显示
  content: unknown;    // 列表摘要 / 点击后的完整内容
  startedAt: number;   // 与 trace.startedAt 同一时间基准，毫秒
  endedAt?: number;    // 未上报则耗时显示为 —，不猜测
  details?: unknown;   // 可选的完整数据，在详情页折叠展示
};
```

概览仅包含紧凑的总耗时、事件时间图和 `event / content` 表格。时间图每行使用上报的起止时间；瞬时事件为 0 ms 标记。点击内容或时间条，在同一个弹窗内进入详情页；返回列表恢复滚动和焦点。不增加类型分类、状态摘要、工具计数或侧栏。

总耗时为 run 初始化至 finalize 的浏览器观测间隔。各事件的区间由业务接入方上报，可以重叠，不能相加代替总耗时。需要服务端精确耗时时，接入方应提供同一时间基准的实际起止时间。

## 接入

```tsx
import { useState } from "react";
import {
  createResponseTraceStore, useResponseTrace, ResponseTraceDialog,
} from "./features/ai-response-trace";
import { observeAgUiAgentLifecycle } from "./plugins/ag-ui-lifecycle";

// 会话业务拥有者在首次发送前创建、订阅。
// projectEvents 是接入方的协议整理函数，在结束时调用一次。
// 由业务决定哪些帧属于同一个事件、如何拼接内容、哪里开始/结束。
// 不传 projectEvents 时只按原始 event.type 逐条展示，不分类或合并。
const responseTraces = createResponseTraceStore({ projectEvents: yourEventProjector });
const unsubscribe = observeAgUiAgentLifecycle(agent, {
  sourceId: "agent-a",
  onNotification: responseTraces.record,
});

// ref 来自该次真实响应，不使用“最新一个 run”查找历史消息。
const traceRef = { sourceId: "agent-a", threadId, runId };

// 任意 Card/业务组件拥有自己的按钮与打开状态。
const trace = useResponseTrace(responseTraces, traceRef);
const [open, setOpen] = useState(false);

return <>
  <button disabled={!trace.record} onClick={() => setOpen(true)}>查看响应过程</button>
  <ResponseTraceDialog open={open} trace={trace.record} onClose={() => setOpen(false)} />
</>;

// 会话业务拥有者销毁时：unsubscribe(); responseTraces.dispose();
```

`projectEvents(events)` 输入完整的 `{ sequence, receivedAt, event }` 数组，输出 `ResponseTraceEntry[]`。记录器保留原始字段，复制并冻结输出；不内置任何业务协议转换。弹窗只消费这些通用 entries，也可以独立接收业务构造的 `ResponseTraceRecord`，无需挂载 Runtime。

弹窗内部处理关闭与空记录；无需 `{open && trace.record && ...}`。生成中 hook 不暴露可查看记录；失败、取消和异常结束也能查看已收到的内容。JSON 可缩进查看，非 JSON 原文展示，完整数据不截断。

当前 demo 的 `src/chat/demo/adapters/backendResponseTrace.ts` 负责自己协议的事件上报：合并 thinking/streaming 帧、按实际 ID 关联 function_call/tool_result，提供内容与观测起止时间。未知事件原样保留，缺少结束/返回的事件不上报耗时。原始 BE 帧在有损转换前通过 RAW 事件采集，不复制每个 token 的完整消息快照。

`extensionPocRuntime.ts` 拥有记录器与订阅，使用 Turn/Branch 查找引用，经已有 extensions 暴露 `responseTraces / resolveResponseTrace`。Assistant 与 AI 错误 Card 的可选按钮保持原有接入方式。

本模块不执行工具、不发送请求、不修改 core、临时正文、引用或消息编排。不做搜索、会话级轨迹平台、归档、导出或跨会话缓存。
