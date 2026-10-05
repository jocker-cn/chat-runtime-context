import type { ReactNode } from "react";
import type { ToolDefinition } from "./toolRegistry";

/** Runtime presentation contributions. Only definitions/items are serializable. */
export interface ToolMenuAction {
  type: "action";
  definition: ToolDefinition;
  onSelect(): void;
}

export interface ToolMenuGroup {
  type: "group";
  definition: ToolDefinition;
  items: readonly ToolDefinition[];
  onSelect(item: ToolDefinition): void;
  /** Tool-owned content inside the common selectable row; no nested buttons. */
  renderItem?(item: ToolDefinition): ReactNode;
  empty?: ReactNode;
}

export type ToolMenuEntry = ToolMenuAction | ToolMenuGroup;
