import { describe, expect, it } from "vitest";
import { createMockChatData as createMemoryChatSessionRepository } from "../../../src/chat/demo/extension-poc/chatHistory";

describe("session data repository", () => {
  it("queries history by ID without session UI flags or Runtime objects", async () => {
    const repository = createMemoryChatSessionRepository();
    expect(await repository.listSessions()).toEqual([{ id: "extension-poc", title: "发布风险讨论" }]);
    const first = await repository.createSession();
    const second = await repository.createSession();
    expect(first.id).not.toBe(second.id);
    expect(first).toEqual({ id: expect.any(String), title: "新对话" });
    expect(await repository.getHistory(first.id)).toEqual([]);
    const history = await repository.getHistory("extension-poc");
    expect(history).toHaveLength(4);
    await repository.saveHistory(first.id, history);
    history.length = 0;
    expect(await repository.getHistory(first.id)).toHaveLength(4);
    expect(await repository.getHistory(second.id)).toHaveLength(0);
    const loaded = await repository.getHistory(first.id);
    loaded.length = 0;
    expect(await repository.getHistory(first.id)).toHaveLength(4);
  });

  it("persists titles independently and rejects unknown sessions", async () => {
    const repository = createMemoryChatSessionRepository();
    const session = await repository.createSession();
    await repository.renameSession(session.id, "发布检查");
    expect((await repository.listSessions())[0]).toEqual({ id: session.id, title: "发布检查" });
    await expect(repository.getHistory("unknown")).rejects.toThrow("Unknown chat session");
    await expect(repository.saveHistory("unknown", [])).rejects.toThrow("Unknown chat session");
  });
});
