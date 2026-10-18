// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRenderer, type DemoChatExtensions } from "../../../src/chat/demo/demoRenderer";
import type { DemoMessage } from "../../../src/chat/demo/demoMessage";
import {
  ChatRuntimeView, CompareChatRuntime, createChatExtensionStore,
  createMessageStore, findChatMessageById,
} from "../../../src/core";

const original = '\n## 原始回复 🚀\n\n| 名称 | 值 |\n| --- | --- |\n| A | **原文** |\n\n```tsx\n\t<Widget title="a & b" />\n```\n\n[资料](https://example.com)  \n\n';
const runtimes: CompareChatRuntime<string, DemoMessage>[] = [];

beforeEach(() => {
  // Tiptap measures its selection when focusing; jsdom has no layout.
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => [] as unknown as DOMRectList;
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
});

afterEach(async () => {
  cleanup();
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.dispose()));
  vi.restoreAllMocks();
});

function createChat(allowMessageEditing = true) {
  const message: DemoMessage = { id: "answer", role: "assistant", content: original };
  const messageStore = createMessageStore<DemoMessage>([message]);
  const runtime = new CompareChatRuntime<string, DemoMessage>({
    createInputMessage: (content, turnId) => ({ id: `${turnId}:input`, role: "user", content }),
    sources: [{
      branchId: "agent-a",
      source: {
        id: "agent-a", messageReader: messageStore,
        async *run() { yield { type: "branch-completed" }; },
      },
    }],
    historyTurns: [{
      id: "answer-turn",
      inputMessage: { id: "question", role: "user", content: "Original question" },
      messageIds: [message.id],
    }],
  });
  runtimes.push(runtime);
  const chatFromHere = vi.fn();
  const extensions: DemoChatExtensions = Object.assign(createChatExtensionStore(), {
    allowMessageEditing, chatFromHere,
    resolveMessageById: (id: string) => findChatMessageById(runtime, id),
  });
  const ui = <ChatRuntimeView runtime={runtime} renderer={demoRenderer} extensions={extensions} />;
  return { message, runtime, messageStore, chatFromHere, ui };
}

async function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
  return screen.findByRole("textbox", { name: "消息 Markdown 源码" });
}

async function replaceSource(source: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.input(source.querySelector("code")!, { target: { textContent: text } });
  });
}

describe("Assistant inline message editing", () => {
  it("loads and round-trips the full Markdown source without converting or trimming it", async () => {
    render(createChat().ui);
    const card = screen.getByRole("article", { name: "AI response" });
    const source = await openEditor();
    expect(card.contains(source)).toBe(true);
    expect(source.textContent).toBe(original);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat from here" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("heading", { name: "原始回复 🚀" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "编辑消息" }));
    expect((await openEditor()).textContent).toBe(original);
  });

  it("previews a draft, saves it locally, and cancels later changes without changing the source or reference", async () => {
    const chat = createChat();
    render(chat.ui);
    const source = await openEditor();
    const edited = "## 新标题\n\n- **保存后的内容**\n\n```js\nconst x = 1;\n```\n";
    await replaceSource(source, edited);
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    const preview = screen.getByRole("region", { name: "消息预览" });
    await within(preview).findByRole("heading", { name: "新标题" });
    expect(preview.querySelector("strong")?.textContent).toBe("保存后的内容");
    expect(preview.querySelector("pre code")?.textContent).toBe("const x = 1;\n");
    fireEvent.click(screen.getByRole("button", { name: "编辑源码" }));
    expect(screen.getByRole("textbox", { name: "消息 Markdown 源码" })).toBe(source);
    expect(source.textContent).toBe(edited);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("heading", { name: "新标题" })).toBeTruthy();
    expect(chat.messageStore.getMessages()[0]).toBe(chat.message);
    expect(findChatMessageById(chat.runtime, chat.message.id)?.content).toBe(original);
    fireEvent.click(screen.getByRole("button", { name: "Chat from here" }));
    expect(chat.chatFromHere).toHaveBeenCalledWith(chat.message, expect.anything());
    expect(chat.message.content).toBe(original);
    const reopened = await openEditor();
    expect(reopened.textContent).toBe(edited);
    await replaceSource(reopened, "Unsaved draft");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "新标题" })).toBeTruthy();
    expect(screen.queryByText("Unsaved draft")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "编辑消息" }));
    expect((await openEditor()).textContent).toBe(edited);
  });

  it("keeps an intentionally empty saved body and restores the original after remounting", async () => {
    const chat = createChat();
    const view = render(chat.ui);
    await replaceSource(await openEditor(), "");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.queryByRole("heading", { name: "原始回复 🚀" })).toBeNull();
    expect((await openEditor()).textContent).toBe("");
    view.unmount();
    render(chat.ui);
    expect(screen.getByRole("heading", { name: "原始回复 🚀" })).toBeTruthy();
    expect((await openEditor()).textContent).toBe(original);
  });

  it("accepts pasted source as plain text and preserves leading spaces, blank lines and trailing newlines", async () => {
    render(createChat().ui);
    const source = await openEditor();
    const pasted = "  <div>literal HTML</div>\n\n\t```md\n# source\n```\n\n";
    fireEvent.paste(source, { clipboardData: {
      getData: (type: string) => type === "text/plain" ? pasted : "<b>unwanted HTML</b>",
    } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await openEditor()).textContent).toBe(pasted + original);
  });

  it("leaves existing demo cards unchanged unless editing is enabled", () => {
    render(createChat(false).ui);
    expect(screen.queryByRole("button", { name: "编辑消息" })).toBeNull();
    expect(screen.getByRole("button", { name: "Chat from here" })).toBeTruthy();
  });
});
