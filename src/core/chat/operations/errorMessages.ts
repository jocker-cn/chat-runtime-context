import type { Message } from "@ag-ui/client";
import type {
  ChatBranch,
  ChatMetadata,
  ChatRuntime,
  ChatTurn,
} from "../contracts/chat-runtime";
import type { CompareChatRuntime } from "../runtime/CompareChatRuntime";

type MessageDraft<
  TMessage extends Message,
  TRole extends Message["role"],
  TManagedField extends PropertyKey,
> = Omit<
  Extract<TMessage, { role: TRole }>,
  "id" | "role" | TManagedField
> & {
  id?: string;
};

type StandardStringInput<TMessage extends Message> =
  Message extends TMessage ? string : never;

export type UserErrorMessageInput<TMessage extends Message = Message> =
  | StandardStringInput<TMessage>
  | MessageDraft<TMessage, "user", "status">;

export type AssistantErrorMessageInput<
  TMessage extends Message = Message,
> =
  | StandardStringInput<TMessage>
  | MessageDraft<TMessage, "activity", "activityType">;

/** Adds one Error Message as an independently tracked local Turn. */
export async function addErrorMessage<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  runtime: ChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >,
  message: TMessage,
  branchId?: string,
): Promise<void> {
  if (message.role !== "user" && message.role !== "activity") {
    throw new Error(
      "addErrorMessage requires a User or Activity message.",
    );
  }

  const normalizedMessage = {
    ...message,
    ...(message.role === "user"
      ? { status: "error" }
      : { activityType: "error" }),
  } as TMessage;

  await runtime.sendLocalMessage(normalizedMessage, {
    placement: message.role === "user" ? "input" : "branch",
    ...(branchId !== undefined ? { branchId } : {}),
  });
}

/** Adds a User-side Error Message, filling its ID, role and error status. */
export function addUserErrorMessage<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  runtime: ChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >,
  input: UserErrorMessageInput<TMessage>,
  branchId?: string,
): Promise<void> {
  const draft = typeof input === "string" ? { content: input } : input;
  const message = (
    {
      ...draft,
      id: getDraftId(draft) ?? createErrorMessageId("user"),
      role: "user",
      status: "error",
    }
  ) as unknown as TMessage;

  return addErrorMessage(runtime, message, branchId);
}

/** Adds an AI-side Error Message, filling its ID, role and activity type. */
export function addAssistantErrorMessage<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  runtime: ChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >,
  input: AssistantErrorMessageInput<TMessage>,
  branchId?: string,
): Promise<void> {
  const draft =
    typeof input === "string"
      ? { content: { message: input } }
      : input;
  const message = (
    {
      ...draft,
      id: getDraftId(draft) ?? createErrorMessageId("assistant"),
      role: "activity",
      activityType: "error",
    }
  ) as unknown as TMessage;

  return addErrorMessage(runtime, message, branchId);
}

/**
 * Removes only consecutive Error Turns at the end of the timeline.
 * Physical Source cleanup requires the Source to implement deleteMessages.
 */
export async function clearErrorMessagesBeforeSend<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
>(
  runtime: CompareChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata,
    TSourceMetadata
  >,
): Promise<void> {
  while (true) {
    const snapshot = runtime.getSnapshot();
    const turnId = snapshot.turnIds.at(-1);
    if (!turnId) {
      return;
    }

    const turn = snapshot.turnsById[turnId];
    if (!turn || !isErrorTurn(turn, snapshot.branchesById)) {
      return;
    }

    await runtime.removeTurn(turnId, {
      deleteMessages: true,
      includeInput: true,
    });
  }
}

function createErrorMessageId(side: "user" | "assistant") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `chat-${side}-error-${crypto.randomUUID()}`;
  }

  return `chat-${side}-error-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

function getDraftId(value: object) {
  if (
    "id" in value &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  ) {
    return value.id;
  }

  return undefined;
}

function isErrorTurn<
  TMessage extends Message,
  TTurnMetadata extends ChatMetadata,
  TBranchMetadata extends ChatMetadata,
>(
  turn: ChatTurn<TMessage, TTurnMetadata>,
  branchesById: Readonly<
    Record<string, ChatBranch<TMessage, TBranchMetadata>>
  >,
) {
  const branchMessages = turn.branchIds.map(
    (branchId) =>
      branchesById[branchId]?.messageReader.getMessages() ?? [],
  );

  if (isUserErrorMessage(turn.inputMessage)) {
    return branchMessages.every((messages) => messages.length === 0);
  }

  if (turn.inputMessage !== undefined || branchMessages.length !== 1) {
    return false;
  }

  const messages = branchMessages[0]!;
  return (
    messages.length === 1 && isAssistantErrorMessage(messages[0])
  );
}

function isUserErrorMessage(message: Message | undefined) {
  return (
    message?.role === "user" &&
    "status" in message &&
    message.status === "error"
  );
}

function isAssistantErrorMessage(message: Message | undefined) {
  return (
    message?.role === "activity" && message.activityType === "error"
  );
}
