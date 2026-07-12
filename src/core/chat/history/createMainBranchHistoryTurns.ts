import type { Message } from "@ag-ui/client";
import type {
  ChatBranchSelectionInput,
  ChatMetadata,
} from "../contracts/chat-runtime";
import type { CompareChatRuntimeHistoryTurn } from "../runtime/CompareChatRuntime";

export interface CreateMainBranchHistoryTurnsOptions<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> {
  messages: readonly TMessage[];
  sourceBranchId?: string;
  branchLabel?: string;
  isInputMessage?: HistoryInputMessagePredicate<TMessage>;
  isBranchMessage?: HistoryBranchMessagePredicate<TMessage>;
  createTurnId?: HistoryTurnIdFactory<TMessage>;
  getCreatedAt?: HistoryCreatedAtFactory<TMessage>;
  getTurnMetadata?: HistoryTurnMetadataFactory<TMessage, TTurnMetadata>;
  getBranchMetadata?: HistoryBranchMetadataFactory<TMessage, TBranchMetadata>;
  getSelection?: HistorySelectionFactory<TMessage, TBranchMetadata>;
}

export type HistoryInputMessagePredicate<TMessage extends Message = Message> = (
  message: TMessage,
  index: number,
  messages: readonly TMessage[],
) => boolean;

export interface HistoryBranchMessageContext<
  TMessage extends Message = Message,
> {
  inputMessage: TMessage;
  turnIndex: number;
  messageIndex: number;
  messages: readonly TMessage[];
}

export type HistoryBranchMessagePredicate<
  TMessage extends Message = Message,
> = (
  message: TMessage,
  context: HistoryBranchMessageContext<TMessage>,
) => boolean;

export type HistoryTurnIdFactory<TMessage extends Message = Message> = (
  inputMessage: TMessage,
  turnIndex: number,
) => string;

export type HistoryCreatedAtFactory<TMessage extends Message = Message> = (
  inputMessage: TMessage,
  turnIndex: number,
) => number | undefined;

export type HistoryTurnMetadataFactory<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
> = (
  inputMessage: TMessage,
  turnIndex: number,
) => TTurnMetadata | undefined;

export type HistoryBranchMetadataFactory<
  TMessage extends Message = Message,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> = (
  inputMessage: TMessage,
  turnIndex: number,
) => TBranchMetadata | undefined;

export type HistorySelectionFactory<
  TMessage extends Message = Message,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> = (
  inputMessage: TMessage,
  turnIndex: number,
) => ChatBranchSelectionInput<TBranchMetadata> | undefined;

export function createMainBranchHistoryTurns<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>({
  messages,
  sourceBranchId,
  branchLabel,
  isInputMessage = defaultIsInputMessage,
  isBranchMessage = defaultIsBranchMessage,
  createTurnId = defaultCreateTurnId,
  getCreatedAt,
  getTurnMetadata,
  getBranchMetadata,
  getSelection,
}: CreateMainBranchHistoryTurnsOptions<
  TMessage,
  TTurnMetadata,
  TBranchMetadata
>): CompareChatRuntimeHistoryTurn<
  TMessage,
  TTurnMetadata,
  TBranchMetadata
>[] {
  const turns: CompareChatRuntimeHistoryTurn<
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >[] = [];
  let activeInput: TMessage | undefined;
  let activeMessageIds: string[] = [];

  const flushActiveTurn = () => {
    if (!activeInput || activeMessageIds.length === 0) {
      return;
    }

    const turnIndex = turns.length;
    turns.push({
      id: createTurnId(activeInput, turnIndex),
      sourceBranchId,
      inputMessage: activeInput,
      messageIds: activeMessageIds,
      createdAt: getCreatedAt?.(activeInput, turnIndex),
      metadata: getTurnMetadata?.(activeInput, turnIndex),
      branchLabel,
      branchMetadata: getBranchMetadata?.(activeInput, turnIndex),
      selection: getSelection?.(activeInput, turnIndex),
    });
  };

  messages.forEach((message, messageIndex) => {
    if (isInputMessage(message, messageIndex, messages)) {
      flushActiveTurn();
      activeInput = message;
      activeMessageIds = [];
      return;
    }

    if (!activeInput) {
      return;
    }

    if (
      isBranchMessage(message, {
        inputMessage: activeInput,
        turnIndex: turns.length,
        messageIndex,
        messages,
      })
    ) {
      activeMessageIds.push(message.id);
    }
  });

  flushActiveTurn();

  return turns;
}

const defaultIsInputMessage: HistoryInputMessagePredicate = (message) =>
  message.role === "user";

const defaultIsBranchMessage: HistoryBranchMessagePredicate = () => true;

const defaultCreateTurnId: HistoryTurnIdFactory = (inputMessage, turnIndex) =>
  inputMessage.id ? `history-${inputMessage.id}` : `history-${turnIndex + 1}`;
