import type { Message } from "@ag-ui/client";
import { SocketAdapterAgent, WebSocketBackendTransport } from "./adapters/socketAdapter";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  createAgUiAgentSource,
  createChatRuntimeQueueTarget,
  createMainBranchHistoryTurns,
  createQueueScheduler,
  createSubmissionQueue,
} from "../../core";
import type { QueueScheduler, SubmissionQueue } from "../../core";
import { StaticAnswerSource } from "./source/StaticAnswerSource";
import type { DemoMessage } from "./demoMessage";

export type { DemoMessage } from "./demoMessage";

export function createDemoRuntime() {
  return new CompareChatRuntime<string, DemoMessage>({
    threadId: "demo-thread",
    createInputMessage: (input, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content: input,
    }),
    sources: [
      {
        branchId: "branch-a",
        label: "Branch A",
        source: new StaticAnswerSource<string, DemoMessage>({
          id: "static-a",
          label: "Branch A",
          resolve: async (input, context) => {
            await delay(200, context.signal);

            return [
              {
                id: `${context.turnId}:a:answer`,
                role: "assistant",
                content: `A answer: ${input}`,
              },
            ];
          },
        }),
      },
      {
        branchId: "branch-b",
        label: "Branch B",
        source: new StaticAnswerSource<string, DemoMessage>({
          id: "static-b",
          label: "Branch B",
          resolve: async (input, context) => {
            await delay(450, context.signal);

            return [
              {
                id: `${context.turnId}:b:answer`,
                role: "assistant",
                content: `B answer: ${input}`,
              },
            ];
          },
        }),
      },
    ],
  });
}

export interface BeComparisonRuntimeOptions {
  websocketUrl?: string;
  threadId?: string;
}

export interface DemoRuntimeController<
  TRuntime extends CompareChatRuntime<string, Message> = CompareChatRuntime<
    string,
    Message
  >,
> {
  runtime: TRuntime;
  queue: SubmissionQueue<DemoSubmission>;
  scheduler: QueueScheduler<DemoSubmission>;
  deleteLastTurn(): Promise<void>;
  dispose(): Promise<void>;
}

export interface DemoSubmission {
  text: string;
  data?: Record<string, unknown>;
  attachments?: readonly unknown[];
}

export function createBeComparisonRuntime({
  websocketUrl = "ws://localhost:8080/ws/copilot",
  threadId = "ab-chat",
}: BeComparisonRuntimeOptions = {}): DemoRuntimeController {
  const sourceAHistoryMessages = createSourceAMockHistory();
  const agentA = createSocketAgent({
    websocketUrl,
    agentId: "agent-a",
    description: "Agent A",
    threadId: `${threadId}:agent-a`,
    initialMessages: sourceAHistoryMessages,
  });
  const agentB = createSocketAgent({
    websocketUrl,
    agentId: "agent-b",
    description: "Agent B",
    threadId: `${threadId}:agent-b`,
  });
  const sourceA = createAgUiAgentSource({
    id: "agent-a",
    label: "Agent A",
    agent: agentA,
  });
  const sourceB = createAgUiAgentSource({
    id: "agent-b",
    label: "Agent B",
    agent: agentB,
  });

  const runtime = new CompareChatRuntime<string, Message>({
    threadId,
    createInputMessage: (input, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content: input,
    }),
    sources: [
      {
        branchId: "agent-a",
        label: "Agent A",
        metadata: {
          agent: agentA,
        },
        source: sourceA,
      },
      {
        branchId: "agent-b",
        label: "Agent B",
        metadata: {
          agent: agentB,
        },
        source: sourceB,
      },
    ],
    historyTurns: createMainBranchHistoryTurns({
      messages: sourceAHistoryMessages,
      sourceBranchId: "agent-a",
      branchLabel: "Agent A",
      getCreatedAt: (_inputMessage, turnIndex) =>
        Date.now() - 1000 * 60 * (10 - turnIndex * 5),
      getSelection: () => ({
        score: 1,
        metadata: {
          sourceId: "agent-a",
          history: true,
        },
      }),
    }),
  });

  return createDemoRuntimeController(runtime);
}

export interface BeSingleRuntimeOptions {
  websocketUrl?: string;
  threadId?: string;
}

export function createBeSingleRuntime({
  websocketUrl = "ws://localhost:8080/ws/copilot",
  threadId = "single-chat",
}: BeSingleRuntimeOptions = {}): DemoRuntimeController<
  SingleAgentRuntime<string, Message>
> {
  const historyMessages = createSingleAgentMockHistory();
  const agent = createSocketAgent({
    websocketUrl,
    agentId: "agent-single",
    description: "Single Agent",
    threadId,
    initialMessages: historyMessages,
  });
  const source = createAgUiAgentSource({
    id: "agent-single",
    label: "Single Agent",
    agent,
  });

  const runtime = new SingleAgentRuntime<string, Message>({
    threadId,
    branchId: "agent-single",
    branchLabel: "Single Agent",
    metadata: {
      agent,
    },
    createInputMessage: (input, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content: input,
    }),
    source,
    historyMessages,
  });

  return createDemoRuntimeController(runtime);
}

function createDemoRuntimeController<
  TRuntime extends CompareChatRuntime<string, Message>,
>(runtime: TRuntime): DemoRuntimeController<TRuntime> {
  const queue = createSubmissionQueue<DemoSubmission>();
  const scheduler = createQueueScheduler({
    queue,
    target: createChatRuntimeQueueTarget<DemoSubmission, string>({
      runtime,
      toInput: (item) => item.payload.text,
    }),
  });

  return {
    runtime,
    queue,
    scheduler,
    deleteLastTurn: () => deleteLastTurn(runtime),
    dispose: async () => {
      scheduler.dispose();
      await runtime.dispose();
    },
  };
}

async function deleteLastTurn(
  runtime: CompareChatRuntime<string, Message>,
) {
  const snapshot = runtime.getSnapshot();
  const turnId = snapshot.turnIds.at(-1);
  if (!turnId) {
    return;
  }

  await runtime.removeTurn(turnId, {
    deleteMessages: true,
    includeInput: true,
  });
}

function createSocketAgent({
  websocketUrl,
  agentId,
  description,
  threadId,
  initialMessages = [],
}: {
  websocketUrl: string;
  agentId: string;
  description: string;
  threadId: string;
  initialMessages?: Message[];
}) {
  return new SocketAdapterAgent(
    new WebSocketBackendTransport(websocketUrl),
    {
      agentId,
      description,
      threadId,
      initialMessages,
    },
  );
}

function createSourceAMockHistory(): DemoMessage[] {
  return [
    {
      id: "history-a-1:user",
      role: "user",
      content: "帮我总结一下发布 ID 2131 的风险。",
    },
    {
      id: "history-a-1:assistant",
      role: "assistant",
      content:
        "已确认发布 ID 2131。当前主要风险集中在发布说明缺少回滚口径、灰度观察指标不完整，以及上线后通知链路需要补充负责人。",
    },
    {
      id: "history-a-2:user",
      role: "user",
      content: "如果今晚发布，优先处理哪几个风险？",
    },
    {
      id: "history-a-2:assistant",
      role: "assistant",
      content: `## 发布风险评估

> **结论：** 今晚可以发布，但必须先关闭 P0 风险，并为 P1 风险指定负责人。

| 优先级 | 风险项 | 当前状态 | 建议动作 |
| :--- | :--- | :---: | :--- |
| P0 | 回滚验证记录 | 未完成 | 补跑回滚演练并上传记录 |
| P0 | 灰度指标阈值 | 待确认 | 明确错误率和延迟阈值 |
| P1 | 客服通知模板 | 草稿 | 发布前完成审核 |

### 今晚执行顺序

1. 运行发布前检查命令。
2. 确认回滚负责人和观察窗口。
3. 完成灰度后再扩大流量。

- [x] 发布说明已完成
- [ ] 回滚记录已归档
- [ ] 观察指标已确认

相关资料：[AG-UI 文档](https://docs.ag-ui.com/)

\`\`\`bash
pnpm release:check --id 2131 --strict
\`\`\``,
      actions: [
        {
          id: "checklist",
          label: "生成检查单",
          result: "检查单已生成：2 个 P0 项、1 个 P1 项等待处理。",
        },
        {
          id: "rollback",
          label: "查看回滚方案",
          result: "回滚方案：停止扩量，回退版本，并持续观察核心指标 15 分钟。",
        },
      ],
    },
  ];
}

function createSingleAgentMockHistory(): DemoMessage[] {
  return [
    {
      id: "history-single-0:assistant",
      role: "assistant",
      content: "test",
    },
    {
      id: "history-single-1:user",
      role: "user",
      content: "先帮我看一下当前发布准备情况。",
    },
    {
      id: "history-single-1:assistant",
      role: "assistant",
      content:
        "当前发布准备还缺两项确认：发布窗口负责人和回滚验证记录。建议先补齐这两项，再进入最终确认。",
    },
    {
      id: "history-single-2:user",
      role: "user",
      content: "如果只能先补一项，应该选哪个？",
    },
    {
      id: "history-single-2:assistant",
      role: "assistant",
      content: `### 建议：优先补回滚验证记录

回滚记录直接决定故障后的恢复可信度，负责人则可以在发布窗口前临时确认。

| 检查项 | 权重 | 结果 |
| --- | ---: | --- |
| 回滚脚本可执行 | 40% | 通过 |
| 数据兼容性验证 | 35% | 待补充 |
| 负责人确认 | 25% | 待确认 |

**下一步：** 执行 \`rollback:verify\`，然后把结果附到发布单。

> 不要在缺少数据兼容性验证时直接扩大灰度范围。`,
      actions: [
        {
          id: "verify",
          label: "开始验证",
          result: "验证任务已创建，等待数据兼容性检查结果。",
        },
      ],
    },
  ];
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
