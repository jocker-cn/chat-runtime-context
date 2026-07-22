import {memo, useEffect, useMemo, useState} from "react";
import type {Message} from "@ag-ui/client";
import {SocketAdapterAgent, WebSocketBackendTransport} from "./adapters/socketAdapter";
import {
    isThinkingActivityMessage,
    type ThinkingActivityPhase,
} from "./thinkingActivity";
import styles from "./AgUiStatusDemoPage.module.css";

type MessageTurn = {
    id: string;
    user: Message;
    replies: Message[];
};

export function AgUiStatusDemoPage() {
    const websocketUrl =
        import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
    const agent = useMemo(
        () => new SocketAdapterAgent(new WebSocketBackendTransport(websocketUrl), {
            agentId: "ag-ui-status-demo",
            description: "AG-UI status demo",
            threadId: "ag-ui-status-demo",
        }),
        [websocketUrl],
    );
    const {messages, isRunning} = useAgentMessages(agent);
    const [input, setInput] = useState("");
    const turns = useMemo(() => toTurns(messages), [messages]);

    const send = () => {
        const text = input.trim();
        if (!text) return;
        if (isRunning) return;
        agent.addMessage({id: crypto.randomUUID(), role: "user", content: text});
        void agent.runAgent();
        setInput("");
    };

    return (
        <main className={styles.page}>
            <section className={styles.chat} aria-label="AG-UI status demo">
                <header className={styles.header}>
                    <span className={styles.logo} aria-hidden="true">✦</span>
                    <div><h1>AI Search</h1><p>AG-UI agent status demo</p></div>
                    <span className={styles.connection}><i/> Connected</span>
                </header>
                <div className={styles.runtime} aria-live="polite">
                    {turns.length === 0 ?
                        <div className={styles.empty}>Send a message to see the per-turn status.</div> : null}
                    {turns.map((turn, index) => (
                        <TurnView key={turn.id} turn={turn}
                                  active={index === turns.length - 1 && isRunning}/>
                    ))}
                </div>
                <form className={styles.composer} onSubmit={(event) => {
                    event.preventDefault();
                    send();
                }}>
          <textarea
              aria-label="Message AI Search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask AI Search anything..."
              rows={1}
              onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                  }
              }}
          />
                    <button type="submit" aria-label="Send message" disabled={!input.trim() || isRunning}>↑</button>
                </form>
            </section>
        </main>
    );
}

function useAgentMessages(agent: SocketAdapterAgent) {
    const [snapshot, setSnapshot] = useState(() => ({
        messages: [...agent.messages],
        isRunning: agent.isRunning,
    }));

    useEffect(() => {
        const update = () => setSnapshot({messages: [...agent.messages], isRunning: agent.isRunning});
        let animationFrame: number | undefined;
        const updateAfterLifecycleSettles = () => {
            update();
            queueMicrotask(update);
            animationFrame = window.requestAnimationFrame(update);
        };
        const subscription = agent.subscribe({
            onMessagesChanged: update,
            onRunStartedEvent: update,
            onRunFinishedEvent: updateAfterLifecycleSettles,
            onRunErrorEvent: updateAfterLifecycleSettles,
        });
        update();
        return () => {
            if (animationFrame !== undefined) {
                window.cancelAnimationFrame(animationFrame);
            }
            subscription.unsubscribe();
            agent.close();
        };
    }, [agent]);

    return snapshot;
}

const TurnView = memo(TurnViewContent, areTurnsEqual);

function TurnViewContent({turn, active}: { turn: MessageTurn; active: boolean; }) {
    const statusMessage = turn.replies.find(isThinkingActivityMessage);
    const phase = statusMessage?.content.phase ?? "processing";
    return (
        <article className={styles.turn}>
            <UserMessage message={turn.user}/>
            <TurnStatus phase={phase} active={active}/>
            {turn.replies.map((message) =>
                message.role === "assistant" ? (
                    <AssistantMessages key={message.id} message={message}/>
                ) : null,
            )}
        </article>
    );
}

const UserMessage = memo(UserMessageContent);

function UserMessageContent({message}: { message: Message }) {
    return (
        <div className={styles.input}>
            <div className={styles.userMessage}>{messageText(message)}</div>
        </div>
    );
}

function TurnStatus({phase, active,}: { phase: ThinkingActivityPhase; active: boolean; }) {
    return (
        <div className={styles.status} data-active={active || undefined}>
      <span className={styles.statusIcon} aria-label={`${statusLabel(phase)} ${active ? "in progress" : "complete"}`}>
        {active ? <span className={styles.spinner}/> : "✓"}
      </span>
            {statusLabel(phase)}
        </div>
    );
}

const AssistantMessages = memo(AssistantMessageContent);

function AssistantMessageContent({message}: {
    message: Message;
}) {
    const text = messageText(message);
    return text ? <div className={styles.answer}>{text}</div> : null;
}

function areTurnsEqual(
    previous: { turn: MessageTurn; active: boolean },
    next: { turn: MessageTurn; active: boolean },
) {
    if (
        previous.active !== next.active ||
        previous.turn.user.id !== next.turn.user.id ||
        previous.turn.replies.length !== next.turn.replies.length
    ) {
        return false;
    }

    return previous.turn.replies.every((message, index) =>
        isSameReply(message, next.turn.replies[index]),
    );
}

function isSameReply(previous: Message, next: Message | undefined) {
    if (!next || previous.id !== next.id || previous.role !== next.role) {
        return false;
    }

    if (isThinkingActivityMessage(previous) && isThinkingActivityMessage(next)) {
        return previous.content.phase === next.content.phase;
    }

    return previous.role !== "assistant" || messageText(previous) === messageText(next);
}

function toTurns(messages: Message[]): MessageTurn[] {
    const turns: MessageTurn[] = [];
    let current: MessageTurn | undefined;
    messages.forEach((message) => {
        if (message.role === "user") {
            current = {id: message.id, user: message, replies: []};
            turns.push(current);
        } else if (current) {
            current.replies.push(message);
        }
    });
    return turns;
}

function statusLabel(phase: ThinkingActivityPhase) {
    if (phase === "thought") return "Think";
    return phase === "processing" ? "Process" : "AI Search";
}

function messageText(message: Message) {
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => typeof part === "object" && part && "text" in part ? String(part.text) : "")
            .join("");
    }
    return "";
}
