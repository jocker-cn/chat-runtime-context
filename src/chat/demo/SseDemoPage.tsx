import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useEffect, useState } from "react";
import styles from "./SseDemoPage.module.css";

type RandomSseMessage = {
  content: string;
  sentAt: string;
};

const SSE_URL =
  import.meta.env.VITE_SSE_URL ?? "http://localhost:8080/api/sse/random";

export function SseDemoPage() {
  const [messages, setMessages] = useState<RandomSseMessage[]>([]);
  const [connectionState, setConnectionState] = useState("Connecting...");

  useEffect(() => {
    const controller = new AbortController();

    void fetchEventSource(SSE_URL, {
      signal: controller.signal,
      async onopen(response) {
        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }
        setConnectionState("Connected");
      },
      onmessage(event) {
        if (event.event !== "random-message") return;

        const message = JSON.parse(event.data) as RandomSseMessage;
        console.log("[SSE] random-message", message);
        setMessages((current) => [message, ...current].slice(0, 20));
      },
      onerror(error) {
        if (controller.signal.aborted) return;

        console.error("[SSE] connection error; retrying in 3 seconds", error);
        setConnectionState("Reconnecting...");
        return 3_000;
      },
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("[SSE] stream stopped", error);
        setConnectionState("Disconnected");
      }
    });

    return () => controller.abort();
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>SSE DEMO</p>
        <h1>Backend random messages</h1>
        <p className={styles.connection}>{connectionState}: {SSE_URL}</p>
        <p className={styles.hint}>
          Each event is also printed in the browser console.
        </p>
        <ol className={styles.messages}>
          {messages.length === 0 ? (
            <li className={styles.empty}>Waiting for the first event...</li>
          ) : (
            messages.map((message, index) => (
              <li key={`${message.sentAt}-${index}`}>
                <strong>{message.content}</strong>
                <time>{new Date(message.sentAt).toLocaleTimeString()}</time>
              </li>
            ))
          )}
        </ol>
      </section>
    </main>
  );
}
