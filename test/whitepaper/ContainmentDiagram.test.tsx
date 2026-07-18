// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContainmentDiagram } from "../../whitepaper/src/components/ContainmentDiagram";
import { getContainmentScene } from "../../whitepaper/src/data/containment";

afterEach(cleanup);

describe("whitepaper containment diagram", () => {
  it("renders the full nested component structure without the old Host panel", () => {
    render(
      <ContainmentDiagram
        scene={getContainmentScene("overview")}
        onActivate={() => undefined}
      />,
    );

    expect(screen.getByText("Chat Runtime Core")).not.toBeNull();
    expect(screen.getByText("Runtime Engine")).not.toBeNull();
    expect(screen.getByText("React View System")).not.toBeNull();
    expect(screen.getByText("FrameSlot")).not.toBeNull();
    expect(screen.getByText("Business Card")).not.toBeNull();
    expect(screen.queryByText("Host Application")).toBeNull();
    expect(screen.queryByText("进入内部结构")).toBeNull();
    expect(screen.getByText("这一层为什么这样设计")).not.toBeNull();
    expect(screen.getByText("需要解决的问题")).not.toBeNull();
    expect(screen.getAllByText("为什么需要").length).toBeGreaterThan(0);
  });

  it("drills down when the layer itself is clicked", () => {
    const onActivate = vi.fn();
    render(
      <ContainmentDiagram
        scene={getContainmentScene("overview")}
        onActivate={onActivate}
      />,
    );

    const runtimeLayer = screen.getByText("Runtime Engine").closest("article");
    expect(runtimeLayer).not.toBeNull();
    fireEvent.click(runtimeLayer!);

    expect(onActivate).toHaveBeenCalledWith({
      sceneId: "overview",
      nodeId: "runtime-core",
    });
  });

  it("offers an in-canvas back action for nested architecture scenes", () => {
    const onBack = vi.fn();
    render(
      <ContainmentDiagram
        scene={getContainmentScene("runtime")}
        onActivate={() => undefined}
        onBack={onBack}
        backLabel="返回 Chat Runtime Core 全景"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回 Chat Runtime Core 全景" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
