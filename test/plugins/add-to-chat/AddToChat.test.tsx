// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerAddToChat,
  unregisterAddToChat,
} from "../../../src/core";

const registrationIds = new Set<string>();

afterEach(() => {
  registrationIds.forEach(unregisterAddToChat);
  registrationIds.clear();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

describe("Add to Chat", () => {
  it("adds independent references without wrapping the selected content", async () => {
    const { frame, referenceHost } = createChatDom("chat-a");
    const handle = register({
      id: "chat-a",
      selectionRoot: "#chat-a .crt-runtime",
      referenceHost: "#chat-a [data-chat-reference-host]",
      createReferenceId: createIdSequence("reference"),
    });

    selectText(frame.querySelector("span")!.firstChild!, 0, 5);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to chat" }));

    expect(handle.getReferences()).toEqual([
      expect.objectContaining({
        id: "reference-1",
        type: "text-selection",
        text: "First",
        source: expect.objectContaining({
          type: "chat-frame",
          threadId: "thread-chat-a",
          turnId: "turn-chat-a",
          branchId: "branch-chat-a",
          frameId: "frame-chat-a",
        }),
      }),
    ]);
    expect(referenceHost.textContent).toContain("First");
    expect(frame.parentElement?.closest("[data-add-to-chat-mount]")).toBeNull();

    const secondText = frame.querySelectorAll("span")[1]!.firstChild!;
    selectText(secondText, 0, 6);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to chat" }));

    expect(handle.getReferences().map(({ text }) => text)).toEqual([
      "First",
      "Second",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove reference 1" }));
    expect(handle.getReferences().map(({ text }) => text)).toEqual(["Second"]);
  });

  it("isolates state by registration id", async () => {
    const first = createChatDom("first");
    createChatDom("second");
    const firstHandle = register({
      id: "first",
      selectionRoot: "#first .crt-runtime",
      referenceHost: "#first [data-chat-reference-host]",
      createReferenceId: () => "first-reference",
    });
    const secondHandle = register({
      id: "second",
      selectionRoot: "#second .crt-runtime",
      referenceHost: "#second [data-chat-reference-host]",
    });

    selectText(first.frame.querySelector("span")!.firstChild!, 0, 5);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to chat" }));

    expect(firstHandle.getReferences()).toHaveLength(1);
    expect(secondHandle.getReferences()).toEqual([]);
  });

  it("keeps one store when the same id is registered again", async () => {
    const { frame } = createChatDom("stable");
    const firstHandle = register({
      id: "stable",
      selectionRoot: "#stable .crt-runtime",
      referenceHost: "#stable [data-chat-reference-host]",
      createReferenceId: () => "stable-reference",
    });

    selectText(frame.querySelector("span")!.firstChild!, 0, 5);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to chat" }));

    const secondHandle = registerAddToChat({
      id: "stable",
      selectionRoot: "#stable .crt-runtime",
      referenceHost: "#stable [data-chat-reference-host]",
    });
    expect(secondHandle).toBe(firstHandle);
    expect(secondHandle.getReferences()).toHaveLength(1);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-add-to-chat-mount="stable"]'))
        .toHaveLength(1);
    });
  });
});

function register(
  options: Parameters<typeof registerAddToChat>[0],
) {
  registrationIds.add(options.id);
  return registerAddToChat(options);
}

function createChatDom(id: string) {
  const shell = document.createElement("section");
  shell.id = id;
  shell.dataset.chatThreadId = `thread-${id}`;
  shell.innerHTML = `
    <div class="crt-runtime">
      <article data-turn-id="turn-${id}">
        <section data-branch-id="branch-${id}">
          <div data-frame-id="frame-${id}">
            <span>First source</span>
            <span>Second source</span>
          </div>
        </section>
      </article>
    </div>
    <div data-chat-reference-host></div>
  `;
  document.body.append(shell);
  return {
    frame: shell.querySelector<HTMLElement>("[data-frame-id]")!,
    referenceHost: shell.querySelector<HTMLElement>(
      "[data-chat-reference-host]",
    )!,
  };
}

function selectText(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function createIdSequence(prefix: string) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}
