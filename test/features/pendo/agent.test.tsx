// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendoProvider, usePendo, type AgentMessageProperties, type AgentReactionProperties } from "../../../src/features/pendo";

const config = {
  publicAppId: "8c19687f-cf16-4f3c-9f9b-4ab8e9350c5c",
  enabled: true,
  visitorId: "test:user-42",
  environment: "test",
};
const prompt: AgentMessageProperties = {
  agentId: "pendo-agent", conversationId: "conversation-1", messageId: "prompt-1", content: "Question",
};
const response: AgentMessageProperties = { ...prompt, messageId: "response-1", content: "Final answer" };
type Stub = {
  _q: [string, { events: { ready(): void } }][];
  track?: ReturnType<typeof vi.fn>;
  trackAgent?: ReturnType<typeof vi.fn>;
  flushNow?: ReturnType<typeof vi.fn>;
  teardown?: ReturnType<typeof vi.fn>;
};
const sdk = () => (window as unknown as { pendo?: Stub }).pendo;
const script = () => document.querySelector<HTMLScriptElement>("script[data-pendo-sidecar]");
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function ready() {
  const spies = { track: vi.fn(), trackAgent: vi.fn(), flushNow: vi.fn(), teardown: vi.fn() };
  Object.assign(sdk()!, spies);
  sdk()!._q[0]![1].events.ready();
  return spies;
}
let analytics: ReturnType<typeof usePendo>;
function Consumer() { analytics = usePendo(); return <span>Business content</span>; }

afterEach(async () => { cleanup(); await flush(); vi.restoreAllMocks(); });

describe("portable Pendo conversation API", () => {
  it("preserves mixed child-mount event order until SDK readiness under StrictMode", async () => {
    function MountEvent() {
      const { track, trackAgent } = usePendo();
      useEffect(() => {
        trackAgent("prompt", prompt, { environment: "cannot-override-host", source: "composer" });
        track({ name: "request_started" });
        trackAgent("agent_response", response, { duration: 1200 });
      }, [track, trackAgent]);
      return null;
    }
    const view = render(<StrictMode><PendoProvider {...config}><MountEvent/></PendoProvider></StrictMode>);
    expect(document.querySelectorAll("script[data-pendo-sidecar]")).toHaveLength(1);
    const client = ready();
    await flush();
    expect(client.trackAgent).toHaveBeenCalledWith("prompt", prompt, { environment: "test", source: "composer" });
    expect(client.trackAgent).toHaveBeenCalledWith("agent_response", response, { duration: 1200, environment: "test" });
    expect(client.trackAgent.mock.invocationCallOrder[0]).toBeLessThan(client.track.mock.invocationCallOrder[0]!);
    expect(client.track.mock.invocationCallOrder[0]).toBeLessThan(client.trackAgent.mock.invocationCallOrder[1]!);
    // Consumer effects replay in StrictMode; the wrapper does not invent new IDs or deduplicate messages.
    expect(client.trackAgent.mock.calls.every((call) => call[1].conversationId === "conversation-1")).toBe(true);
    expect(client.flushNow).not.toHaveBeenCalled();
    view.unmount();
    await flush();
    expect(client.teardown).toHaveBeenCalledOnce();
  });

  it("does not collect messages until explicitly called and snapshots buffered conversation data", async () => {
    render(<PendoProvider {...config}><Consumer/></PendoProvider>);
    const message: AgentMessageProperties = {
      ...response, agentModelsUsed: ["model-1"], toolsUsed: ["search"], agentSubagentsUsed: ["research"],
      agentFilesUploaded: [{ type: "csv", name: "sample.csv" }], suggestedPrompt: false,
    };
    const properties = { duration: 1200 };
    analytics.trackAgent("agent_response", message, properties);
    message.content = "Changed after submission";
    message.messageId = "different-message";
    message.agentModelsUsed!.push("model-2");
    message.toolsUsed!.push("other-tool");
    message.agentSubagentsUsed!.push("other-agent");
    message.agentFilesUploaded![0]!.name = "changed.csv";
    properties.duration = 9999;
    const client = ready();
    expect(client.trackAgent).not.toHaveBeenCalled();
    await flush();
    expect(client.trackAgent).toHaveBeenCalledExactlyOnceWith("agent_response", {
      ...response, agentModelsUsed: ["model-1"], toolsUsed: ["search"], agentSubagentsUsed: ["research"],
      agentFilesUploaded: [{ type: "csv", name: "sample.csv" }], suggestedPrompt: false,
    }, { duration: 1200, environment: "test" });
    expect(client.track).not.toHaveBeenCalled();
  });

  it("snapshots messages submitted before the provider effect connects", async () => {
    function MountMessage() {
      const { trackAgent } = usePendo();
      useEffect(() => {
        const message = { ...prompt, toolsUsed: ["search"] };
        trackAgent("prompt", message);
        message.content = "Mutated before provider effect";
        message.toolsUsed.push("different-tool");
      }, [trackAgent]);
      return null;
    }
    render(<PendoProvider {...config}><MountMessage/></PendoProvider>);
    const client = ready();
    await flush();
    expect(client.trackAgent).toHaveBeenCalledExactlyOnceWith("prompt", { ...prompt, toolsUsed: ["search"] }, { environment: "test" });
  });

  it("sends feedback against the response ID, including changed and removed reactions", async () => {
    render(<PendoProvider {...config}><Consumer/></PendoProvider>);
    const client = ready();
    const reaction: AgentReactionProperties = { ...response, content: "positive", agentUserReactionComments: ["Helpful"] };
    analytics.trackAgent("user_reaction", reaction);
    reaction.agentUserReactionComments![0] = "Changed after submission";
    analytics.trackAgent("user_reaction", { ...response, content: "negative" });
    analytics.trackAgent("user_reaction", { ...response, content: "unreact" });
    await flush();
    expect(client.trackAgent).toHaveBeenNthCalledWith(1, "user_reaction", {
      ...response, content: "positive", agentUserReactionComments: ["Helpful"],
    }, { environment: "test" });
    expect(client.trackAgent).toHaveBeenNthCalledWith(2, "user_reaction", { ...response, content: "negative" }, { environment: "test" });
    expect(client.trackAgent).toHaveBeenNthCalledWith(3, "user_reaction", { ...response, content: "unreact" }, { environment: "test" });
  });

  it("shares the existing 100-event startup buffer with ordinary events", async () => {
    render(<PendoProvider {...config}><Consumer/></PendoProvider>);
    for (let i = 0; i < 101; i++) {
      if (i % 2) analytics.track({ name: "ordinary_event" });
      else analytics.trackAgent("prompt", { ...prompt, messageId: `prompt-${i}` });
    }
    const client = ready();
    await flush();
    expect(client.track).toHaveBeenCalledTimes(50);
    expect(client.trackAgent).toHaveBeenCalledTimes(50);
    expect(client.trackAgent.mock.calls.at(-1)![1].messageId).toBe("prompt-98");
  });

  it("is safe without a provider, when disabled, and with invalid configuration", async () => {
    for (const options of [undefined, { ...config, enabled: false }, { ...config, publicAppId: "" }]) {
      const view = render(options ? <PendoProvider {...options}><Consumer/></PendoProvider> : <Consumer/>);
      expect(() => {
        analytics.trackAgent("prompt", prompt);
        analytics.trackAgent("agent_response", response);
        analytics.trackAgent("user_reaction", { ...response, content: "positive" });
      }).not.toThrow();
      await flush();
      expect(script()).toBeNull();
      expect(sdk()).toBeUndefined();
      view.unmount();
    }
  });

  it.each(["disable", "identity", "load-error"] as const)("discards pending conversations on %s and ignores stale callbacks", async (change) => {
    const view = render(<PendoProvider {...config}><Consumer/></PendoProvider>);
    const client = ready();
    const savedTrackAgent = analytics.trackAgent;
    analytics.trackAgent("prompt", prompt);
    if (change === "load-error") {
      script()!.dispatchEvent(new Event("error"));
      view.unmount();
    } else {
      view.rerender(<PendoProvider {...config} enabled={change !== "disable"} visitorId="other-user"><Consumer/></PendoProvider>);
    }
    savedTrackAgent("agent_response", response);
    await flush();
    expect(client.trackAgent).not.toHaveBeenCalled();
    expect(client.flushNow).not.toHaveBeenCalled();
    expect(client.teardown).toHaveBeenCalledOnce();
    if (change === "identity") {
      const next = ready();
      await flush();
      expect(next.trackAgent).not.toHaveBeenCalled();
      analytics.trackAgent("prompt", { ...prompt, conversationId: "other-conversation" });
      await flush();
      expect(next.trackAgent).toHaveBeenCalledExactlyOnceWith("prompt", { ...prompt, conversationId: "other-conversation" }, { environment: "test" });
    }
  });

  it.each(["hidden", "pagehide", "unmount"] as const)("delivers a same-turn response before %s flush and never duplicates it", async (exit) => {
    const view = render(<PendoProvider {...config}><Consumer/></PendoProvider>);
    const client = ready();
    const savedTrackAgent = analytics.trackAgent;
    analytics.trackAgent("agent_response", response);
    if (exit === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    } else if (exit === "pagehide") window.dispatchEvent(new Event("pagehide"));
    else view.unmount();
    await flush();
    expect(client.trackAgent).toHaveBeenCalledExactlyOnceWith("agent_response", response, { environment: "test" });
    expect(client.flushNow).toHaveBeenCalledExactlyOnceWith(exit === "hidden" ? { hidden: true } : { unload: true });
    expect(client.trackAgent.mock.invocationCallOrder[0]).toBeLessThan(client.flushNow.mock.invocationCallOrder[0]!);
    view.unmount();
    await flush();
    savedTrackAgent("prompt", prompt);
    await flush();
    expect(client.trackAgent).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "throw"] as const)("isolates a %s SDK conversation API without falling back to ordinary track", async (failure) => {
    render(<PendoProvider {...config}><Consumer/></PendoProvider>);
    const client = ready();
    if (failure === "missing") delete sdk()!.trackAgent;
    else client.trackAgent.mockImplementation(() => { throw new Error("Conversation API blocked"); });
    expect(() => analytics.trackAgent("prompt", prompt)).not.toThrow();
    analytics.track({ name: "business_still_works" });
    await flush();
    expect(client.track).toHaveBeenCalledExactlyOnceWith("business_still_works", { environment: "test" });
    expect(client.trackAgent).toHaveBeenCalledTimes(failure === "missing" ? 0 : 1);
  });
});
