import { describe, expect, it } from "vitest";
import {
  createDemoChatSessions, createPocChatSession, nameChatSessionFromMessage,
} from "../../../src/chat/demo/extension-poc/chatSessionModel";

describe("POC chat session metadata", () => {
  it("starts new sessions empty with distinct IDs", () => {
    const first = createPocChatSession();
    const second = createPocChatSession();
    expect(first.id).not.toBe(second.id);
    expect(first.includeDemoHistory).toBe(false);
    expect(createDemoChatSessions()[0]?.includeDemoHistory).toBe(true);
  });

  it("names only the target session from its first message without mutating metadata", () => {
    const session = createPocChatSession();
    const seed = createDemoChatSessions()[0]!;
    const original = [seed, session];
    const next = nameChatSessionFromMessage(original, session.id, "  帮我总结\n发布风险  ");
    expect(next[0]).toBe(seed);
    expect(next[1]?.title).toBe("帮我总结 发布风险");
    expect(session.title).toBe("新对话");
    expect(nameChatSessionFromMessage(next, session.id, "第二条消息")[1]?.title).toBe("帮我总结 发布风险");
  });
});
