import {
  addAssistantErrorMessage,
  AgUiAgentSource,
  CompareChatRuntime,
  clearErrorMessagesBeforeSend,
  createChatRuntimeQueueTarget,
  createMainBranchHistoryTurns,
  createQueueScheduler,
  createSubmissionQueue,
  type AssistantErrorMessageInput,
  type QueueScheduler,
  type SubmissionQueue,
} from "../../../core";
import { createAgent } from "../adapters/createAgent";
import type { DemoMessage } from "../demoMessage";
import { createResponseTraceStore, type ResponseTraceRef, type ResponseTraceStore } from "../../../features/ai-response-trace";
import { observeAgUiAgentLifecycle } from "../../../plugins/ag-ui-lifecycle";
import { projectBackendResponseTrace } from "../adapters/backendResponseTrace";
import { EventType } from "@ag-ui/client";

export interface ChatSubmission {
  text: string;
  referencedMessageId?: string;
  data?: Record<string, unknown>;
  attachments?: readonly unknown[];
}

export interface ExtensionPocRuntimeOptions {
  websocketUrl?: string;
  threadId?: string;
  history?: readonly DemoMessage[];
}

export interface ExtensionPocRuntimeController {
  runtime: CompareChatRuntime<string, DemoMessage>;
  queue: SubmissionQueue<ChatSubmission>;
  scheduler: QueueScheduler<ChatSubmission>;
  responseTraces: ResponseTraceStore;
  resolveResponseTrace(context: { turnId: string; branchId: string }): ResponseTraceRef | undefined;
  /** Changes sources for subsequent dispatches, without cancelling an active run. */
  setSecondaryAgentEnabled(enabled: boolean): void;
  /** Always creates a separate error Turn after the target run and Runtime settle. */
  submitBranchError(branchId: string, error: AssistantErrorMessageInput<DemoMessage>): Promise<void>;
  dispose(): Promise<void>;
}

export function createExtensionPocRuntime({
  websocketUrl = "ws://localhost:8080/ws/copilot",
  threadId = "extension-poc",
  history = [],
}: ExtensionPocRuntimeOptions = {}): ExtensionPocRuntimeController {
  let secondaryAgentEnabled = true;
  let disposed = false;
  const responseTraces = createResponseTraceStore({ projectEvents: projectBackendResponseTrace });
  const traceRefs = new Map<string, ResponseTraceRef>();
  const stopObserving: (() => void)[] = [];
  const sources = ["agent-a", "agent-b"].map((branchId, index) => {
    const label = index === 0 ? "Agent A" : "Agent B";
    const agent = createAgent({
      transport: "websocket",
      url: websocketUrl,
      options: {
        agentId: branchId,
        description: label,
        threadId: `${threadId}:${branchId}`,
        // The mock initializes both agents with context; history rendering remains on A.
        initialMessages: structuredClone([...history]),
        handleRunErrors: true,
        captureRawEvents: true,
        onRunCancelled: (input) => responseTraces.markCancelled({ sourceId: branchId, threadId: input.threadId, runId: input.runId }),
      },
    });
    return { branchId, label, metadata: { agent }, source: new AgUiAgentSource<string>({ id: branchId, label, agent }) };
  });
  const runtime = new CompareChatRuntime<string, DemoMessage>({
    threadId,
    createInputMessage: (input, turnId) => ({ id: `${turnId}:input`, role: "user", content: input }),
    sources,
    historyTurns: createMainBranchHistoryTurns({ messages: history, sourceBranchId: "agent-a" }),
  });
  for (const { branchId: sourceId, metadata: { agent } } of sources) {
    stopObserving.push(observeAgUiAgentLifecycle(agent, {
      sourceId,
      onNotification: (notification) => {
        try {
          // RAW frames retain fields and thinking boundaries discarded by the UI mapper.
          // Do not retain each synthetic full-text activity snapshot as well.
          if (notification.type !== "event" || [EventType.RAW, EventType.RUN_STARTED, EventType.RUN_FINISHED, EventType.RUN_ERROR].includes(notification.event.type)) {
            responseTraces.record(notification);
          }
          if (notification.type === "run-initialized") {
            const inputId = [...notification.input.messages].reverse().find((message) => message.role === "user")?.id;
            const snapshot = runtime.getSnapshot();
            const turn = Object.values(snapshot.turnsById).find((item) => item.inputMessageId === inputId);
            const branchId = turn?.branchIds.find((id) => snapshot.branchesById[id]?.sourceId === sourceId);
            if (turn && branchId) traceRefs.set(JSON.stringify([turn.id, branchId]), {
              sourceId, threadId: notification.threadId, runId: notification.runId,
            });
          }
        } catch (error) { console.error("Failed to record response trace.", error); }
      },
    }));
  }
  const queue = createSubmissionQueue<ChatSubmission>();
  const target = createChatRuntimeQueueTarget<ChatSubmission, string>({
    runtime,
    toInput: (item) => item.payload.text,
    toRunOptions: (item) => ({
      branchIds: secondaryAgentEnabled ? undefined : ["agent-a"],
      ...(item.payload.referencedMessageId ? {
        inputMessage: {
          id: `${item.id}:input`,
          role: "user" as const,
          content: item.payload.text,
          referencedMessageId: item.payload.referencedMessageId,
        },
      } : {}),
    }),
  });
  const scheduler = createQueueScheduler({
    queue,
    target: {
      ...target,
      dispatch: async (item, context) => {
        await clearErrorMessagesBeforeSend(runtime);
        await target.dispatch(item, context);
      },
    },
  });

  return {
    runtime,
    queue,
    scheduler,
    responseTraces,
    resolveResponseTrace: ({ turnId, branchId }) => traceRefs.get(JSON.stringify([turnId, branchId])),
    setSecondaryAgentEnabled: (enabled) => { secondaryAgentEnabled = enabled; },
    submitBranchError: async (branchId, error) => {
      const sourceId = runtime.getSnapshot().branchesById[branchId]?.sourceId;
      if (!sourceId) throw new Error(`Unknown Agent branch: ${branchId}`);
      while (!disposed && runtime.getSnapshot().status === "running") {
        await waitUntilRuntimeStopsRunning(runtime);
      }
      if (disposed || runtime.getSnapshot().status === "closed") {
        throw new Error("Chat session closed; error submission cancelled.");
      }
      await addAssistantErrorMessage(runtime, error, sourceId);
    },
    dispose: async () => {
      disposed = true;
      scheduler.dispose();
      await runtime.dispose();
      stopObserving.forEach((stop) => stop());
      traceRefs.clear();
      responseTraces.dispose();
    },
  };
}

/** Persist the first Agent's transcript, matching the normal history loading path. */
export function readChatHistory(runtime: CompareChatRuntime<string, DemoMessage>): DemoMessage[] {
  const snapshot = runtime.getSnapshot();
  return snapshot.turnIds.flatMap((id) => {
    const turn = snapshot.turnsById[id]!;
    const branch = turn.branchIds.map((branchId) => snapshot.branchesById[branchId]!)
      .find((item) => item.sourceId === "agent-a");
    return branch ? [
      ...(turn.inputMessage ? [turn.inputMessage] : []),
      ...branch.messageReader.getMessages().filter((message) => message.id !== turn.inputMessageId),
    ] : [];
  });
}

function waitUntilRuntimeStopsRunning(runtime: CompareChatRuntime<string, DemoMessage>): Promise<void> {
  if (runtime.getSnapshot().status !== "running") return Promise.resolve();
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const checkStatus = () => {
      if (runtime.getSnapshot().status === "running") return;
      unsubscribe();
      resolve();
    };
    unsubscribe = runtime.subscribe(checkStatus);
    checkStatus();
  });
}

