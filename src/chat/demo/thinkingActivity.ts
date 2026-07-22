import type { ActivityMessage, Message } from "@ag-ui/client";

export const THINKING_ACTIVITY_TYPE = "thinking";

export type ThinkingActivityPhase =
  | "processing"
  | "thought"
  | "answering"
  | "completed";

export interface ThinkingActivityContent {
  [key: string]: unknown;
  phase: ThinkingActivityPhase;
  text: string;
}

export type ThinkingActivityMessage = Omit<
  ActivityMessage,
  "activityType" | "content"
> & {
  activityType: typeof THINKING_ACTIVITY_TYPE;
  content: ThinkingActivityContent;
};

export function isThinkingActivityMessage(
  message: Message,
): message is ThinkingActivityMessage {
  if (
    message.role !== "activity" ||
    message.activityType !== THINKING_ACTIVITY_TYPE
  ) {
    return false;
  }

  const phase = message.content.phase;

  return (
    (phase === "processing" ||
      phase === "thought" ||
      phase === "answering" ||
      phase === "completed") &&
    typeof message.content.text === "string"
  );
}
