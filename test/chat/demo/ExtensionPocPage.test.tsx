// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionPocPage } from "../../../src/chat/demo/extension-poc/ExtensionPocPage";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ExtensionPocPage", () => {
  it("creates a typed MCP config and toggles the second Compare agent", () => {
    render(<ExtensionPocPage />);

    expect(screen.getByRole("heading", { name: "Chat 工作区" })).toBeTruthy();
    const secondAgent = screen.getByRole("checkbox", { name: /Agent B/ });
    expect((secondAgent as HTMLInputElement).checked).toBe(true);
    fireEvent.click(secondAgent);
    expect((secondAgent as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "+ MCP" }));
    fireEvent.change(screen.getByPlaceholderText("例如：我的MCP"), {
      target: { value: "本地发布工具" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://example.com/mcp"), {
      target: { value: "https://example.com/release/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    expect(screen.getByRole("button", { name: "本地发布工具" })).toBeTruthy();
    expect(window.localStorage.getItem("chat-runtime.extension-poc.v1"))
      .toContain("本地发布工具");
  });

  it("opens the slash picker and selects an existing extension", () => {
    render(<ExtensionPocPage />);

    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    expect(screen.getByRole("listbox", { name: "选择扩展" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /发布助手/ }));
    expect(screen.getByRole("button", { name: "移除扩展" })).toBeTruthy();
  });
});
