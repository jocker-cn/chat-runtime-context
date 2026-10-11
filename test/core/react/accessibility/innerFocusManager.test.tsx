/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InnerFocusManager } from "../../../../src/core/react/accessibility/InnerFocusManager";

interface InnerFocusHarnessProps {
  active: boolean;
  enabled?: boolean;
  onExit?: () => void;
  onFirstAction?: () => void;
  secondKey?: string;
  secondTabIndex?: number;
}

function InnerFocusHarness({
  active,
  enabled,
  onExit = () => undefined,
  onFirstAction,
  secondKey = "second",
  secondTabIndex,
}: InnerFocusHarnessProps) {
  return (
    <InnerFocusManager
      active={active}
      enabled={enabled}
      onExit={onExit}
      excludeOuterFocusable
    >
      <div data-testid="group" tabIndex={0}>
        <button type="button" data-testid="first" onClick={onFirstAction}>
          First
        </button>
        <button
          key={secondKey}
          type="button"
          data-testid={secondKey}
          tabIndex={secondTabIndex}
        >
          Second
        </button>
      </div>
    </InnerFocusManager>
  );
}

describe("InnerFocusManager", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the group tab stop separate from inactive inner controls", () => {
    render(<InnerFocusHarness active={false} />);

    expect(screen.getByTestId("group").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("first").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByTestId("second").getAttribute("tabindex")).toBe("-1");
  });

  it("navigates inner controls and exits without changing the group node", async () => {
    const onExit = vi.fn();
    const onFirstAction = vi.fn();
    const { rerender } = render(
      <InnerFocusHarness
        active
        onExit={onExit}
        onFirstAction={onFirstAction}
      />,
    );

    const group = screen.getByTestId("group");
    const first = screen.getByTestId("first");
    const second = screen.getByTestId("second");
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(group.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(second));

    fireEvent.keyDown(second, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: "Enter" });
    expect(onFirstAction).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(first, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
    rerender(<InnerFocusHarness active={false} onExit={onExit} />);
    expect(first.getAttribute("tabindex")).toBe("-1");
    expect(second.getAttribute("tabindex")).toBe("-1");
  });

  it("restores replaced and unmounted controls to their original tab order", () => {
    const { rerender, unmount } = render(
      <InnerFocusHarness
        active={false}
        secondKey="old-second"
        secondTabIndex={3}
      />,
    );
    const oldSecond = screen.getByTestId("old-second");

    rerender(<InnerFocusHarness active={false} secondKey="new-second" />);
    const newSecond = screen.getByTestId("new-second");
    expect(oldSecond.getAttribute("tabindex")).toBe("3");
    expect(newSecond.getAttribute("tabindex")).toBe("-1");

    unmount();
    expect(newSecond.hasAttribute("tabindex")).toBe(false);
  });

  it("leaves native tab order untouched when disabled", () => {
    render(<InnerFocusHarness active={false} enabled={false} />);

    expect(screen.getByTestId("first").hasAttribute("tabindex")).toBe(false);
    expect(screen.getByTestId("second").hasAttribute("tabindex")).toBe(false);
  });

  it("manages table links added, replaced and removed by a child-only update", async () => {
    let update: (ids: string[]) => void = () => {};
    function Table() {
      const [ids, setIds] = useState<string[]>([]);
      update = setIds;
      return <table><tbody><tr>{ids.map((id) =>
        <td key={id}><a href={`/${id}`}>{id}</a></td>,
      )}</tr></tbody></table>;
    }
    const view = render(<StrictMode>
      <InnerFocusManager active={false} onExit={() => {}} excludeOuterFocusable>
        <div tabIndex={0}><Table /></div>
      </InnerFocusManager>
    </StrictMode>);
    await act(async () => update(["first", "second"]));
    const first = screen.getByRole("link", { name: "first" });
    const second = screen.getByRole("link", { name: "second" });
    expect(first.tabIndex).toBe(-1);
    expect(second.tabIndex).toBe(-1);
    await act(async () => update(["replacement"]));
    expect(first.hasAttribute("tabindex")).toBe(false);
    expect(second.hasAttribute("tabindex")).toBe(false);
    const replacement = screen.getByRole("link");
    expect(replacement.tabIndex).toBe(-1);
    await act(async () => update([]));
    expect(replacement.hasAttribute("tabindex")).toBe(false);
    view.unmount();
    await act(async () => { replacement.tabIndex = 4; });
    expect(replacement.tabIndex).toBe(4);
  });

  it("tracks interaction attributes and restores the latest business tabindex", async () => {
    const view = render(<InnerFocusManager active={false} onExit={() => {}}>
      <a data-testid="link">Link</a>
      <button type="button">Action</button>
    </InnerFocusManager>);
    const link = screen.getByTestId("link");
    const button = screen.getByRole<HTMLButtonElement>("button");
    await act(async () => { link.setAttribute("href", "/detail"); });
    expect(link.tabIndex).toBe(-1);
    await act(async () => { link.removeAttribute("href"); });
    expect(link.hasAttribute("tabindex")).toBe(false);
    await act(async () => { link.setAttribute("href", "/detail"); button.disabled = true; });
    expect(link.tabIndex).toBe(-1);
    expect(button.hasAttribute("tabindex")).toBe(false);
    await act(async () => { button.disabled = false; link.tabIndex = 3; });
    expect(button.tabIndex).toBe(-1);
    expect(link.tabIndex).toBe(-1);
    await act(async () => { button.parentElement!.setAttribute("aria-hidden", "true"); });
    expect(link.tabIndex).toBe(3);
    await act(async () => { button.parentElement!.removeAttribute("aria-hidden"); });
    expect(link.tabIndex).toBe(-1);
    view.unmount();
    expect(link.tabIndex).toBe(3);
    expect(button.hasAttribute("tabindex")).toBe(false);
  });

  it("preserves focus on insertion and recovers a removed active control", async () => {
    let update: (ids: string[]) => void = () => {};
    function Controls() {
      const [ids, setIds] = useState(["first", "second"]);
      update = setIds;
      return <>{ids.map((id) => <button key={id} type="button">{id}</button>)}</>;
    }
    render(<>
      <InnerFocusManager active onExit={() => {}}><Controls /></InnerFocusManager>
      <button type="button">Outside</button>
    </>);
    const first = screen.getByRole("button", { name: "first" });
    expect(document.activeElement).toBe(first);
    await act(async () => update(["new", "first", "second"]));
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole("button", { name: "new" }).tabIndex).toBe(0);
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("button", { name: "second" });
    expect(document.activeElement).toBe(second);
    await act(async () => update(["new", "first"]));
    expect(document.activeElement).toBe(first);
    const outside = screen.getByRole("button", { name: "Outside" });
    act(() => { outside.focus(); });
    await act(async () => update(["new"]));
    expect(document.activeElement).toBe(outside);
  });

  it("does not rescan for streamed text or its own tabindex mutations", async () => {
    render(<InnerFocusHarness active={false} />);
    await act(async () => {});
    const group = screen.getByTestId("group");
    const query = vi.spyOn(group.parentElement!, "querySelectorAll");
    await act(async () => { group.append(document.createTextNode("Streaming text")); });
    expect(query).not.toHaveBeenCalled();
    await act(async () => { screen.getByTestId("first").tabIndex = 0; });
    expect(query).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("first").tabIndex).toBe(-1);
    query.mockRestore();
  });

  it("stops observing while disabled and enrolls new controls when enabled again", async () => {
    const view = render(<InnerFocusHarness active={false} secondTabIndex={3} />);
    const group = screen.getByTestId("group");
    view.rerender(<InnerFocusHarness active={false} enabled={false} secondTabIndex={3} />);
    expect(screen.getByTestId("second").tabIndex).toBe(3);
    const link = document.createElement("a");
    link.href = "/dynamic";
    await act(async () => { group.append(link); });
    expect(link.hasAttribute("tabindex")).toBe(false);
    view.rerender(<InnerFocusHarness active={false} secondTabIndex={3} />);
    expect(link.tabIndex).toBe(-1);
    view.unmount();
    expect(link.hasAttribute("tabindex")).toBe(false);
  });
});
