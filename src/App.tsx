import { useMemo, useState } from "react";
import { ChatRuntimeView } from "./core";
import { createChatExtensionStore } from "./core";
import {
  createBeComparisonRuntime,
  createBeSingleRuntime,
} from "./chat/demo/demoRuntime";
import { demoRenderer } from "./chat/demo/demoRenderer";
import type { FrameCardProps } from "./core";
import type { DemoMessage } from "./chat/demo/demoRuntime";
import styles from "./App.module.css";

export function App() {
  const websocketUrl =
    import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
  const compareDemo = useMemo(
    () =>
      createBeComparisonRuntime({
        websocketUrl,
      }),
    [websocketUrl],
  );
  const singleDemo = useMemo(
    () =>
      createBeSingleRuntime({
        websocketUrl,
      }),
    [websocketUrl],
  );
  const compareRuntime = compareDemo.runtime;
  const singleRuntime = singleDemo.runtime;
  const compareExtensions = useMemo(() => createChatExtensionStore(), []);
  const singleExtensions = useMemo(() => createChatExtensionStore(), []);
  const [compareInput, setCompareInput] = useState("帮我总结一下当前发布风险。");
  const [singleInput, setSingleInput] = useState("帮我总结一下当前发布风险。");

  const sendCompare = () => {
    const trimmed = compareInput.trim();
    if (!trimmed) return;

    void compareRuntime.send(trimmed);
    setCompareInput("");
  };

  const sendSingle = () => {
    const trimmed = singleInput.trim();
    if (!trimmed) return;

    void singleRuntime.send(trimmed);
    setSingleInput("");
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
            value={compareInput}
            onChange={(event) => setCompareInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendCompare();
              }
            }}
          />
          <button type="button" onClick={sendCompare}>
            Send
          </button>
          <button
            className="secondary"
            type="button"
            onClick={compareDemo.deleteLastTurn}
          >
            Delete last turn
          </button>
        </div>
        <ChatRuntimeView
          runtime={compareRuntime}
          extensions={compareExtensions}
          renderer={demoRenderer}
          renderInput={renderDemoInput}
          classNames={{
            root: styles.runtime,
            branch: styles.branch,
            slot: styles.frameSlot,
          }}
          empty={<p className="empty">Send a message to create a turn.</p>}
          loadingIndicator={<DemoLoadingIndicator />}
        />
      </section>

      <section className="chat-shell">
        <header className="chat-header">
          <p className="eyebrow">AG-UI Single Runtime</p>
          <h1>One agent, one branch</h1>
          <p className="connection">Backend: {websocketUrl}</p>
        </header>
        <div className="composer">
          <input
            value={singleInput}
            onChange={(event) => setSingleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendSingle();
              }
            }}
          />
          <button type="button" onClick={sendSingle}>
            Send
          </button>
          <button
            className="secondary"
            type="button"
            onClick={singleDemo.deleteLastTurn}
          >
            Delete last turn
          </button>
        </div>
        <ChatRuntimeView
          runtime={singleRuntime}
          extensions={singleExtensions}
          renderer={demoRenderer}
          renderInput={renderDemoInput}
          classNames={{
            root: styles.runtime,
            branch: styles.singleBranch,
            slot: styles.frameSlot,
          }}
          empty={<p className="empty">Send a message to create a turn.</p>}
          loadingIndicator={<DemoLoadingIndicator />}
        />
      </section>
    </main>
  );
}

function renderDemoInput(props: FrameCardProps<DemoMessage>) {
  const Card = demoRenderer.getCard(props.message, props.context);

  return <Card {...props} />;
}

function DemoLoadingIndicator() {
  return (
    <div className="chat-loading" role="status" aria-live="polite">
      <span className="chat-loading-dot" aria-hidden="true" />
      Generating response...
    </div>
  );
}
