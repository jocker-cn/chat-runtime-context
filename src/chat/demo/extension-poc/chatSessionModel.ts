/** UI session metadata; Runtime instances and editor state are not part of the POJO. */
export interface PocChatSession {
  id: string;
  title: string;
  includeDemoHistory: boolean;
  hasMessageTitle: boolean;
}

export function createDemoChatSessions(): PocChatSession[] {
  return [{
    id: "extension-poc",
    title: "发布风险讨论",
    includeDemoHistory: true,
    hasMessageTitle: true,
  }];
}

export function createPocChatSession(): PocChatSession {
  return {
    id: `extension-poc:${crypto.randomUUID()}`,
    title: "新对话",
    includeDemoHistory: false,
    hasMessageTitle: false,
  };
}

export function nameChatSessionFromMessage(
  sessions: readonly PocChatSession[], id: string, text: string,
): PocChatSession[] {
  return sessions.map((session) => {
    if (session.id !== id || session.hasMessageTitle) return session;
    const characters = Array.from(text.trim().replace(/\s+/g, " "));
    if (!characters.length) return session;
    return {
      ...session,
      title: characters.slice(0, 24).join("") + (characters.length > 24 ? "…" : ""),
      hasMessageTitle: true,
    };
  });
}
