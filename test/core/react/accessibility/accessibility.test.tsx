/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameListItem } from "../../../../src/core/frame/FrameListItem";
import type { FrameListAccessibilityOptions } from "../../../../src/core/react/accessibility/useFrameListAccessibility";
import { useFrameListAccessibility } from "../../../../src/core/react/accessibility/useFrameListAccessibility";

interface AccessibilityHarnessProps {
  accessibility?: FrameListAccessibilityOptions;
  frameIds: readonly string[];
  onInnerAction?: () => void;
}

function AccessibilityHarness({
  accessibility,
  frameIds,
  onInnerAction,
}: AccessibilityHarnessProps) {
  const accessibilityApi = useFrameListAccessibility({
    accessibility,
    frameIds,
  });

  return (
    <div data-testid="frame-list" {...accessibilityApi.listProps}>
      {frameIds.map((frameId) => (
        <FrameListItem
          key={frameId}
          frameId={frameId}
          className="frame"
          enabled={accessibilityApi.enabled}
          active={accessibilityApi.activeFrameId === frameId}
          registerFrame={accessibilityApi.registerFrame}
          onExitFrame={accessibilityApi.onExitFrame}
          onFrameFocus={accessibilityApi.onFrameFocus}
          onFrameKeyDown={accessibilityApi.onFrameKeyDown}
        >
          <button
            type="button"
            data-testid={`${frameId}-first`}
            onClick={onInnerAction}
          >
            First {frameId}
          </button>
          <button type="button" data-testid={`${frameId}-second`}>
            Second {frameId}
          </button>
        </FrameListItem>
      ))}
    </div>
  );
}

const getFrame = (frameId: string) =>
  document.querySelector<HTMLDivElement>(`[data-frame-id="${frameId}"]`)!;

describe("frame accessibility integration", () => {
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

  it("applies list semantics and keeps only the latest frame in the tab order", () => {
    render(<AccessibilityHarness frameIds={["one", "two", "three"]} />);

    const list = screen.getByTestId("frame-list");
    expect(list.getAttribute("role")).toBe("list");
    expect(list.getAttribute("aria-label")).toBe("chat");
    expect(list.getAttribute("tabindex")).toBe("-1");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);

    expect(getFrame("one").getAttribute("tabindex")).toBe("-1");
    expect(getFrame("two").getAttribute("tabindex")).toBe("-1");
    expect(getFrame("three").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("three-first").getAttribute("tabindex")).toBe(
      "-1",
    );
  });

  it("moves the outer frame focus with arrow and page keys and clamps at the ends", async () => {
    render(
      <AccessibilityHarness
        frameIds={["one", "two", "three", "four"]}
        accessibility={{ pageStep: 2 }}
      />,
    );

    const first = getFrame("one");
    const second = getFrame("two");
    const fourth = getFrame("four");
    fourth.focus();

    fireEvent.keyDown(fourth, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(getFrame("three")));

    fireEvent.keyDown(getFrame("three"), { key: "PageUp" });
    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(second));

    fireEvent.keyDown(second, { key: "PageDown" });
    await waitFor(() => expect(document.activeElement).toBe(fourth));
    expect(fourth.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("tabindex")).toBe("-1");
  });

  it("enters a frame, navigates and activates inner controls, then exits with Escape", async () => {
    const onInnerAction = vi.fn();
    render(
      <AccessibilityHarness
        frameIds={["one"]}
        onInnerAction={onInnerAction}
      />,
    );

    const frame = getFrame("one");
    const first = screen.getByTestId("one-first");
    const second = screen.getByTestId("one-second");
    frame.focus();
    fireEvent.keyDown(frame, { key: "Enter" });

    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(frame.getAttribute("data-active-frame")).toBe("true");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(first.classList.contains("keyboard-focus")).toBe(true);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(first.classList.contains("keyboard-focus")).toBe(false);
    expect(second.classList.contains("keyboard-focus")).toBe(true);

    fireEvent.keyDown(second, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(first, { key: "Enter" });
    expect(onInnerAction).toHaveBeenCalledTimes(1);

    const tabEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    first.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(frame));
    expect(frame.hasAttribute("data-active-frame")).toBe(false);
    expect(first.getAttribute("tabindex")).toBe("-1");
    expect(second.getAttribute("tabindex")).toBe("-1");
  });

  it("makes a newly appended frame the roving tab stop without stealing DOM focus", () => {
    const { rerender } = render(
      <AccessibilityHarness frameIds={["one", "two"]} />,
    );
    const second = getFrame("two");
    second.focus();
    expect(document.activeElement).toBe(second);

    rerender(<AccessibilityHarness frameIds={["one", "two", "three"]} />);

    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("tabindex")).toBe("-1");
    expect(getFrame("three").getAttribute("tabindex")).toBe("0");
  });

  it("clears active state and repairs the roving tab stop when an active frame is removed", async () => {
    const { rerender } = render(
      <AccessibilityHarness frameIds={["one", "two"]} />,
    );
    const second = getFrame("two");
    second.focus();
    fireEvent.keyDown(second, { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("two-first")),
    );

    rerender(<AccessibilityHarness frameIds={["one"]} />);

    await waitFor(() =>
      expect(getFrame("one").hasAttribute("data-active-frame")).toBe(false),
    );
    expect(getFrame("one").getAttribute("tabindex")).toBe("0");
  });

  it("removes list and frame semantics when accessibility is disabled", () => {
    render(
      <AccessibilityHarness
        frameIds={["one"]}
        accessibility={{ enabled: false, ariaLabel: "messages" }}
      />,
    );

    const list = screen.getByTestId("frame-list");
    const frame = getFrame("one");
    expect(list.hasAttribute("role")).toBe(false);
    expect(list.hasAttribute("aria-label")).toBe(false);
    expect(list.hasAttribute("tabindex")).toBe(false);
    expect(document.querySelector('[role="listitem"]')).toBeNull();
    expect(frame.hasAttribute("tabindex")).toBe(false);

    frame.focus();
    fireEvent.keyDown(frame, { key: "Enter" });
    expect(frame.hasAttribute("data-active-frame")).toBe(false);
  });
});
