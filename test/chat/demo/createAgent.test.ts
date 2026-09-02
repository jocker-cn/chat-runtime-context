import { describe, expect, it } from "vitest";
import { createAgent } from "../../../src/chat/demo/adapters/createAgent";
import { SocketAdapterAgent } from "../../../src/chat/demo/adapters/socketAdapter";
import { SseAdapterAgent } from "../../../src/chat/demo/adapters/sseAdapter";

describe("createAgent", () => {
  it("creates a WebSocket adapter agent", () => {
    const agent = createAgent({
      transport: "websocket",
      url: "ws://localhost/test",
      options: { agentId: "socket-agent" },
    });

    expect(agent).toBeInstanceOf(SocketAdapterAgent);
    agent.close();
  });

  it("creates an SSE adapter agent", () => {
    const agent = createAgent({
      transport: "sse",
      url: "/api/agent",
      options: { agentId: "sse-agent" },
    });

    expect(agent).toBeInstanceOf(SseAdapterAgent);
    agent.close();
  });
});
