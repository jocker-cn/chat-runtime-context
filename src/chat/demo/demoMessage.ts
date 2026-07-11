import type { Message } from "@ag-ui/client";

export interface DemoMessageAction {
  id: string;
  label: string;
  result: string;
}

export type DemoMessage = Message & {
  actions?: readonly DemoMessageAction[];
};
