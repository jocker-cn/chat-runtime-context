/** @vitest-environment jsdom */

import {
  StrictMode,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  cleanup,
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
