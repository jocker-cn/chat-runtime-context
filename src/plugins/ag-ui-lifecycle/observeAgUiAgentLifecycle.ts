import type {
  AbstractAgent,
  AgentSubscriberParams,
} from "@ag-ui/client";
import type {
  AgUiLifecycleNotification,
  ObserveAgUiAgentLifecycleOptions,
} from "./contracts";

type PendingNotification = AgUiLifecycleNotification extends infer TNotification
  ? TNotification extends AgUiLifecycleNotification
    ? Omit<TNotification, "sourceId" | "observedAt">
    : never
  : never;

export function observeAgUiAgentLifecycle(
  agent: AbstractAgent,
  options: ObserveAgUiAgentLifecycleOptions,
): () => void {
  const now = options.now ?? Date.now;
  const notify = (notification: PendingNotification) => {
    options.onNotification({
      ...notification,
      sourceId: options.sourceId,
      observedAt: now(),
    } as AgUiLifecycleNotification);
  };
  const runContext = (
    params: AgentSubscriberParams,
  ) => ({
    input: params.input,
    threadId: params.input.threadId,
    runId: params.input.runId,
    messages: params.messages,
    state: params.state,
  });

  const subscription = agent.subscribe({
    onRunInitialized: (params) => {
      notify({
        type: "run-initialized",
        ...runContext(params),
      });
    },
    onEvent: (params) => {
      notify({
        type: "event",
        ...runContext(params),
        event: params.event,
      });
    },
    onRunFailed: (params) => {
      notify({
        type: "run-failed",
        ...runContext(params),
        error: params.error,
      });
    },
    onRunFinalized: (params) => {
      notify({
        type: "run-finalized",
        ...runContext(params),
      });
    },
    onMessagesChanged: (params) => {
      notify({
        type: "messages-changed",
        input: params.input,
        messages: params.messages,
        state: params.state,
      });
    },
  });

  return () => subscription.unsubscribe();
}
