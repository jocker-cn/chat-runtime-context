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
  /** Transcript used to derive Turn boundaries and Branch message IDs. */
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
  inputMessage?: TMessage;
  turnAnchorMessage: TMessage;
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
  turnAnchorMessage: TMessage,
  turnIndex: number,
) => string;

export type HistoryCreatedAtFactory<TMessage extends Message = Message> = (
  turnAnchorMessage: TMessage,
  turnIndex: number,
) => number | undefined;

export type HistoryTurnMetadataFactory<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
> = (
  turnAnchorMessage: TMessage,
  turnIndex: number,
) => TTurnMetadata | undefined;

export type HistoryBranchMetadataFactory<
  TMessage extends Message = Message,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> = (
  turnAnchorMessage: TMessage,
  turnIndex: number,
) => TBranchMetadata | undefined;

export type HistorySelectionFactory<
  TMessage extends Message = Message,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> = (
  turnAnchorMessage: TMessage,
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
  let activeTurnAnchor: TMessage | undefined;
  let activeMessageIds: string[] = [];

  const flushActiveTurn = () => {
    if (!activeTurnAnchor) {
      return;
    }

    const turnIndex = turns.length;
    turns.push({
      id: createTurnId(activeTurnAnchor, turnIndex),
      sourceBranchId,
      inputMessage: activeInput,
      messageIds: activeMessageIds,
      createdAt: getCreatedAt?.(activeTurnAnchor, turnIndex),
      metadata: getTurnMetadata?.(activeTurnAnchor, turnIndex),
      branchLabel,
      branchMetadata: getBranchMetadata?.(activeTurnAnchor, turnIndex),
      selection: getSelection?.(activeTurnAnchor, turnIndex),
    });
  };

  messages.forEach((message, messageIndex) => {
    if (isInputMessage(message, messageIndex, messages)) {
      flushActiveTurn();
      activeInput = message;
      activeTurnAnchor = message;
      activeMessageIds = [];
      return;
    }

    if (!activeTurnAnchor) {
      if (
        isBranchMessage(message, {
          inputMessage: undefined,
          turnAnchorMessage: message,
          turnIndex: turns.length,
          messageIndex,
          messages,
        })
      ) {
        activeInput = undefined;
        activeTurnAnchor = message;
        activeMessageIds = [message.id];
      }
      return;
    }

    if (
      isBranchMessage(message, {
        inputMessage: activeInput,
        turnAnchorMessage: activeTurnAnchor,
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

const defaultCreateTurnId: HistoryTurnIdFactory = (
  turnAnchorMessage,
  turnIndex,
) =>
  turnAnchorMessage.id
    ? `history-${turnAnchorMessage.id}`
    : `history-${turnIndex + 1}`;
