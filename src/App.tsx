import { useMemo, useState } from "react";
import { ChatRuntimeView } from "./core/view/ChatRuntimeView";
import { createChatExtensionStore } from "./core/extensions/ChatExtensionStore";
import { createBeComparisonRuntime } from "./chat/demo/demoRuntime";
import { demoRenderer } from "./chat/demo/demoRenderer";
import type { FrameCardProps } from "./core/frame/createFrameRenderer";
import type { DemoMessage } from "./chat/demo/demoRuntime";
import styles from "./App.module.css";

export function App() {
  const websocketUrl =
    import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
  const runtime = useMemo(
    () =>
      createBeComparisonRuntime({
        websocketUrl,
      }),
    [websocketUrl],
  );
  const extensions = useMemo(() => createChatExtensionStore(), []);
  const [input, setInput] = useState("帮我总结一下当前发布风险。");

  const send = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    void runtime.send(trimmed);
    setInput("");
  };

  return (
    <main className="app">
      <section className="chat-shell">
        <header className="chat-header">
          <p className="eyebrow">AG-UI A/B Runtime</p>
          <h1>Two agents, one backend</h1>
          <p className="connection">Backend: {websocketUrl}</p>
        </header>
        <div className="composer">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                send();
              }
            }}
          />
          <button type="button" onClick={send}>
            Send
          </button>
        </div>
        <ChatRuntimeView
          runtime={runtime}
          extensions={extensions}
          renderer={demoRenderer}
          renderInput={renderDemoInput}
          classNames={{
            root: styles.runtime,
            branch: styles.branch,
            slot: styles.frameSlot,
          }}
          empty={<p className="empty">Send a message to create a turn.</p>}
        />
      </section>
    </main>
  );
}

function renderDemoInput(props: FrameCardProps<DemoMessage>) {
  const Card = demoRenderer.getCard(props.message, props.context);

  return <Card {...props} />;
}
