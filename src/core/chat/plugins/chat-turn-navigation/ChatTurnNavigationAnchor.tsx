import {
  useCallback,
  useMemo,
  type ReactNode,
  type RefCallback,
} from "react";
import { useChatTurnNavigationContext } from "./ChatTurnNavigationProvider";

export interface ChatTurnNavigationAnchorProps {
  turnId: string;
  messageId?: string;
  className?: string;
  children: ReactNode;
}

export function ChatTurnNavigationAnchor({
  turnId,
  messageId,
  className,
  children,
}: ChatTurnNavigationAnchorProps) {
  const { store } = useChatTurnNavigationContext();
  const token = useMemo(() => Symbol(turnId), [turnId]);
  const setElement = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      if (element) {
        store.registerAnchor({
          turnId,
          messageId,
          element,
          token,
        });
        return;
      }

      store.unregisterAnchor(turnId, token);
    },
    [messageId, store, token, turnId],
  );

  return (
    <div
      ref={setElement}
      className={className}
      data-chat-turn-navigation-anchor={turnId}
      data-chat-turn-navigation-message-id={messageId}
    >
      {children}
    </div>
  );
}
