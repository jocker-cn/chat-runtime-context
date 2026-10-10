import {useEffect, useState} from "react";
import {extensionKindLabels, type ExtensionKind} from "./extensionModel";
import {chatData, type PocChatSession} from "./chatHistory";
import styles from "./ExtensionPocPage.module.css";

export function ExtensionPocSidebar({activeSessionId, activeFeature, onSelectSession, onSelectFeature, canNavigate}: {
    activeSessionId?: string;
    activeFeature: ExtensionKind | null;
    onSelectSession(id: string): void;
    onSelectFeature(kind: ExtensionKind): void;
    canNavigate(): boolean;
}) {
    return (
        <aside className={styles.sidebar} aria-label="工作台导航">
            <div className={styles.sidebarHeader}>
                <span className={styles.overline}>AI WORKSPACE</span>
                <h1>你的工作台</h1>
            </div>
            <nav className={styles.featureNav} aria-label="功能选择">
                <h2>功能</h2>
                {(["agent", "skill", "mcp", "plugin"] as const).map((kind) => (
                    <button key={kind} type="button" aria-current={activeFeature === kind ? "page" : undefined}
                            onClick={() => onSelectFeature(kind)}>
                        <span className={styles.featureIcon} aria-hidden="true">
                            {kind === "agent" ? "A" : kind === "skill" ? "S" : kind === "mcp" ? "M" : "P"}
                        </span>
                        自定义 {extensionKindLabels[kind]}
                    </button>
                ))}
            </nav>
            <ChatSessionList activeSessionId={activeSessionId} activeFeature={activeFeature}
                             onSelect={onSelectSession} canNavigate={canNavigate}/>
            <footer className={styles.sidebarFooter}>
                <small>会话保留在当前页面，刷新后重置。</small>
            </footer>
        </aside>
    );
}

/** Owns session directory data; it never creates or caches a chat Runtime. */
function ChatSessionList({activeSessionId, activeFeature, onSelect, canNavigate}: {
    activeSessionId?: string;
    activeFeature: ExtensionKind | null;
    onSelect(id: string): void;
    canNavigate(): boolean;
}) {
    const [sessions, setSessions] = useState<PocChatSession[]>([]);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        let request = 0;
        const load = async () => {
            const version = ++request;
            try {
                const items = await chatData.listSessions();
                if (!active || version !== request) return;
                setSessions(items);
                setError("");
                if (!activeSessionId && items[0]) onSelect(items[0].id);
            } catch (reason) {
                if (active) setError(String(reason));
            }
        };
        const unsubscribe = chatData.subscribe(() => { void load(); });
        void load();
        return () => { active = false; unsubscribe(); };
    }, [activeSessionId, onSelect]);

    const newChat = async () => {
        if (!canNavigate()) return;
        try {
            const session = await chatData.createSession();
            onSelect(session.id);
        } catch (reason) { setError(String(reason)); }
    };
    return (
        <>
            <button className={styles.newChatButton} type="button" onClick={() => { void newChat(); }}>
                <span aria-hidden="true">＋</span> 新建对话
            </button>
            <section className={styles.historySection} aria-label="聊天历史">
                <h2>聊天历史</h2>
                {error && <p role="alert" className={styles.formError}>{error}</p>}
                <div className={styles.historyList}>
                    {sessions.map((session) => (
                        <button key={session.id} type="button" className={styles.historyItem}
                                title={session.title}
                                aria-current={!activeFeature && activeSessionId === session.id ? "page" : undefined}
                                onClick={() => onSelect(session.id)}>
                            <span>{session.title}</span>
                        </button>
                    ))}
                </div>
            </section>
        </>
    );
}
