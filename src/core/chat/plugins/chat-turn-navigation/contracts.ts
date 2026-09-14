import type { Message } from "@ag-ui/client";
import type { ReactNode } from "react";
import type {
  ChatBranch,
  ChatRuntime,
  ChatTurn,
} from "../../contracts/chat-runtime";

export interface ChatTurnNavigationPreview {
  title: ReactNode;
  body?: ReactNode;
  ariaLabel: string;
}

export interface ChatTurnNavigationItem {
  id: string;
  turnId: string;
  messageId: string;
}

export interface ChatViewportAdapter {
  getScrollElement(): HTMLElement | null;
  revealItem(
    item: ChatTurnNavigationItem,
    options: {
      behavior: ScrollBehavior | "instant";
      align: "start" | "center";
    },
  ): void | Promise<void>;
}

export interface UseChatTurnNavigationOptions<
  TInput = unknown,
  TMessage extends Message = Message,
> {
  runtime: ChatRuntime<TInput, TMessage>;
  viewportAdapter?: ChatViewportAdapter;
  includeTurn?: (turn: ChatTurn<TMessage>) => boolean;
  getPreview?: (context: {
    turn: ChatTurn<TMessage>;
    inputMessage: TMessage;
    selectedBranch?: ChatBranch<TMessage>;
    selectedMessages?: readonly TMessage[];
  }) => ChatTurnNavigationPreview;
  onUserNavigate?: (item: ChatTurnNavigationItem) => void;
}
