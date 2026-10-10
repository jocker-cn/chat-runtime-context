import type { DemoMessage } from "../demoMessage";

export interface PocChatSession {
  id: string;
  title: string;
}

/** Data-only mock API. Replace these operations with BE calls, not the chat UI. */
export function createMockChatData() {
  const sessions: PocChatSession[] = [{ id: "extension-poc", title: "发布风险讨论" }];
  const histories = new Map<string, DemoMessage[]>([["extension-poc", createInitialChatHistory()]]);
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const find = (id: string) => {
    const session = sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Unknown chat session: ${id}`);
    return session;
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async listSessions() { return structuredClone(sessions); },
    async getSession(id: string) { return structuredClone(find(id)); },
    async createSession() {
      const session = { id: crypto.randomUUID(), title: "新对话" };
      sessions.unshift(session);
      histories.set(session.id, []);
      changed();
      return structuredClone(session);
    },
    async renameSession(id: string, title: string) { find(id).title = title; changed(); },
    async getHistory(id: string): Promise<DemoMessage[]> { find(id); return structuredClone(histories.get(id)!); },
    async saveHistory(id: string, messages: DemoMessage[]) { find(id); histories.set(id, structuredClone(messages)); },
  };
}

export const chatData = createMockChatData();

export function createInitialChatHistory(): DemoMessage[] {
  return [
    {
      id: "history-a-1:user",
      role: "user",
      content: "帮我总结一下发布 ID 2131 的风险。",
    },
    {
      id: "history-a-1:assistant",
      role: "assistant",
      content:
        "已确认发布 ID 2131。当前主要风险集中在发布说明缺少回滚口径、灰度观察指标不完整，以及上线后通知链路需要补充负责人。",
    },
    {
      id: "history-a-2:user",
      role: "user",
      content: "如果今晚发布，优先处理哪几个风险？",
    },
    {
      id: "history-a-2:assistant",
      role: "assistant",
      content: `## 发布风险评估

> **结论：** 今晚可以发布，但必须先关闭 P0 风险，并为 P1 风险指定负责人。

| 优先级 | 风险项 | 当前状态 | 建议动作 |
| :--- | :--- | :---: | :--- |
| P0 | 回滚验证记录 | 未完成 | 补跑回滚演练并上传记录 |
| P0 | 灰度指标阈值 | 待确认 | 明确错误率和延迟阈值 |
| P1 | 客服通知模板 | 草稿 | 发布前完成审核 |

### 快捷操作

| [生成检查单](#action:checklist) | [查看回滚方案](#action:rollback) |
| --- | --- |
| [AG-UI 文档](https://docs.ag-ui.com/) | [React 文档](https://react.dev/) |

### 今晚执行顺序

1. 运行发布前检查命令。
2. 确认回滚负责人和观察窗口。
3. 完成灰度后再扩大流量。

- [x] 发布说明已完成
- [ ] 回滚记录已归档
- [ ] 观察指标已确认

相关资料：[AG-UI 文档](https://docs.ag-ui.com/)

\`\`\`bash
pnpm release:check --id 2131 --strict
\`\`\``,
      actions: [
        {
          id: "checklist",
          label: "生成检查单",
          result: "检查单已生成：2 个 P0 项、1 个 P1 项等待处理。",
        },
        {
          id: "rollback",
          label: "查看回滚方案",
          result: "回滚方案：停止扩量，回退版本，并持续观察核心指标 15 分钟。",
        },
      ],
    },
  ];
}

