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

export interface AssistantResponseTarget {
  /** Defaults to the last Turn. */
  turnId?: string;
  /** Runtime Branch ID. Required when the target Turn has multiple Branches. */
  branchId?: string;
}

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

/** Removes the Turn input only when it is a User Error message. */
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
  turnId = runtime.getSnapshot().turnIds.at(-1),
): Promise<void> {
  if (!turnId) return;

  await clearTransientMessages(runtime, {
    shouldRemoveInput: (message, context) =>
      context.turnId === turnId &&
      errorMessageCleanupPolicy.shouldRemoveInput(message),
  });
}

/** Removes the complete response only when its final message is an AI Error. */
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
  target: AssistantResponseTarget = {},
): Promise<void> {
  const resolved = resolveAssistantResponseTarget(runtime, target);
  if (!resolved) return;

  await clearTransientMessages(runtime, {
    shouldRemoveResponse: (message, context) =>
      context.turnId === resolved.turn.id &&
      context.branchId === resolved.branch.id &&
      errorMessageCleanupPolicy.shouldRemoveResponse(message),
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

function resolveAssistantResponseTarget<
  TInput,
  TMessage extends Message,
  TTurnMetadata extends ChatMetadata,
  TBranchMetadata extends ChatMetadata,
  TSourceMetadata extends ChatMetadata,
>(
  runtime: CompareChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata,
    TSourceMetadata
  >,
  target: AssistantResponseTarget,
) {
  const snapshot = runtime.getSnapshot();
  const turnId = target.turnId ?? snapshot.turnIds.at(-1);
  if (!turnId) return undefined;

  const turn = snapshot.turnsById[turnId];
  if (!turn) {
    throw new Error(`Turn "${turnId}" does not exist.`);
  }

  const branchId =
    target.branchId ??
    (turn.branchIds.length === 1 ? turn.branchIds[0] : undefined);
  if (!branchId) {
    throw new Error(
      `Assistant response removal requires branchId for turn "${turnId}".`,
    );
  }
  if (!turn.branchIds.includes(branchId)) {
    throw new Error(
      `Branch "${branchId}" does not belong to turn "${turnId}".`,
    );
  }

  const branch = snapshot.branchesById[branchId];
  if (!branch) {
    throw new Error(`Branch "${branchId}" does not exist.`);
  }

  return { turn, branch };
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
