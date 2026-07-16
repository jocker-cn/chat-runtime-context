import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useChatExtensions } from "../context/ChatContext";
import { ListenerSet } from "../../internal/ListenerSet";

export interface ExtensionTarget {
  scope: "conversation" | "turn" | "branch" | "group" | "message";
  id: string;
}

export interface ChatExtensionStore {
  get<T>(target: ExtensionTarget, key: string): T | undefined;
  set<T>(target: ExtensionTarget, key: string, value: T): void;
  delete(target: ExtensionTarget, key: string): void;
  subscribe(
    target: ExtensionTarget,
    key: string,
    listener: () => void,
  ): () => void;
}

export function createChatExtensionStore(): ChatExtensionStore {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, ListenerSet>();

  const emit = (storeKey: string) => {
    listeners.get(storeKey)?.emit();
  };

  return {
    get<T>(target: ExtensionTarget, key: string) {
      return values.get(createStoreKey(target, key)) as T | undefined;
    },
    set: (target, key, value) => {
      const storeKey = createStoreKey(target, key);
      if (values.has(storeKey) && Object.is(values.get(storeKey), value)) {
        return;
      }

      values.set(storeKey, value);
      emit(storeKey);
    },
    delete: (target, key) => {
      const storeKey = createStoreKey(target, key);
      if (!values.delete(storeKey)) return;

      emit(storeKey);
    },
    subscribe: (target, key, listener) => {
      const storeKey = createStoreKey(target, key);
      const keyListeners = listeners.get(storeKey) ?? new ListenerSet();
      const unsubscribe = keyListeners.add(listener);
      listeners.set(storeKey, keyListeners);

      return () => {
        unsubscribe();
        if (keyListeners.size === 0) {
          listeners.delete(storeKey);
        }
      };
    },
  };
}

export function useChatExtension<T>(
  target: ExtensionTarget,
  key: string,
): [T | undefined, (value: T) => void, () => void] {
  const store = useChatExtensions<ChatExtensionStore>();
  const targetScope = target.scope;
  const targetId = target.id;
  const stableTarget = useMemo<ExtensionTarget>(
    () => ({
      scope: targetScope,
      id: targetId,
    }),
    [targetId, targetScope],
  );
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(stableTarget, key, listener),
    [key, stableTarget, store],
  );
  const getSnapshot = useCallback(
    () => store.get<T>(stableTarget, key),
    [key, stableTarget, store],
  );
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const setValue = useCallback(
    (nextValue: T) => {
      store.set(stableTarget, key, nextValue);
    },
    [key, stableTarget, store],
  );

  const deleteValue = useCallback(() => {
    store.delete(stableTarget, key);
  }, [key, stableTarget, store]);

  return [value, setValue, deleteValue];
}

function createStoreKey(target: ExtensionTarget, key: string) {
  return JSON.stringify([target.scope, target.id, key]);
}
