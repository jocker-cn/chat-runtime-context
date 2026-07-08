import type { Message } from "@ag-ui/client";
import type { MessageReader } from "../contracts/chat-runtime";

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
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getMessages() {
      return messages;
    },
    appendMessage(message) {
      messages = [...messages, message];
      notify();
    },
    setMessages(nextMessages) {
      messages = [...nextMessages];
      notify();
    },
  };
}
