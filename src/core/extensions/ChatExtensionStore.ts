import { useCallback, useSyncExternalStore } from "react";
import { useChatExtensions } from "../context/ChatContext";

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
  const listeners = new Map<string, Set<() => void>>();

  const emit = (storeKey: string) => {
    listeners.get(storeKey)?.forEach((listener) => listener());
  };

  return {
    get<T>(target: ExtensionTarget, key: string) {
      return values.get(createStoreKey(target, key)) as T | undefined;
    },
    set: (target, key, value) => {
      const storeKey = createStoreKey(target, key);
      values.set(storeKey, value);
      emit(storeKey);
    },
    delete: (target, key) => {
      const storeKey = createStoreKey(target, key);
      values.delete(storeKey);
      emit(storeKey);
    },
    subscribe: (target, key, listener) => {
      const storeKey = createStoreKey(target, key);
      const keyListeners = listeners.get(storeKey) ?? new Set<() => void>();
      keyListeners.add(listener);
      listeners.set(storeKey, keyListeners);

      return () => {
        keyListeners.delete(listener);
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
  const value = useSyncExternalStore(
    (listener) => store.subscribe(target, key, listener),
    () => store.get<T>(target, key),
    () => store.get<T>(target, key),
  );

  const setValue = useCallback(
    (nextValue: T) => {
      store.set(target, key, nextValue);
    },
    [key, store, target],
  );

  const deleteValue = useCallback(() => {
    store.delete(target, key);
  }, [key, store, target]);

  return [value, setValue, deleteValue];
}

function createStoreKey(target: ExtensionTarget, key: string) {
  return `${target.scope}:${target.id}:${key}`;
}
