// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendoProvider, usePendo, type PendoConfig, type Track } from "../../../src/features/pendo";
import { acquirePendo } from "../../../src/features/pendo/client";

const appId = "8c19687f-cf16-4f3c-9f9b-4ab8e9350c5c";
const config = { publicAppId: appId, enabled: true, environment: "test" };
type TestOptions = {
  visitor: { id: string; environment?: string };
  account?: { id: string };
  events: { ready(): void };
  excludeAllText: boolean;
  recording: { enabled: boolean };
};
type TestSdk = { _q: [string, TestOptions][]; track?: ReturnType<typeof vi.fn>; flushNow?: ReturnType<typeof vi.fn>; teardown?: ReturnType<typeof vi.fn> };
const sdk = () => (window as unknown as { pendo: TestSdk | undefined }).pendo;
const script = () => document.querySelector<HTMLScriptElement>("script[data-pendo-sidecar]");
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
function ready() {
  const track = vi.fn();
  const flushNow = vi.fn();
  const teardown = vi.fn();
  sdk()!.track = track;
  sdk()!.flushNow = flushNow;
  sdk()!.teardown = teardown;
  sdk()!._q[0]![1].events.ready();
  return { track, flushNow, teardown };
}
function BusinessAction({ onAction = () => {} }: { onAction?: () => void }) {
  const { track } = usePendo();
  return <button onClick={() => {
    onAction();
    track({ name: "order_created", properties: { source: "checkout" } });
  }}>Create order</button>;
}

beforeEach(() => { localStorage.clear(); window.history.replaceState({}, "", "/actual-business"); });
afterEach(async () => { cleanup(); await flush(); vi.restoreAllMocks(); });

describe("portable Pendo provider", () => {
  it("works without queue/runtime, accepts parameters, and preserves the SDK across rerenders", async () => {
    const renderApp = () => <PendoProvider {...config} region="eu" visitorId="user-42" accountId="team-7"><BusinessAction/></PendoProvider>;
    const view = render(renderApp());
    expect(script()!.src).toBe(`https://cdn.eu.pendo.io/agent/static/${appId}/pendo.js`);
    const original = script();
    const options = sdk()!._q[0]![1];
    expect(options.visitor).toEqual({ id: "user-42", environment: "test" });
    expect(options.account).toEqual({ id: "team-7" });
    expect(options.excludeAllText).toBe(true);
    expect(options.recording.enabled).toBe(false);
    fireEvent.click(view.getByRole("button"));
    await flush();
    const { track, teardown } = ready();
    await flush();
    expect(track).toHaveBeenCalledExactlyOnceWith("order_created", { source: "checkout", environment: "test" });
    view.rerender(renderApp());
    expect(script()).toBe(original);
    view.unmount();
    await flush();
    expect(teardown).toHaveBeenCalledOnce();
    expect(script()).toBeNull();
    expect(sdk()).toBeUndefined();
  });

  it("turns tracking into a no-op without a provider, when disabled, or with an empty key", async () => {
    const onAction = vi.fn();
    for (const options of [undefined, { ...config, enabled: false }, { ...config, publicAppId: "" }]) {
      const view = render(options
        ? <PendoProvider {...options}><BusinessAction onAction={onAction}/></PendoProvider>
        : <BusinessAction onAction={onAction}/>);
      fireEvent.click(view.getByRole("button"));
      await flush();
      expect(script()).toBeNull();
      expect(sdk()).toBeUndefined();
      view.unmount();
    }
    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it("switches market eligibility at runtime, discards pending data, and keeps actions usable", async () => {
    const onAction = vi.fn();
    const app = (market: string) => <PendoProvider {...config} enabled={["us", "eu"].includes(market)}>
      <BusinessAction onAction={onAction}/>
    </PendoProvider>;
    const view = render(app("cn"));
    fireEvent.click(view.getByRole("button"));
    await flush();
    expect(script()).toBeNull();
    view.rerender(app("us"));
    const previous = sdk()!;
    const onReady = previous._q[0]![1].events.ready;
    fireEvent.click(view.getByRole("button"));
    await flush(); // Queued while SDK is not ready.
    view.rerender(app("cn"));
    await flush();
    expect(sdk()).toBeUndefined();
    fireEvent.click(view.getByRole("button"));
    previous.track = vi.fn();
    onReady();
    await flush();
    expect(previous.track).not.toHaveBeenCalled();
    view.rerender(app("eu"));
    const { track } = ready();
    fireEvent.click(view.getByRole("button"));
    await flush();
    expect(track).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(4);
  });

  it("replaces identity/configuration without sending old queued events as the new user", async () => {
    const app = (visitorId: string, publicAppId = appId) => <PendoProvider {...config} visitorId={visitorId} publicAppId={publicAppId}>
      <BusinessAction/>
    </PendoProvider>;
    const view = render(app("first"));
    fireEvent.click(view.getByRole("button"));
    await flush();
    const previous = sdk()!;
    view.rerender(app("second", "11111111-1111-1111-1111-111111111111"));
    expect(sdk()).not.toBe(previous);
    expect(sdk()!._q[0]![1].visitor.id).toBe("second");
    const { track } = ready();
    await flush();
    expect(track).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button"));
    await flush();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("initializes once under StrictMode and delivers child mount events before readiness", async () => {
    function MountEvent() {
      const { track } = usePendo();
      useEffect(() => { track({ name: "mounted" }); }, [track]);
      return null;
    }
    render(<StrictMode><PendoProvider {...config}><MountEvent/></PendoProvider></StrictMode>);
    expect(document.querySelectorAll("script[data-pendo-sidecar]")).toHaveLength(1);
    await flush();
    const { track } = ready();
    await flush();
    // StrictMode replays consumer effects; event deduplication belongs to that consumer.
    expect(track).toHaveBeenCalledWith("mounted", { environment: "test" });
  });

  it("sends a same-turn action before the final unmount flush and teardown", async () => {
    const view = render(<PendoProvider {...config}><BusinessAction/></PendoProvider>);
    const { track, flushNow, teardown } = ready();
    fireEvent.click(view.getByRole("button"));
    view.unmount();
    await flush();
    expect(track).toHaveBeenCalledExactlyOnceWith("order_created", { source: "checkout", environment: "test" });
    expect(flushNow).toHaveBeenCalledExactlyOnceWith({ unload: true });
    expect(track.mock.invocationCallOrder[0]).toBeLessThan(flushNow.mock.invocationCallOrder[0]!);
    expect(flushNow.mock.invocationCallOrder[0]).toBeLessThan(teardown.mock.invocationCallOrder[0]!);
  });

  it("drains same-turn events when hidden or leaving and removes listeners after unmount", async () => {
    const view = render(<PendoProvider {...config}><BusinessAction/></PendoProvider>);
    const { track, flushNow } = ready();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(flushNow).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent.click(view.getByRole("button"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(track).toHaveBeenCalledTimes(1);
    expect(flushNow).toHaveBeenLastCalledWith({ hidden: true });
    fireEvent.click(view.getByRole("button"));
    window.dispatchEvent(new Event("pagehide"));
    expect(track).toHaveBeenCalledTimes(2);
    expect(flushNow).toHaveBeenLastCalledWith({ unload: true });
    await flush();
    expect(track).toHaveBeenCalledTimes(2); // Scheduled drains must not duplicate delivery.
    view.unmount();
    await flush();
    flushNow.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    expect(flushNow).not.toHaveBeenCalled();
  });

  it("does not flush or drain queued events when disabled or when identity changes", async () => {
    const app = (enabled: boolean, visitorId = "first") => <PendoProvider {...config} enabled={enabled} visitorId={visitorId}>
      <BusinessAction/>
    </PendoProvider>;
    const view = render(app(true));
    const first = ready();
    fireEvent.click(view.getByRole("button"));
    view.rerender(app(false));
    await flush();
    window.dispatchEvent(new Event("pagehide"));
    expect(first.track).not.toHaveBeenCalled();
    expect(first.flushNow).not.toHaveBeenCalled();
    expect(first.teardown).toHaveBeenCalledOnce();
    view.rerender(app(true));
    const second = ready();
    fireEvent.click(view.getByRole("button"));
    view.rerender(app(true, "second"));
    await flush();
    expect(second.track).not.toHaveBeenCalled();
    expect(second.flushNow).not.toHaveBeenCalled();
    const third = ready();
    fireEvent.click(view.getByRole("button"));
    view.unmount();
    await flush();
    expect(third.track).toHaveBeenCalledTimes(1);
    expect(third.flushNow).toHaveBeenCalledOnce();
  });

  it("flushes only on final release, without StrictMode replay flushing or duplicate listeners", async () => {
    const app = (showSecond: boolean) => <StrictMode>
      <PendoProvider {...config}><BusinessAction/></PendoProvider>
      {showSecond && <PendoProvider {...config}><span>Second consumer</span></PendoProvider>}
    </StrictMode>;
    const view = render(app(true));
    const { flushNow, teardown } = ready();
    await flush();
    expect(flushNow).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(flushNow).toHaveBeenCalledTimes(1);
    flushNow.mockClear();
    view.rerender(app(false));
    await flush();
    expect(flushNow).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
    view.unmount();
    await flush();
    expect(flushNow).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("isolates flush errors and still tears down and removes exit listeners", async () => {
    const view = render(<PendoProvider {...config}><BusinessAction/></PendoProvider>);
    const { track, flushNow, teardown } = ready();
    flushNow.mockImplementation(() => { throw new Error("beacon blocked"); });
    fireEvent.click(view.getByRole("button"));
    window.dispatchEvent(new Event("pagehide"));
    expect(track).toHaveBeenCalledTimes(1);
    view.unmount();
    await flush();
    expect(teardown).toHaveBeenCalledOnce();
    expect(sdk()).toBeUndefined();
    flushNow.mockClear();
    window.dispatchEvent(new Event("pagehide"));
    expect(flushNow).not.toHaveBeenCalled();
  });

  it("cannot flush before SDK readiness and drops early events on unmount or load failure", async () => {
    for (const fail of [false, true]) {
      const view = render(<PendoProvider {...config}><BusinessAction/></PendoProvider>);
      const original = sdk()!;
      const onReady = original._q[0]![1].events.ready;
      original.flushNow = vi.fn();
      original.track = vi.fn();
      fireEvent.click(view.getByRole("button"));
      window.dispatchEvent(new Event("pagehide"));
      if (fail) script()!.dispatchEvent(new Event("error"));
      view.unmount();
      await flush();
      onReady();
      await flush();
      expect(original.flushNow).not.toHaveBeenCalled();
      expect(original.track).not.toHaveBeenCalled();
      expect(sdk()).toBeUndefined();
    }
  });

  it("drops retained callbacks after unmount and isolates SDK/network failures", async () => {
    let savedTrack: Track = () => {};
    function Capture() { savedTrack = usePendo().track; return <BusinessAction/>; }
    const view = render(<PendoProvider {...config}><Capture/></PendoProvider>);
    const { track } = ready();
    track.mockImplementation(() => { throw new Error("blocked"); });
    fireEvent.click(view.getByRole("button"));
    await flush();
    script()!.dispatchEvent(new Event("error"));
    fireEvent.click(view.getByRole("button"));
    await flush();
    view.unmount();
    savedTrack({ name: "late_event" });
    await flush();
    expect(track).toHaveBeenCalledTimes(1);
    expect(sdk()).toBeUndefined();
  });

  it("does not replace a host-owned SDK and rejects a conflicting active configuration", async () => {
    const external = { _q: [], track: vi.fn() } satisfies TestSdk;
    (window as unknown as { pendo: TestSdk }).pendo = external;
    expect(acquirePendo(config)).toBeUndefined();
    expect(sdk()).toBe(external);
    delete (window as unknown as { pendo?: TestSdk }).pendo;
    const first = acquirePendo(config)!;
    expect(acquirePendo({ ...config, visitorId: "other" })).toBeUndefined();
    first.release();
    await flush();
  });

  it("keeps anonymous identity stable with blocked storage and scopes it by app", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const getId = async (options: PendoConfig) => {
      const lease = acquirePendo(options)!;
      const id = sdk()!._q[0]![1].visitor.id;
      lease.release(); await flush();
      return id;
    };
    const id = await getId(config);
    expect(id).toMatch(/^anonymous-/);
    expect(await getId(config)).toBe(id);
    expect(await getId({ ...config, publicAppId: "22222222-2222-2222-2222-222222222222" })).not.toBe(id);
  });
});
