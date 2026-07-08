import type { Message } from "@ag-ui/client";
import { SocketAdapterAgent, WebSocketBackendTransport } from "./adapters/socketAdapter";
import { AgUiAgentSource } from "./source/AgUiAgentSource";
import { CompareChatRuntime } from "../../core/runtime/CompareChatRuntime";
import { SingleAgentRuntime } from "../../core/runtime/SingleAgentRuntime";
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

export function createBeComparisonRuntime({
  websocketUrl = "ws://localhost:8080/ws/copilot",
  threadId = "ab-chat",
}: BeComparisonRuntimeOptions = {}) {
  const agentA = createSocketAgent({
    websocketUrl,
    agentId: "agent-a",
    description: "Agent A",
    threadId: `${threadId}:agent-a`,
  });
  const agentB = createSocketAgent({
    websocketUrl,
    agentId: "agent-b",
    description: "Agent B",
    threadId: `${threadId}:agent-b`,
  });

  return new CompareChatRuntime<string, Message>({
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
        source: new AgUiAgentSource({
          id: "agent-a",
          label: "Agent A",
          agent: agentA,
        }),
      },
      {
        branchId: "agent-b",
        label: "Agent B",
        metadata: {
          agent: agentB,
        },
        source: new AgUiAgentSource({
          id: "agent-b",
          label: "Agent B",
          agent: agentB,
        }),
      },
    ],
  });
}

export interface BeSingleRuntimeOptions {
  websocketUrl?: string;
  threadId?: string;
}

export function createBeSingleRuntime({
  websocketUrl = "ws://localhost:8080/ws/copilot",
  threadId = "single-chat",
}: BeSingleRuntimeOptions = {}) {
  const agent = createSocketAgent({
    websocketUrl,
    agentId: "agent-single",
    description: "Single Agent",
    threadId,
  });

  return new SingleAgentRuntime<string, Message>({
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
    source: new AgUiAgentSource({
      id: "agent-single",
      label: "Single Agent",
      agent,
    }),
  });
}

function createSocketAgent({
  websocketUrl,
  agentId,
  description,
  threadId,
}: {
  websocketUrl: string;
  agentId: string;
  description: string;
  threadId: string;
}) {
  return new SocketAdapterAgent(
    new WebSocketBackendTransport(websocketUrl),
    {
      agentId,
      description,
      threadId,
      initialMessages: [],
    },
  );
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
