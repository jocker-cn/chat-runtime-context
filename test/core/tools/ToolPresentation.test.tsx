// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ToolPresentationProvider, useToolPresentation, type ToolDialogHandle, type ToolPresentationAPI,
} from "../../../src/core/tools/ToolPresentation";
import { ToolList } from "../../../src/core/tools/ToolList";
import { createToolRegistry, type ToolDefinition } from "../../../src/core/tools/toolRegistry";
import { createToolReactBindings } from "../../../src/core/tools/toolReact";

afterEach(cleanup);

interface Capabilities { presentation: ToolPresentationAPI }
const bindings = createToolReactBindings<Capabilities>();

function AgentFeature({ report }: { report(prompt: string): void }) {
  bindings.useRegisterTool({
    definition: { id: "agent.configure", name: "配置 Agent", group: "Agent" },
    onSelect: ({ capabilities }) => {
      capabilities.presentation.openDialog({
        title: "Agent 配置",
        render: ({ close }) => <AgentForm onConfirm={(prompt) => { report(prompt); close(); }} />,
      });
    },
  });
  return null;
}

function AgentForm({ onConfirm }: { onConfirm(prompt: string): void }) {
  const [prompt, setPrompt] = useState("");
  return <>
    <label>Prompt<input value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
    <button type="button" onClick={() => onConfirm(prompt)}>工具自己的确认</button>
  </>;
}

function Selector({ close }: { close?: () => void }) {
  const presentation = useToolPresentation();
  const tools = bindings.useTools();
  const launch = bindings.useToolLauncher({ source: "standalone-list", capabilities: { presentation } });
  const [error, setError] = useState("");
  return <>
    <ToolList tools={tools} onSelect={(tool) => {
      close?.();
      void launch(tool.id).catch((cause: unknown) => setError(String(cause)));
    }} />
    {error && <p role="alert">{error}</p>}
  </>;
}

function Entry() {
  const presentation = useToolPresentation();
  return <button type="button" onClick={() => presentation.openDialog({
    title: "工具选择", render: ({ close }) => <Selector close={close} />,
  })}>独立工具入口</button>;
}

describe("optional tool presentation", () => {
  it("launches the same tool from a fixed list or a dialog without any input/runtime", () => {
    const registry = createToolRegistry<Capabilities>();
    const report = vi.fn();
    render(<bindings.Provider registry={registry}>
      <ToolPresentationProvider><AgentFeature report={report} /><Entry /><Selector /></ToolPresentationProvider>
    </bindings.Provider>);
    const trigger = screen.getByRole("button", { name: "独立工具入口" });
    trigger.focus();
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "工具选择" });
    fireEvent.click(within(picker).getByRole("option", { name: /配置 Agent/ }));
    expect(screen.queryByRole("dialog", { name: "工具选择" })).toBeNull();
    const configuration = screen.getByRole("dialog", { name: "Agent 配置" });
    fireEvent.change(within(configuration).getByRole("textbox", { name: "Prompt" }), { target: { value: "发布助手" } });
    fireEvent.click(within(configuration).getByRole("button", { name: "工具自己的确认" }));
    expect(report).toHaveBeenCalledWith("发布助手");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(screen.getByRole("option", { name: /配置 Agent/ }));
    expect(screen.getByRole("dialog", { name: "Agent 配置" })).toBeTruthy();
  });

  it("supports Escape, focus containment and body scroll restoration", () => {
    document.body.style.overflow = "auto";
    const registry = createToolRegistry<Capabilities>();
    render(<bindings.Provider registry={registry}>
      <ToolPresentationProvider><Entry /></ToolPresentationProvider>
    </bindings.Provider>);
    const trigger = screen.getByRole("button", { name: "独立工具入口" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭工具弹窗" }));
    act(() => trigger.focus());
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("replaces dialogs with fresh content and ignores old close handles", () => {
    let api: ToolPresentationAPI;
    function Capture() { api = useToolPresentation(); return null; }
    const { unmount } = render(<ToolPresentationProvider><Capture /></ToolPresentationProvider>);
    let first: ToolDialogHandle;
    act(() => { first = api.openDialog({ title: "First", render: () => <AgentForm onConfirm={vi.fn()} /> }); });
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "旧内容" } });
    act(() => { api.openDialog({ title: "Second", render: () => <AgentForm onConfirm={vi.fn()} /> }); });
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLInputElement).value).toBe("");
    act(() => first.close());
    expect(screen.getByRole("dialog", { name: "Second" })).toBeTruthy();
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("ToolList", () => {
  const tools: ToolDefinition[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  it("supports keyboard selection and adapts when tools disappear", () => {
    const select = vi.fn();
    const { rerender } = render(<ToolList tools={tools} onSelect={select} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "B" }));
    fireEvent.keyDown(list, { key: "Enter" });
    expect(select).toHaveBeenLastCalledWith(tools[1]);
    rerender(<ToolList tools={[tools[0]]} onSelect={select} />);
    fireEvent.keyDown(list, { key: "Enter" });
    expect(select).toHaveBeenLastCalledWith(tools[0]);
    rerender(<ToolList tools={[]} onSelect={select} empty="空列表" />);
    expect(screen.getByText("空列表")).toBeTruthy();
  });
});
