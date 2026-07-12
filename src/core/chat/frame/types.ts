import type { Message } from "@ag-ui/client";
import type {
  ChatBranchStatus,
  ChatMetadata,
  ChatMode,
  MessageReader,
} from "../contracts/chat-runtime";

export interface MessageRenderContext {
  threadId?: string;
  turnId: string;
  branchId: string;
  branchLabel?: string;
  branchStatus?: ChatBranchStatus;
  branchMetadata?: ChatMetadata;
  sourceId?: string;
  messageReader?: MessageReader;
  selectedBranchId?: string;
  isSelectedBranch: boolean;
  groupId: string;
  entityId: string;
  messageIndex: number;
  groupIndex: number;
  branchIndex: number;
  mode: ChatMode;
}

export interface MessageGroup<TMessage extends Message = Message> {
  id: string;
  turnId: string;
  branchId: string;
  messageStartIndex: number;
  items: readonly TMessage[];
}

export interface MessageGroupContext {
  threadId?: string;
  turnId: string;
  branchId: string;
}
