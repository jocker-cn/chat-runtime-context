// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionPocAnalytics, PendoChatSidecar, PendoWorkspaceSidecar } from "../../../src/chat/demo/extension-poc/analytics/sidecars";
import { createSubmissionQueue } from "../../../src/core/queue";

const config = { enabled: true, publicAppId: "8c19687f-cf16-4f3c-9f9b-4ab8e9350c5c", environment: "local" };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
afterEach(async () => {
  cleanup(); await flush();
  delete (window as Window & { __appPendoConfig?: unknown }).__appPendoConfig;
  delete (window as Window & { pendo?: unknown }).pendo;
  document.querySelectorAll("script").forEach((node) => node.remove());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("optional demo business adapter", () => {
  it("does not subscribe when disabled", () => {
    const runtime = { getSnapshot: vi.fn(), subscribe: vi.fn() };
    const queue = { getSnapshot: vi.fn(), subscribe: vi.fn() };
    vi.stubEnv("VITE_PENDO_ENABLED", "false");
    render(<ExtensionPocAnalytics><PendoChatSidecar runtime={runtime} queue={queue} secondaryEnabled/></ExtensionPocAnalytics>);
    expect(runtime.subscribe).not.toHaveBeenCalled();
    expect(queue.subscribe).not.toHaveBeenCalled();
  });

  it("preserves demo view/submission/toggle events and releases listeners in StrictMode", async () => {
    window.history.replaceState({}, "", "/extension-poc");
    vi.stubEnv("VITE_PENDO_ENABLED", "true");
    vi.stubEnv("VITE_PENDO_PUBLIC_APP_ID", config.publicAppId);
    const append = document.head.append.bind(document.head);
    vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      append(...nodes);
      for (const node of nodes) {
        if (node instanceof HTMLScriptElement && node.id === "pendo-install") {
          new Function("window", "document", node.textContent ?? "")(window, document);
        }
      }
    });
    const queue = createSubmissionQueue<string>();
    const listeners = new Set<() => void>();
    const runtime = {
      getSnapshot: () => ({ branchesById: {} }),
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const tree = (secondary: boolean) => <StrictMode><ExtensionPocAnalytics>
      <PendoWorkspaceSidecar view="chat"/>
      <PendoChatSidecar runtime={runtime} queue={queue} secondaryEnabled={secondary}/>
    </ExtensionPocAnalytics></StrictMode>;
    const view = render(tree(true));
    const sdk = (window as unknown as { pendo: { _q: [string, { events: { ready(): void } }][]; track: ReturnType<typeof vi.fn> } }).pendo;
    act(() => { queue.enqueue("private content"); });
    await flush();
    sdk.track = vi.fn();
    await flush();
    expect(sdk._q.slice(1)).toEqual([
      ["track", "workspace_viewed", { environment: "local", view: "chat" }],
      ["track", "chat_submitted", { environment: "local" }],
    ]);
    view.rerender(tree(false));
    await flush();
    expect(sdk.track.mock.lastCall).toEqual(["agent_comparison_changed", { environment: "local", enabled: false }]);
    expect(listeners.size).toBe(1);
    view.unmount();
    await flush();
    expect(listeners.size).toBe(0);
  });
});
