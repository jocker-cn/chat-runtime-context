// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionPocLayout } from "../../../src/chat/demo/extension-poc/ExtensionPocLayout";
import {ExtensionPocPage} from "../../../src/chat/demo/extension-poc/ExtensionPocPage";
import { webcrypto } from "node:crypto";
import { SkillWorkspace, createMemoryAiRepository } from "../../../src/features/ai-config";
import { StrictMode } from "react";
import * as pocRuntime from "../../../src/chat/demo/extension-poc/extensionPocRuntime";
import { chatData, createMockChatData as createMemoryChatSessionRepository } from "../../../src/chat/demo/extension-poc/chatHistory";
import * as config from "../../../src/chat/demo/extension-poc/extensionWorkspace";
import {createBrowserExtensionRepository} from "../../../src/chat/demo/extension-poc/extensionRepository";
type ChatSessionRepository = ReturnType<typeof createMemoryChatSessionRepository>;
let skillRepository: ReturnType<typeof createMemoryAiRepository>;
function useChatData(data: ChatSessionRepository) {
  for (const key of Object.keys(data) as (keyof ChatSessionRepository)[]) {
    vi.spyOn(chatData, key).mockImplementation(data[key] as never);
  }
}
import { FakeSocket } from "./backendSocketMock";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  window.localStorage.clear();
  useChatData(createMemoryChatSessionRepository());
  skillRepository = createMemoryAiRepository();
  const skills = new SkillWorkspace(skillRepository);
  vi.spyOn(config, "getExtensionWorkspace").mockReturnValue({
    skills, workspace: new config.ExtensionWorkspace(createBrowserExtensionRepository(), () => skills.getSnapshot().published),
  });
  // jsdom has no layout measurements; Tiptap asynchronously scrolls selections.
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => [] as unknown as DOMRectList;
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
});
async function renderPage(chatRepository?: ChatSessionRepository) {
  if (chatRepository) useChatData(chatRepository);
  render(<ExtensionPocLayout />);
  await config.getExtensionWorkspace().skills.start();
  await screen.findByRole("heading", { name: "发布风险讨论" });
  return skillRepository;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeSocket.instances = [];
});

describe("ExtensionPocPage", () => {
  it("works with only a sessionId and does not copy old history into a new session on prop changes", async () => {
    const next = await chatData.createSession();
    const view = render(<ExtensionPocPage sessionId="extension-poc"/>);
    await screen.findByRole("heading", {name: "发布风险讨论"});
    view.rerender(<ExtensionPocPage sessionId={next.id}/>);
    await screen.findByText("从下方输入框开始对话。");
    expect(await chatData.getHistory(next.id)).toEqual([]);
    view.rerender(<ExtensionPocPage sessionId="extension-poc"/>);
    await screen.findByRole("heading", {name: "发布风险讨论"});
    expect(await chatData.getHistory("extension-poc")).toHaveLength(4);
    expect(document.querySelectorAll('[aria-label^="聊天："]')).toHaveLength(1);
  });

  it("locates special-character reference IDs only inside its own viewport", async () => {
    const messages = await chatData.getHistory("extension-poc");
    const id = 'assistant:"special]\\id';
    messages[3]!.id = id;
    vi.spyOn(chatData, "getHistory").mockResolvedValue(messages);
    const outside = document.createElement("article");
    outside.dataset.messageId = id;
    outside.scrollIntoView = vi.fn();
    document.body.append(outside);
    try {
      render(<ExtensionPocPage sessionId="extension-poc"/>);
      const region = await screen.findByRole("region", {name: "聊天：发布风险讨论"});
      const target = Array.from(region.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find((element) => element.dataset.messageId === id)!;
      target.scrollIntoView = vi.fn();
      fireEvent.click(within(target).getByRole("button", {name: "Chat from here"}));
      fireEvent.click(screen.getByRole("button", {name: "定位引用的原消息"}));
      expect(target.scrollIntoView).toHaveBeenCalledOnce();
      expect(outside.scrollIntoView).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(target);
    } finally { outside.remove(); }
  });

  it("locates a draft reference inside this chat without sending a request", async () => {
    await renderPage();
    const target = screen.getByRole("region", { name: "聊天：发布风险讨论" })
      .querySelector<HTMLElement>('[data-message-id="history-a-2:assistant"]')!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    fireEvent.click(within(target).getByRole("button", { name: "Chat from here" }));
    fireEvent.click(screen.getByRole("button", { name: "定位引用的原消息" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center", inline: "nearest" });
    expect(document.activeElement).toBe(target);
  });

  it("previews turns and navigates only within the active chat's viewport", async () => {
    const scrollIntoView = vi.fn();
    await renderPage();
    const target = screen.getByRole("region", { name: "聊天：发布风险讨论" })
      .querySelector<HTMLElement>("[data-turn-id]")!;
    target.scrollIntoView = scrollIntoView;
    const rail = screen.getByRole("navigation", { name: "对话轮次导航" });
    const markers = within(rail).getAllByRole("button");
    expect(markers).toHaveLength(2);
    fireEvent.mouseEnter(markers[0]);
    const preview = screen.getByRole("tooltip");
    expect(preview.textContent).toContain("帮我总结一下发布 ID 2131 的风险。");
    expect(preview.textContent).toContain("已确认发布 ID 2131。");
    fireEvent.click(markers[0]);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start", inline: "nearest" });
    expect(scrollIntoView.mock.instances[0]).toBe(target);
    fireEvent.mouseLeave(rail);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await screen.findByRole("heading", { name: "新对话" });
    expect(screen.queryByRole("navigation", { name: "对话轮次导航" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    await screen.findByRole("heading", { name: "发布风险讨论" });
    expect(await screen.findByRole("navigation", { name: "对话轮次导航" })).toBeTruthy();
  });

  it("searches the management directory without replacing the open editor and confirms saves", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "自定义 MCP" }));
    for (const name of ["发布工具", "查询工具"]) {
      fireEvent.click(screen.getByRole("button", { name: "+ MCP" }));
      fireEvent.change(screen.getByPlaceholderText("例如：我的MCP"), { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
      expect(screen.getByRole("status").textContent).toBe("配置已保存。");
    }
    const directory = screen.getByRole("complementary", { name: "MCP 目录" });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 MCP" }), { target: { value: "发布" } });
    expect(within(directory).getByRole("button", { name: "发布工具" })).toBeTruthy();
    expect(within(directory).queryByRole("button", { name: "查询工具" })).toBeNull();
    expect((screen.getByPlaceholderText("例如：我的MCP") as HTMLInputElement).value).toBe("查询工具");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 MCP" }), { target: { value: "missing" } });
    expect(within(directory).getByText("没有匹配的配置，试试其他关键词。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "自定义 Plugin" }));
    expect((screen.getByRole("searchbox", { name: "搜索 Plugin" }) as HTMLInputElement).value).toBe("");
  });

  it("protects unsaved configs when selecting another page, item or a new chat", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "自定义 Agent" }));
    fireEvent.change(screen.getByPlaceholderText("例如：我的Agent"), { target: { value: "未保存的 Agent" } });
    expect(screen.getByText("未保存修改")).toBeTruthy();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "+ Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "自定义 MCP" }));
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    expect((screen.getByPlaceholderText("例如：我的Agent") as HTMLInputElement).value).toBe("未保存的 Agent");
    expect(screen.getByRole("button", { name: "自定义 Agent" }).getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("region", { name: "聊天历史" })).queryByRole("button", { name: "新对话" })).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(3);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "自定义 MCP" }));
    expect(screen.getByRole("searchbox", { name: "搜索 MCP" })).toBeTruthy();
  });

  it("groups multiple MCPs under one entry and exposes feature-owned details and search", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "自定义 MCP" }));
    for (const name of ["发布工具", "查询工具"]) {
      fireEvent.click(screen.getByRole("button", { name: "+ MCP" }));
      fireEvent.change(screen.getByPlaceholderText("例如：我的MCP"), { target: { value: name } });
      fireEvent.change(screen.getByPlaceholderText("https://example.com/mcp"), {
        target: { value: `https://example.com/${name === "发布工具" ? "release" : "query"}/mcp` },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.queryByRole("option", { name: /发布工具|查询工具/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^MCP/ }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("Endpoint：https://example.com/release/mcp")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索 MCP 条目"), { target: { value: "query/mcp" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /查询工具/ }));
    const token = screen.getByText("mcp:查询工具");
    expect(token.getAttribute("data-extension-kind")).toBe("mcp");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("region", { name: "查询工具 内容" })).toBeTruthy();
  });

  it("returns between categories without inserting a reference and keeps empty groups usable", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    fireEvent.click(screen.getByRole("option", { name: /^MCP/ }));
    expect(screen.getByText(/暂无可用的 MCP/)).toBeTruthy();
    expect(screen.queryByText(/^mcp:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "返回工具分类" }));
    fireEvent.click(screen.getByRole("option", { name: /^Agent/ }));
    expect(screen.getByText(/Prompt：/)).toBeTruthy();
    expect(screen.getByText("1 Skills")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回工具分类" }));
    fireEvent.click(screen.getByRole("option", { name: /^Skill/ }));
    expect(screen.getByText(/已发布 v1/)).toBeTruthy();
  });

  it("creates a typed MCP config and toggles the second Compare agent", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "发布风险讨论" })).toBeTruthy();
    const secondAgent = screen.getByRole("checkbox", { name: /Agent B/ });
    expect((secondAgent as HTMLInputElement).checked).toBe(true);
    fireEvent.click(secondAgent);
    expect((secondAgent as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "自定义 MCP" }));
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

  it("opens the slash picker and selects an existing extension", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    expect(screen.getByRole("listbox", { name: "选择工具分类" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /^Agent/ }));
    fireEvent.click(screen.getByRole("option", { name: /发布助手/ }));
    const token = screen.getByText("agents:发布助手");
    expect(token.getAttribute("data-extension-id")).toBe("release-agent");
    expect(screen.getByRole("region", { name: "发布助手 内容" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭扩展内容" }));
    expect(screen.queryByRole("region", { name: "发布助手 内容" })).toBeNull();
    fireEvent.keyDown(token, { key: "Enter" });
    expect(screen.getByRole("region", { name: "发布助手 内容" })).toBeTruthy();
  });

  it("shortens long Skill names to five characters inside the editor", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    fireEvent.click(screen.getByRole("option", { name: /^Skill/ }));
    fireEvent.click(screen.getByRole("option", { name: /发布风险检查/ }));

    expect(screen.getByText("skills:发布风险检…")).toBeTruthy();
    expect(screen.getByRole("region", { name: "发布风险检查 内容" })).toBeTruthy();
  });

  it("publishes an empty-body Skill without leaving a content preview open", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "自定义 Skill" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "+ Skill" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "+ Skill" }));
    fireEvent.change(screen.getByLabelText("Skill 展示名称"), { target: { value: "空技能" } });
    fireEvent.change(screen.getByLabelText("Skill 标准 name"), { target: { value: "empty-skill" } });
    fireEvent.change(screen.getByLabelText("Skill 工作流指令"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并发布" }));
    await screen.findByText(/已发布 v1；/);
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    fireEvent.click(screen.getByRole("option", { name: /^Skill/ }));
    fireEvent.click(screen.getByRole("option", { name: /空技能/ }));
    expect(screen.getByText("skills:空技能")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "空技能 内容" })).toBeNull());
  });

  it("keeps navigation fixed while feature pages replace the right-hand chat view", async () => {
    await renderPage();
    const navigation = screen.getByRole("complementary", { name: "工作台导航" });
    for (const kind of ["Plugin", "Agent", "Skill", "MCP"]) {
      const entry = within(navigation).getByRole("button", { name: `自定义 ${kind}` });
      fireEvent.click(entry);
      expect(entry.getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("heading", { name: kind === "Skill" ? "Skills" : kind })).toBeTruthy();
      expect(screen.queryByText("EXTENSION SETTINGS")).toBeNull();
      expect(screen.queryByRole("heading", { name: `自定义 ${kind}` })).toBeNull();
      expect(screen.queryByRole("button", { name: "返回聊天" })).toBeNull();
      expect(screen.queryByRole("button", { name: "打开扩展命令菜单" })).toBeNull();
      expect(screen.getByRole("region", { name: "聊天历史" })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    expect(screen.queryByRole("region", { name: "扩展管理页面" })).toBeNull();
    expect(screen.getByRole("button", { name: "打开扩展命令菜单" })).toBeTruthy();
  });

  it("preserves the current input and Agent B setting when visiting a feature page", async () => {
    const createRuntime = vi.spyOn(pocRuntime, "createExtensionPocRuntime");
    await renderPage();
    const runtimeCount = createRuntime.mock.calls.length;
    const secondary = screen.getByRole("checkbox", { name: /Agent B/ });
    fireEvent.click(secondary);
    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    fireEvent.click(screen.getByRole("option", { name: /^Skill/ }));
    fireEvent.click(screen.getByRole("option", { name: /发布风险检查/ }));
    const token = screen.getByText("skills:发布风险检…");
    fireEvent.click(screen.getByRole("button", { name: "自定义 Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    expect(screen.getByText("skills:发布风险检…")).toBe(token);
    expect((screen.getByRole("checkbox", { name: /Agent B/ }) as HTMLInputElement).checked).toBe(false);
    expect(createRuntime).toHaveBeenCalledTimes(runtimeCount);
  });

  it("loads one conversation by session ID instead of retaining hidden runtimes and drafts", async () => {
    const createRuntime = vi.spyOn(pocRuntime, "createExtensionPocRuntime");
    const repository = createMemoryChatSessionRepository();
    const getHistory = vi.spyOn(repository, "getHistory");
    await renderPage(repository);
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await screen.findByRole("heading", { name: "新对话" });
    expect(screen.getByText("从下方输入框开始对话。")).toBeTruthy();
    expect(createRuntime.mock.calls.at(-1)?.[0]?.history).toEqual([]);
    const newSessionId = createRuntime.mock.calls.at(-1)?.[0]?.threadId;
    expect(newSessionId).not.toBe("extension-poc");
    expect(createRuntime.mock.results.at(-1)?.value.runtime.getSnapshot().turnIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "打开扩展命令菜单" }));
    fireEvent.click(screen.getByRole("option", { name: /^Agent/ }));
    fireEvent.click(screen.getByRole("option", { name: /发布助手/ }));
    expect(screen.getByText("agents:发布助手")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    await screen.findByRole("heading", { name: "发布风险讨论" });
    expect(within(screen.getByRole("region", { name: "聊天：发布风险讨论" }))
      .queryByText("agents:发布助手")).toBeNull();
    expect(screen.getByRole("heading", { name: "发布风险讨论" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    await screen.findByRole("heading", { name: "新对话" });
    expect(screen.queryByText("agents:发布助手")).toBeNull();
    expect(createRuntime.mock.calls.filter(([options]) => options?.history !== undefined)).toHaveLength(4);
    expect(getHistory.mock.calls.map(([id]) => id)).toEqual([
      "extension-poc", expect.any(String), "extension-poc", newSessionId,
    ]);
    expect(document.querySelectorAll('[aria-label^="聊天："]')).toHaveLength(1);
    expect(createRuntime.mock.results[0]?.value.runtime.getSnapshot().status).toBe("closed");
  });

  it("names a chat after sending and retains its messages when switching histories", async () => {
    // Offline sources verify the UI flow without calling the user's LLM API.
    vi.stubGlobal("WebSocket", class extends FakeSocket {
      constructor(url: string) { super(url); queueMicrotask(() => this.open()); }
      override send(payload: string) {
        super.send(payload);
        const { input } = JSON.parse(payload);
        const prefix = input.threadId.endsWith("agent-a") ? "A" : "B";
        const text = input.messages.filter((message: { role: string }) => message.role === "user").at(-1).content;
        queueMicrotask(() => {
          this.message({ event: "streaming_started", message: { id: `${prefix}-${input.runId}` } });
          this.message({ event: "streaming", message: { id: `${prefix}-${input.runId}`, content: `${prefix} answer: ${text}` } });
          this.message({ event: "streaming_completed", message: { id: `${prefix}-${input.runId}` } });
          this.message({ event: "completed" });
        });
      }
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await screen.findByRole("heading", { name: "新对话" });
    const editor = within(screen.getByRole("region", { name: "聊天：新对话" }))
      .getByLabelText("消息输入框，输入 / 选择扩展");
    fireEvent.input(editor, { target: { textContent: "帮我检查发布风险" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "发送 ↑" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "发送 ↑" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "帮我检查发布风险" })).toBeTruthy());
    await waitFor(() => expect(screen.getByText("A answer: 帮我检查发布风险")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "发布风险讨论" }));
    await screen.findByRole("heading", { name: "发布风险讨论" });
    expect(within(screen.getByRole("region", { name: "聊天：发布风险讨论" }))
      .queryByText("A answer: 帮我检查发布风险")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "帮我检查发布风险" }));
    await screen.findByText("A answer: 帮我检查发布风险");
    expect(screen.queryByText("B answer: 帮我检查发布风险")).toBeNull();
    expect(document.querySelectorAll("article[data-turn-id]")).toHaveLength(1);
  });
  it("loads Skill content under StrictMode and keeps unsaved edits across feature navigation", async () => {
    const createRuntime = vi.spyOn(pocRuntime, "createExtensionPocRuntime");
    render(<StrictMode><ExtensionPocLayout /></StrictMode>);
    await config.getExtensionWorkspace().skills.start();
    await screen.findByRole("heading", { name: "发布风险讨论" });
    fireEvent.click(screen.getByRole("button", { name: "自定义 Skill" }));
    await waitFor(() => expect((screen.getByLabelText("Skill 展示名称") as HTMLInputElement).value).toBe("发布风险检查"));
    fireEvent.change(screen.getByLabelText("Skill 展示名称"), { target: { value: "未保存的名称" } });
    fireEvent.click(screen.getByRole("button", { name: "自定义 MCP" }));
    fireEvent.click(screen.getByRole("button", { name: "自定义 Skill" }));
    expect((screen.getByLabelText("Skill 展示名称") as HTMLInputElement).value).toBe("未保存的名称");
    expect(createRuntime.mock.results.at(-1)?.value.runtime.getSnapshot().status).not.toBe("closed");
  });

  it("ignores a stale history response without hydrating the wrong session", async () => {
    const repository = createMemoryChatSessionRepository();
    const getHistory = repository.getHistory;
    const originalHistory = await getHistory("extension-poc");
    let resolve!: (history: typeof originalHistory) => void;
    const delayed = new Promise<typeof originalHistory>((done) => { resolve = done; });
    vi.spyOn(repository, "getHistory").mockImplementation((id) => id === "extension-poc" ? delayed : getHistory(id));
    const create = vi.spyOn(pocRuntime, "createExtensionPocRuntime");
    useChatData(repository);
    render(<ExtensionPocLayout />);
    await screen.findByRole("button", { name: "发布风险讨论" });
    expect(create.mock.calls.filter(([options]) => options?.history !== undefined)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await screen.findByRole("heading", { name: "新对话" });
    await act(async () => resolve(originalHistory));
    expect(screen.getByRole("heading", { name: "新对话" })).toBeTruthy();
    expect(create.mock.calls.filter(([options]) => options?.history !== undefined)).toHaveLength(1);
    expect(document.querySelectorAll('[aria-label^="聊天："]')).toHaveLength(1);
  });

  it("reports history loading errors without overwriting stored data and retries", async () => {
    const repository = createMemoryChatSessionRepository();
    vi.spyOn(repository, "getHistory").mockRejectedValueOnce(new Error("Offline"));
    const create = vi.spyOn(pocRuntime, "createExtensionPocRuntime");
    useChatData(repository);
    render(<ExtensionPocLayout />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Offline");
    expect(create.mock.calls.filter(([options]) => options?.history !== undefined)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    await screen.findByRole("heading", { name: "发布风险讨论" });
    expect(create.mock.calls.filter(([options]) => options?.history !== undefined)).toHaveLength(1);
  });
});
