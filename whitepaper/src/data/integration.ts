import type { IntegrationStep } from "./model";

export const quickStartCode = `import {
  ChatRuntimeView,
  SingleAgentRuntime,
  createAgUiAgentSource,
  createFrameRenderer,
} from "chat-runtime-context";

const source = createAgUiAgentSource({
  id: "primary-agent",
  agent,
});

const runtime = new SingleAgentRuntime({
  source,
  createInputMessage: (content: string, turnId) => ({
    id: \`user-\${turnId}\`,
    role: "user",
    content,
  }),
});

const renderer = createFrameRenderer({
  cards: {
    assistant: AssistantCard,
    activity: ActivityCard,
  },
  fallback: UnknownMessageCard,
});

export function Chat() {
  return (
    <ChatRuntimeView
      runtime={runtime}
      renderer={renderer}
      renderInput={UserCard}
      loadingIndicator={<ChatLoading />}
    />
  );
}`;

export const integrationSteps: readonly IntegrationStep[] = [
  {
    id: "agent",
    title: "准备 AG-UI Agent",
    summary: "业务持有 Agent、连接参数与传输恢复策略。",
    owner: "用户",
    sceneId: "source",
    nodeId: "agui-agent",
    checks: [
      "Agent.messages 是消息事实来源",
      "runAgent 能在每次发送时按业务策略连接或重连",
      "正常 close 与异常断开由业务 Agent 区分",
    ],
  },
  {
    id: "source",
    title: "把 Agent 适配为 Source",
    summary: "createAgUiAgentSource 同时提供执行协议和 messageReader。",
    owner: "Core",
    sceneId: "source",
    nodeId: "agui-source",
    code: `const source = createAgUiAgentSource({
  id: "primary-agent",
  label: "Primary",
  agent,
});`,
    checks: [
      "Source 实例在 Runtime 生命周期内保持稳定",
      "不在 View 或 Card render 中重复创建 Source",
    ],
  },
  {
    id: "runtime",
    title: "创建 Single 或 Compare Runtime",
    summary: "createInputMessage 是必需边界；Runtime 不猜测用户消息结构。",
    owner: "用户",
    sceneId: "runtime",
    nodeId: "single-runtime",
    code: `const runtime = new SingleAgentRuntime({
  source,
  createInputMessage: (content: string, turnId) => ({
    id: \`user-\${turnId}\`,
    role: "user",
    content,
  }),
});`,
    checks: [
      "Runtime 实例不会在 React render 中重新创建",
      "message.id、Turn ID 与 Branch ID 在自己的作用域内唯一",
    ],
  },
  {
    id: "renderer",
    title: "注册业务 Card",
    summary: "按 message.role 和 condition 把消息交给业务组件。",
    owner: "用户",
    sceneId: "rendering",
    nodeId: "frame-renderer",
    code: `const renderer = createFrameRenderer({
  cards: {
    assistant: AssistantCard,
    activity: [
      {
        condition: (message) => message.activityType === "error",
        card: AssistantErrorCard,
      },
    ],
  },
  fallback: UnknownMessageCard,
});`,
    checks: [
      "Card 使用 message.id 之外的业务字段展示内容",
      "网络 Effect 依赖语义参数并实现幂等、缓存或取消",
      "Card 不主动订阅整个 branch messageReader",
    ],
  },
  {
    id: "view",
    title: "挂载 ChatRuntimeView",
    summary: "Core 自动装配 Turn、Branch、FrameSlot 和键盘焦点边界。",
    owner: "用户",
    sceneId: "rendering",
    nodeId: "runtime-view",
    code: `<ChatRuntimeView
  runtime={runtime}
  renderer={renderer}
  renderInput={UserCard}
  loadingIndicator={<ChatLoading />}
/>`,
    checks: [
      "导入 Core default.css 或提供完整 classNames",
      "Compare 模式确认 showOnlySelectedBranch 策略",
    ],
  },
  {
    id: "send",
    title: "发送第一条消息",
    summary: "调用 send；如需串行提交则在外层接入 SubmissionQueue。",
    owner: "用户",
    sceneId: "integration",
    nodeId: "send-message",
    code: `await clearErrorMessagesBeforeSend(runtime);
await runtime.send(input);`,
    checks: [
      "不要直接操作 Turn/Branch snapshot",
      "Compare 只运行部分 Source 时传 source branchIds",
      "AI/User Error Card 使用公开 Error Operations，而不是 agent.addMessage 绕过 Runtime topology",
    ],
  },
];
