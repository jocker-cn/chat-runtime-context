// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendoScript, track, trackAgent, flushNow, isPendoEnabled, type AgentMessageProperties, type PendoConfig } from "../../../src/features/pendo";
import { getPendo } from "../../../src/features/pendo/client";

const config = { enabled: true, publicAppId: "8c19687f-cf16-4f3c-9f9b-4ab8e9350c5c", visitorId: "45464650", environment: "retail-hk" };
const message: AgentMessageProperties = { agentId: "agent", conversationId: "chat", messageId: "message", content: "Question" };
let documentEvents: ReturnType<typeof vi.spyOn>;
let windowEvents: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  documentEvents = vi.spyOn(document, "addEventListener");
  windowEvents = vi.spyOn(window, "addEventListener");
});
afterEach(() => {
  for (const [type, listener] of documentEvents.mock.calls) document.removeEventListener(type, listener);
  for (const [type, listener] of windowEvents.mock.calls) window.removeEventListener(type, listener);
  delete (window as Window & { pendo?: unknown }).pendo;
  delete (window as Window & { __appPendoConfig?: unknown }).__appPendoConfig;
  document.querySelectorAll("script").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

function launch(options: PendoConfig = config) {
  const source = createPendoScript(options);
  if (!source) return;
  const inline = document.createElement("script");
  inline.id = "pendo-install";
  inline.textContent = source;
  document.head.append(inline);
  // jsdom does not execute inserted script tags by default: run the actual source.
  new Function("window", "document", source)(window, document);
}

describe("official Pendo inline script", () => {
  it("executes the official snippet, keeps the user ID, and queues initialization before events", () => {
    launch({ ...config, accountId: "team" });
    const external = document.querySelector<HTMLScriptElement>("script[src]");
    expect(external?.src).toBe(`https://cdn.pendo.io/agent/static/${config.publicAppId}/pendo.js`);
    expect(external?.async).toBe(true);
    track({ name: "sent", properties: { source: "composer" } });
    expect(getPendo()?._q).toEqual([
      ["initialize", expect.objectContaining({ visitor: { id: "45464650", environment: "retail-hk" }, account: { id: "team" } })],
      ["track", "sent", { source: "composer", environment: "retail-hk" }],
    ]);
  });

  it("generates no script and safely ignores events when disabled or misconfigured", () => {
    expect(createPendoScript({ ...config, enabled: false })).toBe("");
    expect(createPendoScript({ ...config, publicAppId: "" })).toBe("");
    const sdk = { track: vi.fn(), trackAgent: vi.fn() };
    (window as Window & { pendo?: unknown }).pendo = sdk;
    track({ name: "ignored" });
    trackAgent("prompt", message);
    expect(isPendoEnabled()).toBe(false);
    expect(sdk.track).not.toHaveBeenCalled();
    expect(sdk.trackAgent).not.toHaveBeenCalled();
  });

  it("calls the current window SDK directly and isolates exceptions", () => {
    launch();
    const sdk = { track: vi.fn(), trackAgent: vi.fn() };
    (window as Window & { pendo?: unknown }).pendo = sdk;
    track({ name: "complete", properties: { environment: "wrong" } });
    trackAgent("agent_response", message, { duration: 100 });
    expect(sdk.track).toHaveBeenCalledExactlyOnceWith("complete", { environment: "retail-hk" });
    expect(sdk.trackAgent).toHaveBeenCalledExactlyOnceWith("agent_response", message, { duration: 100, environment: "retail-hk" });
    sdk.track.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => track({ name: "safe" })).not.toThrow();
    delete (window as Window & { pendo?: unknown }).pendo;
    expect(() => trackAgent("prompt", message)).not.toThrow();
  });

  it("snapshots AI messages in the official queue and never falls back to ordinary track", () => {
    launch();
    const prompt = { ...message, toolsUsed: ["search"] };
    trackAgent("prompt", prompt);
    prompt.content = "mutated";
    prompt.toolsUsed.push("other");
    expect(getPendo()?._q?.[1]).toEqual(["trackAgent", "prompt", { ...message, toolsUsed: ["search"] }, { environment: "retail-hk" }]);
    const sdk = getPendo()!;
    const normal = vi.fn();
    sdk.track = normal;
    delete sdk.trackAgent;
    trackAgent("prompt", message);
    expect(normal).not.toHaveBeenCalled();
  });

  it("escapes inline script delimiters while preserving initialization data", () => {
    const environment = "</script><script>alert(1)</script>";
    expect(createPendoScript({ ...config, environment })).not.toContain("</script>");
    launch({ ...config, environment });
    expect(getPendo()?._q?.[0]).toEqual(["initialize", expect.objectContaining({ visitor: { id: config.visitorId, environment } })]);
  });

  it("flushes on hidden and pagehide and keeps manual flush errors harmless", () => {
    launch();
    const send = vi.fn();
    getPendo()!.flushNow = send;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    expect(send.mock.calls).toEqual([[{ hidden: true }], [{ unload: true }]]);
    send.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => flushNow()).not.toThrow();
  });
});
