import type { Message } from "@ag-ui/client";
import { useSelectBranch } from "../../core/context/ChatContext";
import { createFrameRenderer } from "../../core/frame/createFrameRenderer";
import type { FrameCardProps } from "../../core/frame/createFrameRenderer";
import type { DemoMessage } from "./demoRuntime";

export const demoRenderer = createFrameRenderer<DemoMessage>({
  cards: {
    user: UserMessageCard,
    assistant: AssistantMessageCard,
    reasoning: ReasoningMessageCard,
    tool: ToolMessageCard,
  },
  fallback: FallbackMessageCard,
});

function UserMessageCard({ message }: FrameCardProps<DemoMessage>) {
  return (
    <div className="message-card message-card-user">
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
