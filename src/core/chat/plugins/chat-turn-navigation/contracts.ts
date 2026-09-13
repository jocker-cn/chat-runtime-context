import type { Message } from "@ag-ui/client";
import type { ReactNode, RefObject } from "react";
import type {
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

export interface ChatTurnNavigationTarget {
  item: ChatTurnNavigationItem;
  element: HTMLElement | null;
}

export interface ChatViewportAdapter {
  getScrollElement(): HTMLElement | null;
  revealItem(
    target: ChatTurnNavigationTarget,
    options: {
      behavior: ScrollBehavior | "instant";
      align: "start" | "center";
    },
  ): void | Promise<void>;
}

export interface ChatTurnNavigationProviderProps<
  TMessage extends Message = Message,
> {
  runtime: ChatRuntime<unknown, TMessage>;
  scrollContainerRef: RefObject<HTMLElement | null>;
  viewportAdapter?: ChatViewportAdapter;
  includeTurn?: (turn: ChatTurn<TMessage>) => boolean;
  getPreview?: (context: {
    turn: ChatTurn<TMessage>;
    inputMessage: TMessage;
    selectedMessages?: readonly TMessage[];
  }) => ChatTurnNavigationPreview;
  onUserNavigate?: (item: ChatTurnNavigationItem) => void;
  children: ReactNode;
}
