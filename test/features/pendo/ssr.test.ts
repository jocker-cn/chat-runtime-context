// @vitest-environment node
import { expect, it } from "vitest";
import { createPendoScript, track, trackAgent, flushNow } from "../../../src/features/pendo";

it("imports and safely calls all APIs without browser globals", () => {
  expect(() => {
    createPendoScript({ enabled: true, publicAppId: "8c19687f-cf16-4f3c-9f9b-4ab8e9350c5c" });
    track({ name: "server" });
    trackAgent("prompt", { agentId: "agent", conversationId: "chat", messageId: "message", content: "Question" });
    flushNow();
  }).not.toThrow();
});
