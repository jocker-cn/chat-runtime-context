/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
