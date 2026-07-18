// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  ReactFlow: ({ nodes }: { nodes: readonly { id: string }[] }) => (
    <div data-testid="runtime-flow">{nodes.map((node) => <span key={node.id}>{node.id}</span>)}</div>
  ),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNodesInitialized: () => false,
  useReactFlow: () => ({ fitView: vi.fn() }),
}));

import { RuntimeSimulator } from "../../whitepaper/src/components/RuntimeSimulator";

afterEach(cleanup);

describe("whitepaper RuntimeSimulator", () => {
  it("evolves steps locally without treating every event as navigation", () => {
    const onScenarioChange = vi.fn();
    render(
      <RuntimeSimulator
        scenarioId="single-send"
        initialEventIndex={-1}
        onScenarioChange={onScenarioChange}
      />,
    );

    const flow = screen.getByTestId("runtime-flow");
    expect(screen.getByText("等待发送")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getAllByText("创建输入消息").length).toBeGreaterThan(0);
    expect(screen.getByTestId("runtime-flow")).toBe(flow);

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getAllByText("提交 Turn 与 Branch 拓扑").length).toBeGreaterThan(0);
    expect(screen.getByTestId("runtime-flow")).toBe(flow);
    expect(onScenarioChange).not.toHaveBeenCalled();
  });

  it("keeps a readable primary playback label", () => {
    render(
      <RuntimeSimulator
        scenarioId="single-send"
        initialEventIndex={-1}
        onScenarioChange={() => undefined}
      />,
    );

    const play = screen.getByRole("button", { name: "播放演进" });
    expect(play.classList.contains("primary-button")).toBe(true);
  });
});
