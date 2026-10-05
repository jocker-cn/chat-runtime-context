// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolMenu, useToolMenu, type ToolMenuEntry } from "../../../src/core/tools";

afterEach(cleanup);

function Harness({ entries, query, onClose }: {
  entries: ToolMenuEntry[]; query?: string; onClose(): void;
}) {
  const menu = useToolMenu({ entries, query, onClose });
  return <>
    <input aria-label="外部入口" onKeyDown={(event) => {
      if (menu.handleKey(event.key)) event.preventDefault();
    }} />
    <ToolMenu menu={menu} />
  </>;
}

function fixture() {
  const selected = vi.fn();
  const close = vi.fn();
  const entries: ToolMenuEntry[] = [{
    type: "group", definition: { id: "services", name: "自定义服务", description: "业务提供的分类" },
    items: [
      { id: "alpha", name: "Alpha", description: "主服务", keywords: ["https://alpha.test"] },
      { id: "beta", name: "Beta", description: "备用服务" },
    ],
    renderItem: (item) => <span>{item.name}<small>自定义详情：{item.description}</small></span>,
    onSelect: selected,
  }, {
    type: "action", definition: { id: "direct", name: "直接动作" }, onSelect: () => selected("direct"),
  }];
  return { entries, selected, close };
}

describe("ToolMenu", () => {
  it("opens a category without executing, uses tool-owned details and closes before selecting", () => {
    const { entries, selected, close } = fixture();
    render(<Harness entries={entries} onClose={close} />);
    expect(screen.queryByRole("option", { name: /Alpha/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /自定义服务/ }));
    expect(selected).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText("自定义详情：主服务")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Alpha/ }));
    expect(selected).toHaveBeenCalledWith(entries[0].type === "group" ? entries[0].items[0] : undefined);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(selected.mock.invocationCallOrder[0]);
    expect(screen.getByRole("listbox", { name: "选择工具分类" })).toBeTruthy();
  });

  it("keeps direct actions and empty categories supported", () => {
    const { entries, selected, close } = fixture();
    entries.push({ type: "group", definition: { id: "empty", name: "空分类" }, items: [],
      empty: <span>业务暂无数据</span>, onSelect: selected });
    render(<Harness entries={entries} onClose={close} />);
    fireEvent.click(screen.getByRole("option", { name: /空分类/ }));
    expect(screen.getByText("业务暂无数据")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("外部入口"), { key: "Enter" });
    expect(selected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回工具分类" }));
    fireEvent.click(screen.getByRole("option", { name: "直接动作" }));
    expect(selected).toHaveBeenCalledWith("direct");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("finds a category through child metadata, then searches within its own details", () => {
    const { entries, close } = fixture();
    const view = render(<Harness entries={entries} query="alpha.test" onClose={close} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /自定义服务/ }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("搜索 自定义服务 条目"), { target: { value: "Beta" } });
    expect(screen.queryByRole("option", { name: /Alpha/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Beta/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("搜索 自定义服务 条目"), { key: "Escape" });
    view.rerender(<Harness entries={entries} query="自定义服务" onClose={close} />);
    fireEvent.click(screen.getByRole("option", { name: /自定义服务/ }));
    expect((screen.getByLabelText("搜索 自定义服务 条目") as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("delegates keyboard navigation from an editor and backs out before closing", () => {
    const { entries, selected, close } = fixture();
    render(<Harness entries={entries} onClose={close} />);
    const trigger = screen.getByLabelText("外部入口");
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Beta/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(trigger, { key: "ArrowLeft" });
    expect(screen.getByRole("listbox", { name: "选择工具分类" })).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(selected).not.toHaveBeenCalled();
  });

  it("uses current data and callbacks, returning to root when a category is removed", () => {
    const { entries, selected, close } = fixture();
    const view = render(<Harness entries={entries} onClose={close} />);
    fireEvent.click(screen.getByRole("option", { name: /自定义服务/ }));
    const replacement = vi.fn();
    const group = entries[0];
    if (group.type !== "group") throw new Error("Expected group");
    view.rerender(<Harness entries={[{ ...group, items: [group.items[1]], onSelect: replacement }]}
      onClose={close} />);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(replacement).toHaveBeenCalledWith(group.items[1]);
    expect(selected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: /自定义服务/ }));
    view.rerender(<Harness entries={[entries[1]]} onClose={close} />);
    expect(screen.getByRole("listbox", { name: "选择工具分类" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "直接动作" })).toBeTruthy();
  });

  it("returns focus to the root list when escaping the detail search", () => {
    const { entries, close } = fixture();
    render(<Harness entries={entries} onClose={close} />);
    fireEvent.click(screen.getByRole("option", { name: /自定义服务/ }));
    const search = screen.getByLabelText("搜索 自定义服务 条目");
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowLeft" });
    expect(screen.getByRole("listbox", { name: "自定义服务 条目" })).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: /自定义服务/ }));
    expect(close).not.toHaveBeenCalled();
  });
});
