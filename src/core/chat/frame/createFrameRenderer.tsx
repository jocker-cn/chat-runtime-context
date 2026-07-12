import type React from "react";
import type { Message } from "@ag-ui/client";
import type { MessageRenderContext } from "./types";

export interface FrameCardProps<TMessage extends Message = Message> {
  message: TMessage;
  context: MessageRenderContext;
}

export type FrameCardComponent<TMessage extends Message = Message> =
  React.ComponentType<FrameCardProps<TMessage>>;

export interface FrameCardCondition<TMessage extends Message = Message> {
  condition?: (
    message: TMessage,
    context: MessageRenderContext,
  ) => boolean;
  card: FrameCardComponent<TMessage>;
}

export type FrameCardRegistration<TMessage extends Message = Message> =
  | FrameCardComponent<TMessage>
  | readonly FrameCardCondition<TMessage>[];

export type FrameRendererCards<TMessage extends Message = Message> =
  Partial<Record<string, FrameCardRegistration<TMessage>>>;

export interface CreateFrameRendererOptions<
  TMessage extends Message = Message,
> {
  cards: FrameRendererCards<TMessage>;
  fallback?: FrameCardComponent<TMessage>;
}

export interface FrameRenderer<TMessage extends Message = Message> {
  getCard(
    message: TMessage,
    context: MessageRenderContext,
  ): FrameCardComponent<TMessage>;
}

const EmptyFrameCard = () => null;

export function createFrameRenderer<
  TMessage extends Message = Message,
>({
  cards,
  fallback = EmptyFrameCard,
}: CreateFrameRendererOptions<TMessage>): FrameRenderer<TMessage> {
  const selectedCards = selectCards(cards, fallback);

  return {
    getCard: (message, context) => {
      const role = String(message.role);

      return selectedCards[role]?.(message, context) ?? fallback;
    },
  };
}

function selectCards<TMessage extends Message>(
  cards: FrameRendererCards<TMessage>,
  fallback: FrameCardComponent<TMessage>,
) {
  const selectedCards: Record<
    string,
    (
      message: TMessage,
      context: MessageRenderContext,
    ) => FrameCardComponent<TMessage>
  > = {};

  Object.entries(cards).forEach(([role, registration]) => {
    selectedCards[role] = createSelector(registration, fallback);
  });

  return selectedCards;
}

function createSelector<TMessage extends Message>(
  registration: FrameCardRegistration<TMessage> | undefined,
  fallback: FrameCardComponent<TMessage>,
) {
  return (
    message: TMessage,
    context: MessageRenderContext,
  ): FrameCardComponent<TMessage> => {
    if (!registration) {
      return fallback;
    }

    if (typeof registration === "function") {
      return registration;
    }

    return (
      registration.find(
        (entry) => !entry.condition || entry.condition(message, context),
      )?.card ?? fallback
    );
  };
}
