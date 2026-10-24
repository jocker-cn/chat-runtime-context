// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseTraceDialog, type ResponseTraceRecord } from "../../../src/features/ai-response-trace";

afterEach(cleanup);
const trace: ResponseTraceRecord = {
  ref: { sourceId: "agent-a", threadId: "s", runId: "r" },
  input: { threadId: "s", runId: "r", messages: [], tools: [], context: [], state: {}, forwardedProps: {} },
  outcome: "completed", startedAt: 100, endedAt: 300, events: [],
  entries: [
    { id: "result", event: "caller-defined", startedAt: 120, endedAt: 180,
      content: '{"sum":3,"allFields":{"nested":[1,null,true]}}', details: { customField: "untouched" } },
    { id: "no-duration", event: "another-custom-event", startedAt: 190, content: "no end reported" },
  ],
  summary: { durationMs: 200, eventCount: 2 },
};

describe("ResponseTraceDialog", () => {
  it("owns its closed and empty-record rendering without caller conditionals", () => {
    const view = render(<ResponseTraceDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<ResponseTraceDialog open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("暂无事件记录")).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((element) => element.textContent)).toEqual(["event", "content"]);
    view.rerender(<ResponseTraceDialog open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a generic duration chart and event/content list, with details inside the same dialog", () => {
    const { container } = render(<ResponseTraceDialog open trace={trace} onClose={() => {}} />);
    expect(container.contains(screen.getByRole("dialog"))).toBe(false);
    expect(screen.getByText(/总耗时/).textContent).toContain("200 ms");
    const bar = screen.getByRole("button", { name: "caller-defined · 60 ms" });
    expect(bar.style.left).toBe("10%");
    expect(bar.style.width).toBe("30%");
    expect(screen.getByRole("button", { name: "another-custom-event · 耗时未上报" })).toBeTruthy();
    expect(screen.queryByText("工具调用")).toBeNull();
    expect(screen.queryByText("阶段")).toBeNull();
    expect(screen.queryByText("agent-a · 已完成")).toBeNull();
    expect(screen.queryByRole("region", { name: "事件详情" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看 caller-defined 内容" }));
    const detail = screen.getByRole("region", { name: "事件详情" });
    expect(detail.textContent).toContain('"allFields"');
    expect(detail.textContent).toContain('"nested"');
    expect(screen.getByText("完整数据")).toBeTruthy();
    fireEvent.click(screen.getByText("完整数据"));
    expect(detail.textContent).toContain("untouched");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "← 返回列表" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "查看 caller-defined 内容" }));
    fireEvent.click(screen.getByRole("button", { name: "caller-defined · 60 ms" }));
    expect(screen.getByRole("region", { name: "事件详情" })).toBeTruthy();
  });

  it("handles Escape and restores the caller's focus on close", () => {
    const close = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const view = render(<ResponseTraceDialog open trace={trace} onClose={close} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    view.rerender(<ResponseTraceDialog open={false} trace={trace} onClose={close} />);
    expect(document.activeElement).toBe(trigger);
    view.rerender(<ResponseTraceDialog open trace={trace} onClose={close} />);
    expect(screen.getByRole("table")).toBeTruthy();
    trigger.remove();
  });
});
