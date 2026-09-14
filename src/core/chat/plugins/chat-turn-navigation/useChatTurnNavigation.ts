import type { Message } from "@ag-ui/client";
import { useEffect, useMemo } from "react";
import type {
  ChatBranchStatus,
  ChatRuntimeSnapshot,
} from "../../contracts/chat-runtime";
import { ChatTurnNavigationStore } from "./NavigationStore";
import type {
  ChatTurnNavigationItem,
  ChatTurnNavigationPreview,
  ChatViewportAdapter,
  UseChatTurnNavigationOptions,
} from "./contracts";
import { createDomChatViewportAdapter } from "./createDomChatViewportAdapter";

export interface ChatTurnNavigationController {
  readonly store: ChatTurnNavigationStore;
  readonly viewportAdapter: ChatViewportAdapter;
  getPreview(
    item: ChatTurnNavigationItem,
  ): ChatTurnNavigationPreview | undefined;
  subscribePreview(
    item: ChatTurnNavigationItem,
    listener: () => void,
  ): () => void;
  navigate(item: ChatTurnNavigationItem): void;
}

export function useChatTurnNavigation<
  TInput = unknown,
  TMessage extends Message = Message,
>({
  runtime,
  viewportAdapter,
  includeTurn,
  getPreview,
  onUserNavigate,
}: UseChatTurnNavigationOptions<TInput, TMessage>): ChatTurnNavigationController {
  const store = useMemo(() => new ChatTurnNavigationStore(), [runtime]);
  const resolvedViewportAdapter = useMemo(
    () => viewportAdapter ?? createDomChatViewportAdapter(),
    [viewportAdapter],
  );

  useEffect(() => {
    const sync = () => {
      store.setItems(projectNavigationItems(runtime.getSnapshot(), includeTurn));
    };

    sync();
    return runtime.subscribe(sync);
  }, [includeTurn, runtime, store]);

  return useMemo<ChatTurnNavigationController>(() => ({
    store,
    viewportAdapter: resolvedViewportAdapter,
    getPreview: (item) => {
      if (!getPreview) return undefined;

      const snapshot = runtime.getSnapshot();
      const turn = snapshot.turnsById[item.turnId];
      const inputMessage = turn?.inputMessage;
      if (!turn || !inputMessage) return undefined;

      const selectedBranch = resolvePreviewBranch(snapshot, item);
      return getPreview({
        turn,
        inputMessage,
        selectedBranch,
        selectedMessages: isSettledBranchStatus(selectedBranch?.status)
          ? selectedBranch?.messageReader.getMessages()
          : undefined,
      });
    },
    subscribePreview: (item, listener) => {
      if (!getPreview) return () => undefined;

      let branch = resolvePreviewBranch(runtime.getSnapshot(), item);
      return runtime.subscribe(() => {
        const nextBranch = resolvePreviewBranch(runtime.getSnapshot(), item);
        const branchChanged = nextBranch?.id !== branch?.id;
        const branchSettled = (
          !isSettledBranchStatus(branch?.status) &&
          isSettledBranchStatus(nextBranch?.status)
        );

        branch = nextBranch;
        if (branchChanged || branchSettled) {
          listener();
        }
      });
    },
    navigate: (item) => {
      void resolvedViewportAdapter.revealItem(
        item,
        {
          behavior: "smooth",
          align: "start",
        },
      );
      onUserNavigate?.(item);
    },
  }), [
    getPreview,
    onUserNavigate,
    resolvedViewportAdapter,
    runtime,
    store,
  ]);
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

function isSettledBranchStatus(status: ChatBranchStatus | undefined) {
  return status === "completed" || status === "cancelled" || status === "error";
}

function projectNavigationItems<TMessage extends Message>(
  snapshot: ChatRuntimeSnapshot<TMessage>,
  includeTurn?: UseChatTurnNavigationOptions<unknown, TMessage>["includeTurn"],
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
