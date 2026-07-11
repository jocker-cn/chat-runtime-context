import type { Message } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { groupAdjacentMessages } from "../../../src/core/frame/messageGroups";

const context = {
  threadId: "thread-1",
  turnId: "turn-1",
  branchId: "branch-1",
};

describe("groupAdjacentMessages", () => {
  it("keeps every message from one branch run in one response frame", () => {
    const messages = [
      createMessage("thinking-1", "activity"),
      createMessage("tool-1", "tool"),
      createMessage("answer-1", "assistant"),
    ];

    const groups = groupAdjacentMessages(messages, context);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.pairId).toBe("response");
    expect(groups[0]?.items).toBe(messages);
    expect(groups[0]?.id).toBe("thread-1:turn-1:branch-1:response");
  });

  it("does not let backend-specific pair ids split a turn", () => {
    const messages = [
      { ...createMessage("thinking-1", "activity"), pairId: "thinking" },
      { ...createMessage("answer-1", "assistant"), pairId: "answer" },
    ];

    const groups = groupAdjacentMessages(messages, context);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toEqual(messages);
  });

  it("does not create an empty response frame", () => {
    expect(groupAdjacentMessages([], context)).toEqual([]);
  });
});

function createMessage(id: string, role: Message["role"]): Message {
  return {
    id,
    role,
    content: role === "activity" ? {} : id,
    ...(role === "activity" ? { activityType: "thinking" } : {}),
    ...(role === "tool" ? { toolCallId: "tool-call-1" } : {}),
  } as Message;
}
