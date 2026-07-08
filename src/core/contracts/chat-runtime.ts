import type { Message } from "@ag-ui/client";

export type ChatMode = "single" | "compare";

export type ChatRuntimeStatus = "idle" | "running" | "error" | "closed";

export type ChatBranchStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "error";

export type ChatMetadata = Record<string, unknown>;

export interface ChatBranchSelectionInput<
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  score?: number;
  metadata?: TMetadata;
}

export interface ChatBranchSelection<
  TMetadata extends ChatMetadata = ChatMetadata,
> extends ChatBranchSelectionInput<TMetadata> {
  branchId: string;
  selectedAt: number;
}

export interface ChatTurn<
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  id: string;
  inputMessageId?: string;
  inputMessage?: TMessage;
  branchIds: readonly string[];
  selectedBranchId?: string;
  selection?: ChatBranchSelection;
  createdAt: number;
  metadata?: TMetadata;
}

export interface ChatBranch<
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  id: string;
  turnId: string;
  label?: string;
  sourceId?: string;
  anchorMessageId?: string;
  status: ChatBranchStatus;
  messages: readonly TMessage[];
  error?: unknown;
  metadata?: TMetadata;
}

export interface ChatRuntimeSnapshot<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> {
  mode: ChatMode;
  threadId?: string;
  status: ChatRuntimeStatus;
  activeTurnId?: string;
  turnIds: readonly string[];
  turnsById: Readonly<Record<string, ChatTurn<TMessage, TTurnMetadata>>>;
  branchesById: Readonly<Record<string, ChatBranch<TMessage, TBranchMetadata>>>;
  error?: unknown;
}

export interface ChatRunHandle {
  turnId: string;
  branchIds: readonly string[];
}

export interface ChatRunOptions<
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  turnId?: string;
  inputMessage?: TMessage;
  branchIds?: readonly string[];
  metadata?: TMetadata;
}

export interface ChatCancelTarget {
  turnId?: string;
  branchId?: string;
}

export interface ChatRuntimeResetOptions {
  threadId?: string;
  mode?: ChatMode;
}

export interface ChatRuntime<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> {
  subscribe(listener: () => void): () => void;

  getSnapshot(): ChatRuntimeSnapshot<
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >;

  send(
    input: TInput,
    options?: ChatRunOptions<TMessage>,
  ): Promise<ChatRunHandle>;

  cancel(target?: ChatCancelTarget): Promise<void> | void;

  selectBranch(
    turnId: string,
    branchId: string,
    selection?: ChatBranchSelectionInput,
  ): Promise<void> | void;

  reset(options?: ChatRuntimeResetOptions): Promise<void> | void;

  dispose(): Promise<void> | void;
}
