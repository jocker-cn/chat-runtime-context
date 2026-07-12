/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SubmissionQueueProvider,
  createSubmissionQueue,
  useQueuedSubmissions,
  useSubmissionQueue,
} from "../../../src/core/queue";

afterEach(cleanup);

describe("SubmissionQueueProvider", () => {
  it("exposes queue commands and reactive items without involving ChatRuntime", () => {
    const queue = createSubmissionQueue<{ text: string }>();

    render(
      <SubmissionQueueProvider queue={queue}>
        <QueueConsumer />
      </SubmissionQueueProvider>,
    );

    expect(screen.getByTestId("queue-size").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Queue message" }));
    expect(screen.getByTestId("queue-size").textContent).toBe("1");
    expect(screen.getByText("queued from component")).toBeTruthy();
  });
});

function QueueConsumer() {
  const queue = useSubmissionQueue<{ text: string }>();
  const items = useQueuedSubmissions<{ text: string }>();

  return (
    <div>
      <button
        type="button"
        onClick={() => queue.enqueue({ text: "queued from component" })}
      >
        Queue message
      </button>
      <output data-testid="queue-size">{items.length}</output>
      {items.map((item) => (
        <p key={item.id}>{item.payload.text}</p>
      ))}
    </div>
  );
}
