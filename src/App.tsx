import { useEffect, useMemo, useState } from "react";
import {
  ChatRuntimeView,
  SubmissionQueueProvider,
  createChatExtensionStore,
  useQueuedSubmissions,
  useSubmissionQueue,
} from "./core";
import {
  createBeComparisonRuntime,
  createBeSingleRuntime,
} from "./chat/demo/demoRuntime";
import { demoRenderer } from "./chat/demo/demoRenderer";
import type { FrameCardProps } from "./core";
import type {
  DemoMessage,
  DemoRuntimeController,
  DemoSubmission,
} from "./chat/demo/demoRuntime";
import styles from "./App.module.css";

export function App() {
  const websocketUrl =
    import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
  const demos = useDemoRuntimeControllers(websocketUrl);
  if (!demos) {
    return <main className="app" aria-busy="true" />;
  }

  return <DemoChats websocketUrl={websocketUrl} demos={demos} />;
}

function DemoChats({
  websocketUrl,
  demos,
}: {
  websocketUrl: string;
  demos: {
    compareDemo: DemoRuntimeController;
    singleDemo: DemoRuntimeController;
  };
}) {
  const { compareDemo, singleDemo } = demos;
  const compareRuntime = compareDemo.runtime;
  const singleRuntime = singleDemo.runtime;
  const compareExtensions = useMemo(() => createChatExtensionStore(), []);
  const singleExtensions = useMemo(() => createChatExtensionStore(), []);
  const [compareInput, setCompareInput] = useState("帮我总结一下当前发布风险。");
  const [singleInput, setSingleInput] = useState("帮我总结一下当前发布风险。");

  const sendCompare = () => {
    const trimmed = compareInput.trim();
    if (!trimmed) return;

    compareDemo.queue.enqueue({ text: trimmed });
    setCompareInput("");
  };

  const sendSingle = () => {
    const trimmed = singleInput.trim();
    if (!trimmed) return;

    singleDemo.queue.enqueue({ text: trimmed });
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
        <SubmissionQueueProvider queue={compareDemo.queue}>
          <SubmissionQueuePanel onEdit={setCompareInput} />
        </SubmissionQueueProvider>
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
        <SubmissionQueueProvider queue={singleDemo.queue}>
          <SubmissionQueuePanel onEdit={setSingleInput} />
        </SubmissionQueueProvider>
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

function useDemoRuntimeControllers(websocketUrl: string) {
  const [demos, setDemos] = useState<{
    websocketUrl: string;
    compareDemo: DemoRuntimeController;
    singleDemo: DemoRuntimeController;
  }>();

  useEffect(() => {
    const compareDemo = createBeComparisonRuntime({ websocketUrl });
    const singleDemo = createBeSingleRuntime({ websocketUrl });
    const nextDemos = { websocketUrl, compareDemo, singleDemo };
    setDemos(nextDemos);

    return () => {
      compareDemo.dispose();
      singleDemo.dispose();
    };
  }, [websocketUrl]);

  return demos?.websocketUrl === websocketUrl ? demos : undefined;
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

function SubmissionQueuePanel({
  onEdit,
}: {
  onEdit(text: string): void;
}) {
  const queue = useSubmissionQueue<DemoSubmission>();
  const items = useQueuedSubmissions<DemoSubmission>();

  if (items.length === 0) {
    return null;
  }

  const highestPriority = items.reduce(
    (highest, item) => Math.max(highest, item.priority),
    0,
  );

  return (
    <aside className="submission-queue" aria-label="Queued messages">
      <header className="submission-queue-header">
        <strong>Queued messages</strong>
        <span>{items.length}</span>
      </header>
      <ol className="submission-queue-list">
        {items.map((item) => (
          <li
            className="submission-queue-item"
            data-status={item.status}
            key={item.id}
          >
            <p>{item.payload.text}</p>
            <div className="submission-queue-actions">
              {item.status === "failed" ? (
                <button type="button" onClick={() => queue.retry(item.id)}>
                  Retry
                </button>
              ) : (
                <button
                  type="button"
                  disabled={item.status === "dispatching"}
                  onClick={() =>
                    queue.reprioritize(item.id, highestPriority + 1)
                  }
                >
                  Send next
                </button>
              )}
              <button
                type="button"
                disabled={item.status === "dispatching"}
                onClick={() => {
                  const selected = queue.take(item.id);
                  if (selected) {
                    onEdit(selected.payload.text);
                  }
                }}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={item.status === "dispatching"}
                onClick={() => queue.remove(item.id)}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
