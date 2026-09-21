import { registerAddToChat } from "../../core";

export const compareAddToChat = registerAddToChat({
  id: "compare-chat",
  selectionRoot: "#compare-chat .crt-runtime",
  referenceHost: "#compare-chat [data-chat-reference-host]",
});

export const singleAddToChat = registerAddToChat({
  id: "single-chat",
  selectionRoot: "#single-chat .crt-runtime",
  referenceHost: "#single-chat [data-chat-reference-host]",
});
