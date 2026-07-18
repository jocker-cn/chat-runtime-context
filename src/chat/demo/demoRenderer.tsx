import type { Message } from "@ag-ui/client";
import { useEffect, useId } from "react";
import {
  createFrameRenderer,
  useSelectBranch,
  type FrameCardProps,
} from "../../core";
import {
  isDemoAiErrorMessage,
  type DemoMessage,
} from "./demoMessage";
import { MarkdownMessage } from "./MarkdownMessage";
import { ThinkContent } from "./ThinkContent";
import {
  isThinkingActivityMessage,
  type ThinkingActivityPhase,
} from "./thinkingActivity";
import { ApiRequestAction } from "./ApiRequestAction";

export const demoRenderer = createFrameRenderer<DemoMessage>({
  cards: {
    user: UserMessageCard,
    assistant: AssistantMessageCard,
    reasoning: ReasoningMessageCard,
    activity: [
      {
        condition: isDemoAiErrorMessage,
        card: AiErrorMessageCard,
      },
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
  const contentId = useId();
  const isError = message.status === "error";

  return (
    <article
      className="message-card message-card-user"
      data-status={isError ? "error" : undefined}
      tabIndex={0}
      aria-label={isError ? "User message failed" : "User message"}
      aria-describedby={contentId}
    >
      {isError ? (
        <strong className="message-card-error-label">Failed to send</strong>
      ) : null}
      <div id={contentId}>{messageText(message)}</div>
    </article>
  );
}

function AiErrorMessageCard({ message }: FrameCardProps<DemoMessage>) {
  const contentId = useId();
  if (!isDemoAiErrorMessage(message)) {
    return null;
  }

  return (
    <article
      className="message-card message-card-ai-error"
      tabIndex={0}
      aria-label="AI error"
      aria-describedby={contentId}
    >
      <strong className="message-card-error-label">AI response error</strong>
      <div id={contentId} role="alert">
        {activityErrorText(message)}
      </div>
    </article>
  );
}

function AssistantMessageCard({
  message,
  context,
}: FrameCardProps<DemoMessage>) {
  const selectBranch = useSelectBranch();
  const isSelected = context.isSelectedBranch;
  const contentId = useId();
  useEffect(() => {
    console.log({message})
  }, []);
  return (
    <article
      className="message-card message-card-assistant"
      tabIndex={0}
      aria-label="AI response"
      aria-describedby={contentId}
    >
      <div id={contentId}>
        <MarkdownMessage
          content={messageText(message)}
          actions={message.actions}
        />
      </div>
      <ApiRequestAction />
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
    </article>
  );
}

function ReasoningMessageCard({ message }: FrameCardProps<DemoMessage>) {
  const contentId = useId();
  return (
    <article
      className="message-card message-card-reasoning"
      tabIndex={0}
      aria-label="AI reasoning"
      aria-describedby={contentId}
    >
      <div id={contentId}>
        <MarkdownMessage content={messageText(message)} />
      </div>
    </article>
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
  const contentId = useId();

  return (
    <pre
      className="message-card message-card-tool"
      role="article"
      tabIndex={0}
      aria-label="Tool message"
      aria-describedby={contentId}
    >
      <code id={contentId}>{messageText(message)}</code>
    </pre>
  );
}

function FallbackMessageCard({ message }: FrameCardProps<DemoMessage>) {
  const contentId = useId();

  return (
    <article
      className="message-card"
      tabIndex={0}
      aria-label={`${capitalize(message.role)} message`}
      aria-describedby={contentId}
    >
      <strong>{message.role}</strong>
      <p id={contentId}>{messageText(message)}</p>
    </article>
  );
}

function capitalize(value: string) {
  return value.length > 0
    ? `${value[0]?.toUpperCase()}${value.slice(1)}`
    : value;
}

function activityErrorText(message: DemoMessage) {
  const content: unknown = message.content;
  if (typeof content === "string") {
    return content;
  }

  if (
    content &&
    typeof content === "object" &&
    "message" in content &&
    typeof content.message === "string"
  ) {
    return content.message;
  }

  return "The connection was interrupted.";
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
