import { describe, expect, it, vi } from "vitest";
import { createToolRegistry, searchTools } from "../../../src/core/tools/toolRegistry";

describe("tool registry", () => {
  it("maintains stable read-only POJO snapshots and releases registrations", () => {
    const registry = createToolRegistry<{}>();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const initial = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(initial);
    const definition = { id: "agent.configure", name: "选择 Agent", keywords: ["agent"] };
    const remove = registry.register({ definition, onSelect: vi.fn() });
    definition.name = "external mutation";
    definition.keywords.push("external mutation");
    expect(registry.getSnapshot()).toEqual([{ id: "agent.configure", name: "选择 Agent", keywords: ["agent"] }]);
    expect(Object.isFrozen(registry.getSnapshot())).toBe(true);
    expect(JSON.stringify(registry.getSnapshot())).not.toContain("onSelect");
    expect(listener).toHaveBeenCalledTimes(1);
    remove(); remove();
    expect(registry.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("rejects conflicts and protects a new owner from stale cleanup", () => {
    const registry = createToolRegistry<{}>();
    const registration = { definition: { id: "tool", name: "Tool" }, onSelect: vi.fn() };
    const remove = registry.register(registration);
    expect(() => registry.register(registration)).toThrow("already registered");
    remove();
    registry.register(registration);
    remove();
    expect(registry.getSnapshot()).toHaveLength(1);
    expect(() => registry.register({ ...registration, definition: { id: " ", name: "Tool" } }))
      .toThrow("required");
  });

  it("invokes tool-owned behavior from unrelated entry points without a Composer", async () => {
    const registry = createToolRegistry<{ notify(text: string): void }>();
    const notify = vi.fn();
    registry.register({
      definition: { id: "hello", name: "Hello" },
      onSelect: ({ source, capabilities }) => capabilities.notify(source),
      onReferenceClick: ({ capabilities }) => capabilities.notify("reference"),
    });
    await registry.invoke("hello", { source: "fixed-list", capabilities: { notify } });
    await registry.invoke("hello", { source: "shortcut", capabilities: { notify } });
    await registry.invoke("hello", { source: "inline", capabilities: { notify } }, "reference");
    expect(notify.mock.calls).toEqual([["fixed-list"], ["shortcut"], ["reference"]]);
    await expect(registry.invoke("missing", { source: "test", capabilities: { notify } })).rejects.toThrow("not registered");
  });

  it("propagates sync/async failures and does not repeat selection on reference clicks", async () => {
    const registry = createToolRegistry<{}>();
    const select = vi.fn(() => { throw new Error("业务错误"); });
    registry.register({ definition: { id: "sync", name: "Sync" }, onSelect: select });
    registry.register({ definition: { id: "async", name: "Async" }, onSelect: async () => { throw new Error("异步错误"); } });
    await registry.invoke("sync", { source: "test", capabilities: {} }, "reference");
    expect(select).not.toHaveBeenCalled();
    await expect(registry.invoke("sync", { source: "test", capabilities: {} })).rejects.toThrow("业务错误");
    await expect(registry.invoke("async", { source: "test", capabilities: {} })).rejects.toThrow("异步错误");
  });

  it("searches metadata without running business callbacks", () => {
    const definitions = [
      { id: "agent", name: "发布助手", description: "发布前检查", group: "Agent", keywords: ["release"] },
      { id: "skill", name: "风险检查", group: "Skill" },
    ];
    expect(searchTools(definitions, " RELEASE ")).toEqual([definitions[0]]);
    expect(searchTools(definitions, "skill")).toEqual([definitions[1]]);
    expect(searchTools(definitions, "")).toBe(definitions);
    expect(searchTools(definitions, "不存在")).toEqual([]);
  });
});
