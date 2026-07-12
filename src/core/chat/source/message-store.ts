import type { Message } from "@ag-ui/client";
import type { MessageReader } from "../contracts/chat-runtime";
import { ListenerSet } from "../../internal/ListenerSet";

export interface MessageStore<TMessage extends Message = Message>
  extends MessageReader<TMessage> {
  appendMessage(message: TMessage): void;
  setMessages(messages: readonly TMessage[]): void;
}

export function createMessageStore<
  TMessage extends Message = Message,
>(
  initialMessages: readonly TMessage[] = [],
): MessageStore<TMessage> {
  let messages = [...initialMessages];
  const listeners = new ListenerSet();

  const notify = () => {
    listeners.emit();
  };

  return {
    subscribe(listener) {
      return listeners.add(listener);
    },
    getMessages() {
      return messages;
    },
    appendMessage(message) {
      messages = [...messages, message];
      notify();
    },
    setMessages(nextMessages) {
      if (areMessageListsEqual(messages, nextMessages)) return;

      messages = [...nextMessages];
      notify();
    },
  };
}

function areMessageListsEqual<TMessage extends Message>(
  previous: readonly TMessage[],
  next: readonly TMessage[],
) {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  return previous.every((message, index) => message === next[index]);
}
