import { describe, expect, it, vi } from "vitest";
import {
  createChatExtensionStore,
  type ExtensionTarget,
} from "../../../../src/core/chat/extensions/ChatExtensionStore";

describe("ChatExtensionStore", () => {
  it("isolates structured targets when ids and keys contain colons", () => {
    const store = createChatExtensionStore();
    const firstTarget: ExtensionTarget = {
      scope: "message",
      id: "message:part",
    };
    const secondTarget: ExtensionTarget = {
      scope: "message",
      id: "message",
    };
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    store.subscribe(firstTarget, "status", firstListener);
    store.subscribe(secondTarget, "part:status", secondListener);
    store.set(firstTarget, "status", "first");
    store.set(secondTarget, "part:status", "second");

    expect(store.get(firstTarget, "status")).toBe("first");
    expect(store.get(secondTarget, "part:status")).toBe("second");
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it("does not notify subscribers when the stored value is unchanged", () => {
    const store = createChatExtensionStore();
    const target: ExtensionTarget = { scope: "turn", id: "turn-1" };
    const listener = vi.fn();
    const value = { state: "ready" };
    store.subscribe(target, "state", listener);

    store.set(target, "state", value);
    store.set(target, "state", value);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies on delete and stops notifying after unsubscribe", () => {
    const store = createChatExtensionStore();
    const target: ExtensionTarget = { scope: "branch", id: "branch-1" };
    const listener = vi.fn();
    const unsubscribe = store.subscribe(target, "selection", listener);

    store.delete(target, "selection");
    expect(listener).not.toHaveBeenCalled();

    store.set(target, "selection", "selected");
    store.delete(target, "selection");

    expect(store.get(target, "selection")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.set(target, "selection", "new-selection");
    store.delete(target, "selection");

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
