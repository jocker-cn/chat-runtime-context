import type { ChatViewportAdapter } from "./contracts";

export function createDomChatViewportAdapter(): ChatViewportAdapter {
  return {
    getScrollElement: () => null,
    revealItem: (item, options) => {
      const element = document.querySelector<HTMLElement>(
        `[data-turn-id="${escapeAttributeValue(item.turnId)}"]`,
      );
      if (!element) return;

      element.scrollIntoView({
        behavior: options.behavior === "instant" ? "auto" : options.behavior,
        block: options.align,
        inline: "nearest",
      });
    },
  };
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
