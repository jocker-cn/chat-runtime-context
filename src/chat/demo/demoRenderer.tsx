import type { Message } from "@ag-ui/client";
import { useSelectBranch } from "../../core/context/ChatContext";
import { createFrameRenderer } from "../../core/frame/createFrameRenderer";
import type { FrameCardProps } from "../../core/frame/createFrameRenderer";
import type { DemoMessage } from "./demoRuntime";
import { ThinkContent } from "./ThinkContent";
import {
  isThinkingActivityMessage,
  type ThinkingActivityPhase,
} from "./thinkingActivity";

export const demoRenderer = createFrameRenderer<DemoMessage>({
  cards: {
    user: UserMessageCard,
    assistant: AssistantMessageCard,
    reasoning: ReasoningMessageCard,
    activity: [
      {
        condition: isThinkingActivityMessage,
        card: ThinkingActivityCard,
      },
    ],
    tool: ToolMessageCard,
  },
  fallback: FallbackMessageCard,
});

function UserMessageCard({ message }: FrameCardProps<DemoMessage>) {
  return (
    <div className="message-card message-card-user" tabIndex={0}>
      {messageText(message)}
    </div>
  );
}

function AssistantMessageCard({
  message,
  context,
}: FrameCardProps<DemoMessage>) {
  const selectBranch = useSelectBranch();
  const isSelected = context.isSelectedBranch;

  return (
    <div className="message-card message-card-assistant">
      <div>{messageText(message)}</div>
      <div className="message-card-actions">
        <button
          type="button"
          disabled={isSelected}
          onClick={() => {
            selectBranch(context.turnId, context.branchId, {
              score: 1,
              metadata: {
                sourceId: context.sourceId,
              },
            });
          }}
        >
          {isSelected ? "已选择" : "选择"}
        </button>
      </div>
    </div>
  );
}

function ReasoningMessageCard({ message }: FrameCardProps<DemoMessage>) {
  return (
    <div className="message-card message-card-reasoning">
      {messageText(message)}
    </div>
  );
}

function ThinkingActivityCard({ message }: FrameCardProps<DemoMessage>) {
  if (!isThinkingActivityMessage(message)) {
    return null;
  }

  return (
    <ThinkContent
      title={thinkingTitle(message.content.phase)}
      phase={message.content.phase}
    >
      {message.content.text}
    </ThinkContent>
  );
}

function thinkingTitle(phase: ThinkingActivityPhase) {
  switch (phase) {
    case "processing":
      return "Processing";
    case "thought":
      return "Thought";
    case "completed":
      return "How AI Think";
  }
}

function ToolMessageCard({ message }: FrameCardProps<DemoMessage>) {
  return (
    <pre className="message-card message-card-tool">
      {messageText(message)}
    </pre>
  );
}

function FallbackMessageCard({ message }: FrameCardProps<DemoMessage>) {
  return (
    <div className="message-card">
      <strong>{message.role}</strong>
      <p>{messageText(message)}</p>
    </div>
  );
}

function messageText(message: Message) {
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text") {
          return part.text;
        }

        return `[${part.type}]`;
      })
      .join("\n");
  }

  return "";
}
