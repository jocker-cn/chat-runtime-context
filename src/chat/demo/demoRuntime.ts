import type { Message } from "@ag-ui/client";
import { SocketAdapterAgent, WebSocketBackendTransport } from "./adapters/socketAdapter";
import {
  CompareChatRuntime,
  SingleAgentRuntime,
  createAgUiAgentSource,
  createMainBranchHistoryTurns,
} from "../../core";
import { StaticAnswerSource } from "./source/StaticAnswerSource";

export type DemoMessage = Message & {
  pairId?: string;
};

export function createDemoRuntime() {
  return new CompareChatRuntime<string, DemoMessage>({
    threadId: "demo-thread",
    createInputMessage: (input, turnId) => ({
      id: `${turnId}:input`,
      role: "user",
      content: input,
      pairId: `${turnId}:input`,
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
                pairId: `${context.turnId}:a`,
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
                pairId: `${context.turnId}:b`,
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
  deleteLastTurn(): void;
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

  return {
    runtime,
    deleteLastTurn: () => {
      deleteLastTurn(runtime);
    },
  };
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

  return {
    runtime,
    deleteLastTurn: () => {
      deleteLastTurn(runtime);
    },
  };
}

function deleteLastTurn(
  runtime: CompareChatRuntime<string, Message>,
) {
  const snapshot = runtime.getSnapshot();
  const turnId = snapshot.turnIds.at(-1);
  if (!turnId) {
    return;
  }

  runtime.removeTurn(turnId, {
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

function createSourceAMockHistory(): Message[] {
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
      content:
        "建议先处理三件事：补齐回滚条件和负责人；确认灰度指标阈值；把客服和运营通知模板提前准备好。其余风险可以放到发布后观察清单里。",
    },
  ];
}

function createSingleAgentMockHistory(): Message[] {
  return [
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
      content:
        "优先补回滚验证记录。负责人可以临时指定，但回滚记录缺失会直接影响发布风险判断。",
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
