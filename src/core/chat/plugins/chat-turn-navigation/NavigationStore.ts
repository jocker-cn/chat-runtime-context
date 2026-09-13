import { ListenerSet } from "../../../internal/ListenerSet";
import type { ChatTurnNavigationItem } from "./contracts";

export interface ChatTurnNavigationAnchorEntry {
  turnId: string;
  messageId?: string;
  element: HTMLElement;
  token: symbol;
}

export class ChatTurnNavigationStore {
  private readonly listeners = new ListenerSet();
  private readonly anchors = new Map<
    string,
    ChatTurnNavigationAnchorEntry
  >();
  private readonly itemCache = new Map<string, ChatTurnNavigationItem>();
  private items: readonly ChatTurnNavigationItem[] = [];
  private disposed = false;

  subscribe = (listener: () => void) => this.listeners.add(listener);

  getSnapshot = () => this.items;

  setItems(nextItems: readonly ChatTurnNavigationItem[]) {
    if (this.disposed) return;

    const nextTurnIds = new Set(nextItems.map((item) => item.turnId));
    const resolvedItems = nextItems.map((item) => {
      const cached = this.itemCache.get(item.turnId);
      if (cached?.messageId === item.messageId) {
        return cached;
      }

      this.itemCache.set(item.turnId, item);
      return item;
    });

    for (const turnId of this.itemCache.keys()) {
      if (!nextTurnIds.has(turnId)) {
        this.itemCache.delete(turnId);
      }
    }

    if (
      this.items.length === resolvedItems.length &&
      this.items.every((item, index) => item === resolvedItems[index])
    ) {
      return;
    }

    this.items = resolvedItems;
    this.listeners.emit();
  }

  registerAnchor(entry: ChatTurnNavigationAnchorEntry) {
    if (this.disposed) return;
    this.anchors.set(entry.turnId, entry);
  }

  unregisterAnchor(turnId: string, token: symbol) {
    if (this.anchors.get(turnId)?.token !== token) return;
    this.anchors.delete(turnId);
  }

  getAnchor(turnId: string) {
    return this.anchors.get(turnId)?.element ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.items = [];
    this.itemCache.clear();
    this.anchors.clear();
    this.listeners.clear();
  }
}
