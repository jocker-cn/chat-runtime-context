// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../../../src/core/tools/toolRegistry";
import { createToolReactBindings } from "../../../src/core/tools/toolReact";

afterEach(cleanup);

const bindings = createToolReactBindings<{ report(value: number): void }>();

function Feature({ value, name = "Tool" }: { value: number; name?: string }) {
  bindings.useRegisterTool({
    definition: { id: "feature", name, keywords: ["feature"] },
    onSelect: ({ capabilities }) => capabilities.report(value),
  });
  return null;
}

function List() {
  const tools = bindings.useTools();
  return <div>{tools.map((tool) => <span key={tool.id}>{tool.name}</span>)}</div>;
}

describe("React tool bindings", () => {
  it("accepts inline registrations, keeps handlers current, and only publishes metadata changes", async () => {
    const registry = createToolRegistry<{ report(value: number): void }>();
    const changed = vi.fn();
    registry.subscribe(changed);
    const report = vi.fn();
    const view = (value: number, name?: string) => (
      <bindings.Provider registry={registry}><Feature value={value} name={name} /><List /></bindings.Provider>
    );
    const rendered = render(view(1));
    expect(screen.getByText("Tool")).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    rendered.rerender(view(2));
    expect(changed).toHaveBeenCalledTimes(1);
    await act(() => registry.invoke("feature", { source: "test", capabilities: { report } }));
    expect(report).toHaveBeenLastCalledWith(2);
    rendered.rerender(view(3, "Renamed"));
    expect(screen.getByText("Renamed")).toBeTruthy();
    rendered.unmount();
    expect(registry.getSnapshot()).toEqual([]);
  });

  it("cleans up correctly under StrictMode and keeps Provider instances isolated", () => {
    const first = createToolRegistry<{ report(value: number): void }>();
    const second = createToolRegistry<{ report(value: number): void }>();
    const { unmount } = render(<StrictMode>
      <bindings.Provider registry={first}><Feature value={1} name="First" /></bindings.Provider>
      <bindings.Provider registry={second}><Feature value={2} name="Second" /></bindings.Provider>
    </StrictMode>);
    expect(first.getSnapshot()[0]?.name).toBe("First");
    expect(second.getSnapshot()[0]?.name).toBe("Second");
    unmount();
    expect(first.getSnapshot()).toEqual([]);
    expect(second.getSnapshot()).toEqual([]);
  });
});
