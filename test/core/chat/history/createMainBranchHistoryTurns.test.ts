import type { Message } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { createMainBranchHistoryTurns } from "../../../../src/core";

describe("createMainBranchHistoryTurns", () => {
  it("keeps a history turn that contains only a user message", () => {
    const userMessage: Message = {
      id: "user-only",
      role: "user",
      content: "No answer was generated",
    };

    const turns = createMainBranchHistoryTurns({ messages: [userMessage] });

    expect(turns).toEqual([
      expect.objectContaining({
        id: "history-user-only",
        inputMessage: userMessage,
        messageIds: [],
      }),
    ]);
  });

  it("creates an input-less turn for AI-only history", () => {
    const messages: Message[] = [
      { id: "thinking", role: "reasoning", content: "Working" },
      { id: "answer", role: "assistant", content: "Done" },
    ];

    const turns = createMainBranchHistoryTurns({ messages });

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "history-thinking",
      inputMessage: undefined,
      messageIds: ["thinking", "answer"],
    });
  });

  it("keeps a leading AI-only fragment separate from following user turns", () => {
    const messages: Message[] = [
      { id: "orphan-answer", role: "assistant", content: "Earlier answer" },
      { id: "later-user", role: "user", content: "Later question" },
    ];

    const turns = createMainBranchHistoryTurns({ messages });

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      id: "history-orphan-answer",
      inputMessage: undefined,
      messageIds: ["orphan-answer"],
    });
    expect(turns[1]).toMatchObject({
      inputMessage: messages[1],
      messageIds: [],
    });
  });
});
