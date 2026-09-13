import type { Message } from "@ag-ui/client";

export interface DemoMessageAction {
  id: string;
  label: string;
  result: string;
}

export type DemoMessage = Message & {
  actions?: readonly DemoMessageAction[];
  referencedMessageId?: string;
  status?: string;
};

export function getDemoMessageText(message: Message) {
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text") {
          return part.text;
        }

        return `[${part.type}]`;
      })
      .join("\n");
  }

  return "";
}

export type DemoAiErrorMessage = DemoMessage & {
  role: "activity";
  activityType: string;
};

export function isDemoAiErrorMessage(
  message: DemoMessage,
): message is DemoAiErrorMessage {
  return (
    message.role === "activity" &&
    message.activityType?.trim()?.toLowerCase() === "error"
  );
}
