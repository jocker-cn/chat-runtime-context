import { EventType } from "@ag-ui/client";
import type {
  ActivitySnapshotEvent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import type {
  ThinkingActivityContent,
  ThinkingActivityPhase,
} from "../thinkingActivity";
import { THINKING_ACTIVITY_TYPE } from "../thinkingActivity";

export type BackendMessage = {
  isCompleted?: boolean;
  event:
    | "run_started"
    | "thinking_started"
    | "thinking_delta"
    | "thinking_completed"
    | "streaming_started"
    | "streaming"
    | "streaming_completed"
    | "function_call"
    | "messages_snapshot"
    | "completed"
    | "error";
  messages?: Message[];
  message?: {
    id?: string;
    content?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
  error?: string;
};

export type BackendMessageConversion = {
  events: BaseEvent[];
  terminal: boolean;
};

export function createBackendMessageEventConverter(input: RunAgentInput) {
  const textMessageIds = new Set<string>();
  const thinkingMessageId = `thinking:${input.runId}`;
  let thinkingPhase: ThinkingActivityPhase = "processing";
  let thinkingText = "";
  let toolCallIndex = 0;

  const thinkingSnapshot = (): ActivitySnapshotEvent => ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: thinkingMessageId,
    activityType: THINKING_ACTIVITY_TYPE,
    content: {
      phase: thinkingPhase,
      text: thinkingText,
    } satisfies ThinkingActivityContent,
    replace: true,
  });

  return {
    start(): BaseEvent[] {
      return [
        {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        },
        thinkingSnapshot(),
      ];
    },

    convert(message: BackendMessage): BackendMessageConversion {
      const events: BaseEvent[] = [];
      const messageId = message.message?.id ?? `assistant-${input.runId}`;
      let terminal = false;

      switch (message.event) {
        case "run_started":
        case "thinking_completed":
          break;
        case "thinking_started":
          thinkingPhase = "thought";
          events.push(thinkingSnapshot());
          break;
        case "thinking_delta":
          thinkingPhase = "thought";
          thinkingText += message.message?.content ?? "";
          events.push(thinkingSnapshot());
          break;
        case "streaming_started":
          thinkingPhase = "answering";
          events.push(thinkingSnapshot());
          textMessageIds.add(messageId);
          events.push({
            type: EventType.TEXT_MESSAGE_START,
            messageId,
            role: "assistant",
          });
          break;
        case "streaming":
          events.push({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: message.message?.content ?? "",
          });
          break;
        case "streaming_completed":
          if (textMessageIds.delete(messageId)) {
            events.push({
              type: EventType.TEXT_MESSAGE_END,
              messageId,
            });
          }
          break;
        case "function_call": {
          const toolCallId = `tool-${input.runId}-${toolCallIndex++}-${
            message.message?.name ?? "unknown"
          }`;
          events.push(
            {
              type: EventType.TOOL_CALL_START,
              toolCallId,
              toolCallName: message.message?.name ?? "unknown",
            },
            {
              type: EventType.TOOL_CALL_ARGS,
              toolCallId,
              delta: JSON.stringify(message.message?.arguments ?? {}),
            },
            {
              type: EventType.TOOL_CALL_END,
              toolCallId,
            },
          );
          break;
        }
        case "messages_snapshot":
          events.push({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: message.messages ?? [],
          });
          break;
        case "completed":
          thinkingPhase = "completed";
          events.push(thinkingSnapshot(), {
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
            outcome: { type: "success" },
          });
          terminal = true;
          break;
        case "error":
          events.push({
            type: EventType.RUN_ERROR,
            message: message.error ?? "Backend error.",
          });
          terminal = true;
          break;
      }

      return { events, terminal };
    },
  };
}
