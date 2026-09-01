import type {
  AgentSubscriberParams,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";

interface AgUiLifecycleNotificationBase {
  sourceId: string;
  observedAt: number;
  messages: AgentSubscriberParams["messages"];
  state: AgentSubscriberParams["state"];
}

interface AgUiRunNotificationBase extends AgUiLifecycleNotificationBase {
  input: RunAgentInput;
  threadId: string;
  runId: string;
}

export type AgUiLifecycleNotification =
  | (AgUiRunNotificationBase & {
      type: "run-initialized";
    })
  | (AgUiRunNotificationBase & {
      type: "event";
      event: BaseEvent;
    })
  | (AgUiRunNotificationBase & {
      type: "run-failed";
      error: Error;
    })
  | (AgUiRunNotificationBase & {
      type: "run-finalized";
    })
  | (AgUiLifecycleNotificationBase & {
      type: "messages-changed";
      input?: RunAgentInput;
      messages: ReadonlyArray<Readonly<Message>>;
    });

export interface ObserveAgUiAgentLifecycleOptions {
  sourceId: string;
  onNotification(notification: AgUiLifecycleNotification): void;
  now?: () => number;
}
