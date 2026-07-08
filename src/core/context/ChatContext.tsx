import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { Message } from "@ag-ui/client";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type {
  ChatBranch,
  ChatBranchSelection,
  ChatBranchSelectionInput,
  BranchMessageSelector,
  ChatMetadata,
  MessageReader,
  ChatRuntime,
  ChatRuntimeSnapshot,
  ChatRuntimeStatus,
  ChatTurn,
} from "../contracts/chat-runtime";

type AnyChatRuntime = ChatRuntime<any, any, any, any>;

interface InternalChatContextValue {
  runtime: AnyChatRuntime;
  extensions: unknown;
}

const ChatContext = createContext<InternalChatContextValue | undefined>(
  undefined,
);

const emptyMessages: readonly Message[] = [];

const emptyMessageReader: MessageReader<Message> = {
  subscribe: () => () => undefined,
  getMessages: () => emptyMessages,
};

export interface ChatProviderProps<
  TInput = unknown,
  TMessage extends Message = Message,
  TExtensions = unknown,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> {
  runtime: ChatRuntime<TInput, TMessage, TTurnMetadata, TBranchMetadata>;
  extensions: TExtensions;
  children: ReactNode;
}

export function ChatProvider<
  TInput = unknown,
  TMessage extends Message = Message,
  TExtensions = unknown,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>({
  runtime,
  extensions,
  children,
}: ChatProviderProps<
  TInput,
  TMessage,
  TExtensions,
  TTurnMetadata,
  TBranchMetadata
>) {
  const value = useMemo<InternalChatContextValue>(
    () => ({
      runtime: runtime as AnyChatRuntime,
      extensions,
    }),
    [runtime, extensions],
  );

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

function useInternalChatContext(): InternalChatContextValue {
  const context = useContext(ChatContext);

  if (!context) {
    throw new Error("Chat hooks must be used within ChatProvider.");
  }

  return context;
}

export function useChatRuntime<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(): ChatRuntime<TInput, TMessage, TTurnMetadata, TBranchMetadata> {
  const { runtime } = useInternalChatContext();

  return runtime as ChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >;
}

export function useChatExtensions<TExtensions>(): TExtensions {
  const { extensions } = useInternalChatContext();

  return extensions as TExtensions;
}

export function useChatSelector<
  TSelected,
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  selector: (
    snapshot: ChatRuntimeSnapshot<
      TMessage,
      TTurnMetadata,
      TBranchMetadata
    >,
  ) => TSelected,
  equalityFn: (previous: TSelected, next: TSelected) => boolean = Object.is,
): TSelected {
  const runtime = useChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >();

  return useSyncExternalStoreWithSelector(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
    selector,
    equalityFn,
  );
}

export function useChatSnapshot<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(): ChatRuntimeSnapshot<TMessage, TTurnMetadata, TBranchMetadata> {
  return useChatSelector<
    ChatRuntimeSnapshot<TMessage, TTurnMetadata, TBranchMetadata>,
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >(
    (snapshot) => snapshot,
  );
}

export function useChatStatus(): ChatRuntimeStatus {
  return useChatSelector((snapshot) => snapshot.status);
}

export function useChatMode() {
  return useChatSelector((snapshot) => snapshot.mode);
}

export function useChatTurnIds(): readonly string[] {
  return useChatSelector((snapshot) => snapshot.turnIds);
}

export function useChatTurn<
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
>(turnId: string): ChatTurn<TMessage, TMetadata> | undefined {
  return useChatSelector(
    (snapshot) => snapshot.turnsById[turnId] as
      | ChatTurn<TMessage, TMetadata>
      | undefined,
  );
}

export function useChatBranchSelection<
  TMetadata extends ChatMetadata = ChatMetadata,
>(turnId: string): ChatBranchSelection<TMetadata> | undefined {
  return useChatSelector(
    (snapshot) =>
      snapshot.turnsById[turnId]?.selection as
        | ChatBranchSelection<TMetadata>
        | undefined,
  );
}

export function useSelectedBranchId(turnId: string): string | undefined {
  return useChatSelector(
    (snapshot) => snapshot.turnsById[turnId]?.selectedBranchId,
  );
}

export function useSelectBranch<
  TMetadata extends ChatMetadata = ChatMetadata,
>() {
  const runtime = useChatRuntime();

  return useCallback(
    (
      turnId: string,
      branchId: string,
      selection?: ChatBranchSelectionInput<TMetadata>,
    ) => runtime.selectBranch(turnId, branchId, selection),
    [runtime],
  );
}

export function useChatBranch<
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
>(branchId: string): ChatBranch<TMessage, TMetadata> | undefined {
  return useChatSelector(
    (snapshot) => snapshot.branchesById[branchId] as unknown as
      | ChatBranch<TMessage, TMetadata>
      | undefined,
  );
}

export function useBranchMessages<
  TMessage extends Message = Message,
>(branchId: string): readonly TMessage[] {
  const branch = useChatBranch<TMessage>(branchId);
  const threadId = useChatSelector((snapshot) => snapshot.threadId);
  const reader =
    branch?.messageReader ?? (emptyMessageReader as MessageReader<TMessage>);

  return useSyncExternalStoreWithSelector(
    reader.subscribe,
    reader.getMessages,
    reader.getMessages,
    (messages) =>
      branch
        ? selectBranchMessages(messages, {
            threadId,
            turnId: branch.turnId,
            branchId: branch.id,
            anchorMessageId: branch.anchorMessageId,
          }, branch.selectMessages)
        : (emptyMessages as readonly TMessage[]),
    areMessageListsEqual,
  );
}

function selectBranchMessages<TMessage extends Message>(
  messages: readonly TMessage[],
  context: {
    threadId?: string;
    turnId: string;
    branchId: string;
    anchorMessageId?: string;
  },
  selector?: BranchMessageSelector<TMessage>,
) {
  if (selector) {
    return selector(messages, context);
  }

  const anchorIndex = context.anchorMessageId
    ? messages.findIndex((message) => message.id === context.anchorMessageId)
    : -1;

  return anchorIndex >= 0 ? messages.slice(anchorIndex + 1) : messages;
}

function areMessageListsEqual<TMessage extends Message>(
  previous: readonly TMessage[],
  next: readonly TMessage[],
) {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  return previous.every((message, index) => message === next[index]);
}
