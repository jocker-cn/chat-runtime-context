/** @vitest-environment jsdom */

import {
  StrictMode,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeFocusController,
  RuntimeFocusGroup,
  useRuntimeFocusRootProps,
} from "../../../../src/core/react/accessibility/RuntimeFocusController";

interface RuntimeFocusHarnessProps {
  exposeSetGroupIds?: (
    setter: Dispatch<SetStateAction<readonly string[]>>,
  ) => void;
  initialGroupIds?: readonly string[];
  onGroupRender?: (groupId: string) => void;
}

function RuntimeFocusHarness({
  exposeSetGroupIds,
  initialGroupIds = ["question", "response"],
  onGroupRender,
}: RuntimeFocusHarnessProps) {
  const [groupIds, setGroupIds] = useState(initialGroupIds);
  exposeSetGroupIds?.(setGroupIds);

  return (
    <RuntimeFocusController>
      <RuntimeFocusList
        groupIds={groupIds}
        onGroupRender={onGroupRender}
      />
    </RuntimeFocusController>
  );
}

function RuntimeFocusList({
  groupIds,
  onGroupRender,
}: {
  groupIds: readonly string[];
  onGroupRender?: (groupId: string) => void;
}) {
  const rootProps = useRuntimeFocusRootProps();

  return (
    <div>
      <button type="button" data-testid="before">
        Before
      </button>
      <section data-testid="runtime" {...rootProps}>
        {groupIds.map((groupId) => (
          <RuntimeFocusGroup
            key={groupId}
            groupId={groupId}
            data-testid={`group-${groupId}`}
          >
            <GroupContent
              groupId={groupId}
              onRender={onGroupRender}
            />
          </RuntimeFocusGroup>
        ))}
      </section>
      <button type="button" data-testid="after">
        After
      </button>
    </div>
  );
}

function GroupContent({
  groupId,
  onRender,
}: {
  groupId: string;
  onRender?: (groupId: string) => void;
}) {
  onRender?.(groupId);

  return (
    <button type="button" data-testid={`action-${groupId}`}>
      Action {groupId}
    </button>
  );
}

describe("RuntimeFocusController", () => {
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

  it("registers groups idempotently in StrictMode and roves with arrow keys", async () => {
    render(
      <StrictMode>
        <RuntimeFocusHarness />
      </StrictMode>,
    );

    const question = screen.getByTestId("group-question");
    const response = screen.getByTestId("group-response");
    expect(screen.getByTestId("runtime").getAttribute("role")).toBe("list");
    expect(screen.getByTestId("runtime").getAttribute("aria-label")).toBe(
      "Chat messages",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      document.querySelectorAll("[data-runtime-focus-group-id]"),
    ).toHaveLength(2);
    expect(question.getAttribute("tabindex")).toBe("-1");
    expect(response.getAttribute("tabindex")).toBe("0");
    expect(question.getAttribute("aria-label")).toBe("Message");
    expect(question.getAttribute("aria-keyshortcuts")).toBe(
      "ArrowUp ArrowDown Enter Escape",
    );
    expect(question.getAttribute("aria-posinset")).toBe("1");
    expect(question.getAttribute("aria-setsize")).toBe("2");
    expect(response.getAttribute("aria-posinset")).toBe("2");
    expect(response.getAttribute("aria-setsize")).toBe("2");

    response.focus();
    fireEvent.keyDown(response, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(question));
    expect(question.getAttribute("tabindex")).toBe("0");
    expect(response.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(question, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(response));
  });

  it("leaves Tab unhandled and remembers the last focused group", async () => {
    render(<RuntimeFocusHarness />);

    const question = screen.getByTestId("group-question");
    const response = screen.getByTestId("group-response");
    const after = screen.getByTestId("after");
    response.focus();
    fireEvent.keyDown(response, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(question));

    const tabEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    question.dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);

    fireEvent.blur(question, { relatedTarget: after });
    after.focus();
    await waitFor(() =>
      expect(question.getAttribute("tabindex")).toBe("0"),
    );
    expect(response.getAttribute("tabindex")).toBe("-1");

    question.focus();
    expect(document.activeElement).toBe(question);
  });

  it("enters and exits one group's inner focus manager", async () => {
    render(<RuntimeFocusHarness />);

    const response = screen.getByTestId("group-response");
    const action = screen.getByTestId("action-response");
    expect(action.getAttribute("tabindex")).toBe("-1");

    response.focus();
    fireEvent.keyDown(response, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(action));
    expect(action.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(action, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(response));
    expect(action.getAttribute("tabindex")).toBe("-1");
  });

  it("does not enter inner mode for Enter bubbling from a business control", () => {
    render(<RuntimeFocusHarness />);
    const action = screen.getByTestId("action-response");
    act(() => { action.focus(); });
    const unhandled = fireEvent.keyDown(action, { key: "Enter" });
    expect(unhandled).toBe(true);
    expect(screen.getByTestId("group-response").hasAttribute("data-active-runtime-group")).toBe(false);
    expect(action.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(action);
  });

  it("exits inner mode when focus leaves without moving focus back", async () => {
    render(<RuntimeFocusHarness />);
    const response = screen.getByTestId("group-response");
    const action = screen.getByTestId("action-response");
    act(() => { response.focus(); });
    fireEvent.keyDown(response, { key: "Enter" });
    expect(document.activeElement).toBe(action);
    const outside = screen.getByTestId("after");
    act(() => { outside.focus(); });
    expect(response.hasAttribute("data-active-runtime-group")).toBe(false);
    expect(action.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(outside);
    act(() => { response.focus(); });
    expect(fireEvent.keyDown(response, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(response);
  });

  it("keeps inner mode between controls but respects focus moved by a business action", async () => {
    const onBlur = vi.fn();
    render(<>
      <RuntimeFocusGroup groupId="response" data-testid="group" onBlur={onBlur}>
        <table><tbody><tr><td><a href="/detail">Detail</a></td></tr></tbody></table>
        <button type="button" onClick={() => screen.getByTestId("dialog-input").focus()}>Open dialog</button>
      </RuntimeFocusGroup>
      <input data-testid="dialog-input" />
    </>);
    const group = screen.getByTestId("group");
    act(() => { group.focus(); });
    fireEvent.keyDown(group, { key: "Enter" });
    const link = screen.getByRole("link");
    expect(document.activeElement).toBe(link);
    fireEvent.keyDown(link, { key: "ArrowRight" });
    const button = screen.getByRole("button", { name: "Open dialog" });
    expect(document.activeElement).toBe(button);
    expect(group.getAttribute("data-active-runtime-group")).toBe("true");
    fireEvent.keyDown(button, { key: "Enter" });
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByTestId("dialog-input"));
    expect(group.hasAttribute("data-active-runtime-group")).toBe(false);
    expect(link.tabIndex).toBe(-1);
    expect(button.tabIndex).toBe(-1);
    expect(onBlur).toHaveBeenCalled();
  });

  it("returns to the message container when its last active control is removed", async () => {
    let remove: () => void = () => {};
    function Table() {
      const [visible, setVisible] = useState(true);
      remove = () => setVisible(false);
      return visible ? <table><tbody><tr><td><a href="/detail">Detail</a></td></tr></tbody></table> : null;
    }
    render(<RuntimeFocusGroup groupId="response" data-testid="group"><Table /></RuntimeFocusGroup>);
    const group = screen.getByTestId("group");
    act(() => { group.focus(); });
    fireEvent.keyDown(group, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("link"));
    await act(async () => remove());
    expect(document.activeElement).toBe(group);
    expect(group.hasAttribute("data-active-runtime-group")).toBe(false);
    expect(fireEvent.keyDown(group, { key: "Tab" })).toBe(true);
  });

  it("changes the outer focus without rendering group content again", async () => {
    const onGroupRender = vi.fn();
    render(<RuntimeFocusHarness onGroupRender={onGroupRender} />);
    expect(onGroupRender).toHaveBeenCalledTimes(2);

    const response = screen.getByTestId("group-response");
    response.focus();
    fireEvent.keyDown(response, { key: "ArrowUp" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("group-question")),
    );

    expect(onGroupRender).toHaveBeenCalledTimes(2);
  });

  it("preserves the focused group while streaming appends a new group", async () => {
    let setGroupIds:
      | Dispatch<SetStateAction<readonly string[]>>
      | undefined;
    render(
      <RuntimeFocusHarness
        exposeSetGroupIds={(setter) => {
          setGroupIds = setter;
        }}
      />,
    );

    const question = screen.getByTestId("group-question");
    const response = screen.getByTestId("group-response");
    response.focus();
    fireEvent.keyDown(response, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(question));

    setGroupIds?.((current) => [...current, "streamed"]);
    const streamed = await screen.findByTestId("group-streamed");
    expect(document.activeElement).toBe(question);
    expect(question.getAttribute("tabindex")).toBe("0");
    expect(streamed.getAttribute("tabindex")).toBe("-1");
    expect(question.getAttribute("aria-posinset")).toBe("1");
    expect(question.getAttribute("aria-setsize")).toBe("3");
    expect(response.getAttribute("aria-posinset")).toBe("2");
    expect(response.getAttribute("aria-setsize")).toBe("3");
    expect(streamed.getAttribute("aria-posinset")).toBe("3");
    expect(streamed.getAttribute("aria-setsize")).toBe("3");

    setGroupIds?.((current) =>
      current.filter((groupId) => groupId !== "question"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("group-question")).toBeNull(),
    );
    expect(streamed.getAttribute("tabindex")).toBe("0");
    expect(response.getAttribute("aria-posinset")).toBe("1");
    expect(response.getAttribute("aria-setsize")).toBe("2");
    expect(streamed.getAttribute("aria-posinset")).toBe("2");
    expect(streamed.getAttribute("aria-setsize")).toBe("2");
  });
});
