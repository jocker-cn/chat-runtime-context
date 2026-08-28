import type { Message } from "@ag-ui/client";
import type {
  ChatMetadata,
  ChatRuntime,
} from "../contracts/chat-runtime";
import type { CompareChatRuntime } from "../runtime/CompareChatRuntime";
import {
  clearTransientMessages,
  type TransientMessageCleanupPolicy,
} from "./transientMessages";

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

export const errorMessageCleanupPolicy = {
  shouldRemoveInput: isUserErrorMessage,
  shouldRemoveResponse: isAssistantErrorMessage,
} satisfies TransientMessageCleanupPolicy;

/** Adds one Error Message as an independently tracked local Turn. */
async function addErrorMessage<
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

/** Removes consecutive User Error inputs from the timeline tail. */
export async function removeUserErrorMessage<
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
  await clearTransientMessages(runtime, {
    shouldRemoveInput: errorMessageCleanupPolicy.shouldRemoveInput,
  });
}

/** Removes complete AI Error responses from the timeline tail. */
export async function removeAssistantErrorResponse<
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
  await clearTransientMessages(runtime, {
    shouldRemoveResponse: errorMessageCleanupPolicy.shouldRemoveResponse,
  });
}

/**
 * Clears transient Error messages only at the timeline tail before a new send.
 * Normal historical Turns are never scanned or rewritten.
 */
export function clearErrorMessagesBeforeSend<
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
  return clearTransientMessages(runtime, errorMessageCleanupPolicy);
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

function isUserErrorMessage(message: Message | undefined) {
  return (
    message?.role === "user" &&
    (message as Message & { status?: string }).status
      ?.trim()
      ?.toLowerCase() === "error"
  );
}

function isAssistantErrorMessage(message: Message | undefined) {
  return (
    message?.role === "activity" &&
    message.activityType?.trim()?.toLowerCase() === "error"
  );
}
