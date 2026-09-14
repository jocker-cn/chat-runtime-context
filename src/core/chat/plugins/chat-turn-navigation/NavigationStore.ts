import { ListenerSet } from "../../../internal/ListenerSet";
import type { ChatTurnNavigationItem } from "./contracts";

export class ChatTurnNavigationStore {
  private readonly listeners = new ListenerSet();
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

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.items = [];
    this.itemCache.clear();
    this.listeners.clear();
  }
}
