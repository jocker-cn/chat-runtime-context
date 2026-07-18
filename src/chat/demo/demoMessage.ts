import type { Message } from "@ag-ui/client";

export interface DemoMessageAction {
  id: string;
  label: string;
  result: string;
}

export type DemoMessage = Message & {
  actions?: readonly DemoMessageAction[];
  status?: "error";
};

export type DemoAiErrorMessage = DemoMessage & {
  role: "activity";
  activityType: "error";
};

export function isDemoAiErrorMessage(
  message: DemoMessage,
): message is DemoAiErrorMessage {
  return message.role === "activity" && message.activityType === "error";
}
