import type { RefObject } from "react";
import type { ChatViewportAdapter } from "./contracts";

export function createDomChatViewportAdapter(
  scrollContainerRef: RefObject<HTMLElement | null>,
  topOffset = 0,
): ChatViewportAdapter {
  return {
    getScrollElement: () => scrollContainerRef.current,
    revealItem: ({ element }, options) => {
      const container = scrollContainerRef.current;
      if (!container || !element) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = element.getBoundingClientRect();
      const alignmentOffset =
        options.align === "center"
          ? (container.clientHeight - targetRect.height) / 2
          : topOffset;
      const top =
        container.scrollTop +
        targetRect.top -
        containerRect.top -
        alignmentOffset;

      container.scrollTo({
        top,
        behavior: options.behavior === "instant" ? "auto" : options.behavior,
      });
    },
  };
}
