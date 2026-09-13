import type { Message } from "@ag-ui/client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { ChatRuntimeSnapshot } from "../../contracts/chat-runtime";
import { ChatTurnNavigationStore } from "./NavigationStore";
import type {
  ChatTurnNavigationItem,
  ChatTurnNavigationPreview,
  ChatTurnNavigationProviderProps,
  ChatViewportAdapter,
} from "./contracts";
import { createDomChatViewportAdapter } from "./createDomChatViewportAdapter";

interface ChatTurnNavigationContextValue {
  store: ChatTurnNavigationStore;
  viewportAdapter: ChatViewportAdapter;
  onUserNavigate?: (item: ChatTurnNavigationItem) => void;
  subscribePreview?: (
    item: ChatTurnNavigationItem,
    listener: () => void,
  ) => () => void;
  getPreview?: (
    item: ChatTurnNavigationItem,
  ) => ChatTurnNavigationPreview | undefined;
}

const ChatTurnNavigationContext =
  createContext<ChatTurnNavigationContextValue | null>(null);

export function ChatTurnNavigationProvider<
  TMessage extends Message = Message,
>({
  runtime,
  scrollContainerRef,
  viewportAdapter,
  includeTurn,
  getPreview,
  onUserNavigate,
  children,
}: ChatTurnNavigationProviderProps<TMessage>) {
  const store = useMemo(() => new ChatTurnNavigationStore(), [runtime]);
  const resolvedViewportAdapter = useMemo(
    () =>
      viewportAdapter ??
      createDomChatViewportAdapter(scrollContainerRef),
    [scrollContainerRef, viewportAdapter],
  );

  useEffect(() => {
    const sync = () => {
      store.setItems(projectNavigationItems(runtime.getSnapshot(), includeTurn));
    };

    sync();
    return runtime.subscribe(sync);
  }, [includeTurn, runtime, store]);

  const value = useMemo<ChatTurnNavigationContextValue>(
    () => ({
      store,
      viewportAdapter: resolvedViewportAdapter,
      onUserNavigate,
      getPreview: getPreview
        ? (item) => {
            const snapshot = runtime.getSnapshot();
            const turn = snapshot.turnsById[item.turnId];
            const inputMessage = turn?.inputMessage;
            if (!turn || !inputMessage) return undefined;

            const selectedBranch = resolvePreviewBranch(snapshot, item);
            return getPreview({
              turn,
              inputMessage,
              selectedMessages: selectedBranch?.messageReader.getMessages(),
            });
          }
        : undefined,
      subscribePreview: getPreview
        ? (item, listener) => {
            let reader = resolvePreviewBranch(
              runtime.getSnapshot(),
              item,
            )?.messageReader;
            let unsubscribeReader = reader?.subscribe(listener);
            const unsubscribeRuntime = runtime.subscribe(() => {
              const nextReader = resolvePreviewBranch(
                runtime.getSnapshot(),
                item,
              )?.messageReader;
              if (nextReader !== reader) {
                unsubscribeReader?.();
                reader = nextReader;
                unsubscribeReader = reader?.subscribe(listener);
              }
              listener();
            });

            return () => {
              unsubscribeRuntime();
              unsubscribeReader?.();
            };
          }
        : undefined,
    }),
    [getPreview, onUserNavigate, resolvedViewportAdapter, runtime, store],
  );

  return (
    <ChatTurnNavigationContext.Provider value={value}>
      {children}
    </ChatTurnNavigationContext.Provider>
  );
}

function resolvePreviewBranch<TMessage extends Message>(
  snapshot: ChatRuntimeSnapshot<TMessage>,
  item: ChatTurnNavigationItem,
) {
  const turn = snapshot.turnsById[item.turnId];
  const previewBranchId = turn
    ? turn.selectedBranchId ?? turn.branchIds[0]
    : undefined;

  return previewBranchId
    ? snapshot.branchesById[previewBranchId]
    : undefined;
}

export function useChatTurnNavigationContext() {
  const context = useContext(ChatTurnNavigationContext);
  if (!context) {
    throw new Error(
      "Chat Turn Navigation components require ChatTurnNavigationProvider.",
    );
  }

  return context;
}

function projectNavigationItems<TMessage extends Message>(
  snapshot: ChatRuntimeSnapshot<TMessage>,
  includeTurn?: ChatTurnNavigationProviderProps<TMessage>["includeTurn"],
) {
  return snapshot.turnIds.flatMap((turnId) => {
    const turn = snapshot.turnsById[turnId];
    const inputMessage = turn?.inputMessage;
    if (!turn || !inputMessage || (includeTurn && !includeTurn(turn))) {
      return [];
    }

    return [{
      id: turn.id,
      turnId: turn.id,
      messageId: inputMessage.id,
    }];
  });
}
