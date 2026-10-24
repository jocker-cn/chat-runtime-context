// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeView, createChatExtensionStore } from "../../../src/core";
import { demoRenderer } from "../../../src/chat/demo/demoRenderer";
import { createExtensionPocRuntime, type ExtensionPocRuntimeController } from "../../../src/chat/demo/extension-poc/extensionPocRuntime";
import { FakeSocket } from "./backendSocketMock";

const controllers: ExtensionPocRuntimeController[] = [];
beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(async () => {
  cleanup();
  await Promise.allSettled(controllers.splice(0).map((controller) => controller.dispose()));
  vi.unstubAllGlobals();
  FakeSocket.instances = [];
});

async function start() {
  const controller = createExtensionPocRuntime();
  controllers.push(controller);
  const extensions = Object.assign(createChatExtensionStore(), {
    responseTraces: controller.responseTraces,
    resolveResponseTrace: controller.resolveResponseTrace,
  });
  render(<ChatRuntimeView runtime={controller.runtime} renderer={demoRenderer} extensions={extensions} />);
  await act(async () => { await controller.runtime.send("Question"); });
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
  const [a, b] = FakeSocket.instances;
  await act(async () => { a!.open(); b!.open(); });
  return { controller, a: a!, b: b! };
}

describe("Message Card optional response trace action", () => {
  it("opens only after its own response ends, with another Agent still running", async () => {
    const { controller, a, b } = await start();
    await act(async () => {
      a.message({ event: "thinking_delta", message: { id: "reasoning-a", content: "Original thought" } });
      a.message({ event: "streaming_started", message: { id: "answer-a" } });
      a.message({ event: "streaming", message: { id: "answer-a", content: "Answer A" } });
    });
    const button = await screen.findByRole("button", { name: "查看响应过程" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      a.message({ event: "streaming_completed", message: { id: "answer-a" } });
      a.message({ event: "completed" });
    });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(controller.runtime.getSnapshot().status).toBe("running");
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看 thinking 内容" }).textContent).toBe("Original thought");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(a.sent).toHaveLength(1);
    await act(async () => { b.message({ event: "completed" }); });
  });

  it.each(["backend", "disconnect", "parse"])("reports %s errors as inspectable events before any Assistant text exists", async (failure) => {
    const { a, b } = await start();
    await act(async () => {
      if (failure === "backend") a.message({ event: "error", error: "Unavailable" });
      if (failure === "disconnect") { a.onerror?.(); a.end(); }
      if (failure === "parse") a.onmessage?.({ data: "not-json" });
    });
    const button = await screen.findByRole("button", { name: "查看响应过程" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "查看 error 内容" }));
    const detail = screen.getByRole("region", { name: "事件详情" }).textContent;
    expect(detail).toMatch(failure === "backend" ? /Unavailable/ : failure === "disconnect" ? /WebSocket/ : /JSON|Unexpected/);
    await act(async () => { b.message({ event: "completed" }); });
  });
});
