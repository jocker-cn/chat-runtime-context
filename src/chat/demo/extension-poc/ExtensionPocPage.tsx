import {useEffect, useMemo, useRef, useState} from "react";
import {
    ChatRuntimeView, ChatTurnNavigationRail, useChatTurnNavigation,
    createChatExtensionStore, findChatMessageById,
    type ChatViewportAdapter, type FrameCardProps,
} from "../../../core";
import {demoRenderer, type DemoChatExtensions} from "../demoRenderer";
import {getDemoMessageText, type DemoMessage} from "../demoMessage";
import {createExtensionPocRuntime, readChatHistory, type ChatSubmission} from "./extensionPocRuntime";
import {chatData} from "./chatHistory";
import {ExtensionComposer} from "./ExtensionComposer";
import styles from "./ExtensionPocPage.module.css";
import {PendoChatSidecar} from "./analytics/sidecars";

/** A single session page. History, Runtime and message interactions stay here. */
export function ExtensionPocPage({sessionId}: { sessionId: string }) {
    const [session, setSession] = useState<{ id: string; title: string; messages: DemoMessage[] }>();
    const history = session?.id === sessionId ? session.messages : undefined;
    const title = session?.id === sessionId ? session.title : "";
    const [historyError, setHistoryError] = useState("");
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let active = true;
        setHistoryError("");
        void Promise.all([chatData.getSession(sessionId), chatData.getHistory(sessionId)]).then(([metadata, messages]) => {
            if (!active) return;
            setSession({...metadata, messages});
        }).catch((reason: unknown) => {
            if (active) setHistoryError(String(reason));
        });
        return () => {
            active = false;
        };
    }, [sessionId, reload]);

    const controller = useMemo(() => createExtensionPocRuntime({
        threadId: sessionId,
        websocketUrl: import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot",
        history,
    }), [sessionId, history]);
    const lifecycle = useRef(0);
    const currentController = useRef(controller);
    useEffect(() => {
        currentController.current = controller;
        const version = ++lifecycle.current;
        const save = () => {
            // Never overwrite stored history with the empty, not-yet-loaded Runtime.
            if (!history) return;
            void chatData.saveHistory(sessionId, readChatHistory(controller.runtime))
                .catch((reason: unknown) => console.error("Failed to save chat history.", reason));
        };
        const unsubscribe = controller.runtime.subscribe(() => {
            const status = controller.runtime.getSnapshot().status;
            if (status !== "running" && status !== "closed") save();
        });
        return () => {
            unsubscribe();
            save();
            queueMicrotask(() => {
                if (currentController.current !== controller || lifecycle.current === version) void controller.dispose();
            });
        };
    }, [controller, history, sessionId]);

    const [secondaryEnabled, setSecondaryEnabled] = useState(true);
    const [reference, setReference] = useState<{ id: string; text: string }>();
    const [formError, setFormError] = useState("");
    const viewportRef = useRef<HTMLDivElement>(null);
    const viewportAdapter = useMemo(() => createSessionViewportAdapter(() => viewportRef.current), []);
    const navigation = useChatTurnNavigation({
        runtime: controller.runtime, viewportAdapter, getPreview: getNavigationPreview,
    });
    useEffect(() => {
        controller.setSecondaryAgentEnabled(secondaryEnabled);
    }, [controller, secondaryEnabled]);
    const extensions = useMemo<DemoChatExtensions>(() => Object.assign(createChatExtensionStore(), {
        allowMessageEditing: true,
        responseTraces: controller.responseTraces,
        resolveResponseTrace: controller.resolveResponseTrace,
        resolveMessageById: (id: string) => findChatMessageById(controller.runtime, id),
        chatFromHere: (message: DemoMessage) => setReference({id: message.id, text: getDemoMessageText(message)}),
        navigateToMessage: (id: string) => {
            setFormError(revealReferencedMessage(viewportRef.current, id) ? "" : "原消息已删除或当前分支不可见。");
        },
    }), [controller]);
    const sendMessage = (message: ChatSubmission) => {
        controller.queue.enqueue(message);
        setReference(undefined);
        setFormError("");
        if (title !== "新对话") return;
        const characters = Array.from(message.text.trim().replace(/\s+/g, " "));
        const name = characters.slice(0, 24).join("") + (characters.length > 24 ? "…" : "");
        setSession((current) => current?.id === sessionId ? {...current, title: name} : current);
        void chatData.renameSession(sessionId, name).catch((reason: unknown) => setFormError(String(reason)));
    };

    if (!history) return <div className={styles.chatEmpty} aria-busy={!historyError}>
        {historyError ? <p role="alert">{historyError}
                <button type="button" onClick={() => setReload((value) => value + 1)}>重试加载</button>
            </p>
            : <p role="status">正在加载聊天记录…</p>}
    </div>;

    return (
        <section className={styles.chatColumn} aria-label={`聊天：${title}`}>
            <PendoChatSidecar runtime={controller.runtime} queue={controller.queue} secondaryEnabled={secondaryEnabled}/>
            <header className={styles.chatHeader}>
                <div>
                    <span className={styles.overline}>COMPARE AGENT RUNTIME</span>
                    <h2>{title}</h2>
                    <p>Agent A 始终运行；Agent B 可按轮次关闭，不重建会话。</p>
                </div>
                <label className={styles.agentToggle}>
                    <input
                        type="checkbox"
                        checked={secondaryEnabled}
                        onChange={(event) => setSecondaryEnabled(event.target.checked)}
                    />
                    <span>Agent B {secondaryEnabled ? "开启" : "关闭"}</span>
                </label>
            </header>

            <div className={styles.chatBody}>
                <ChatTurnNavigationRail navigation={navigation} ariaLabel="对话轮次导航"
                                        className={styles.navigationRail} markerClassName={styles.navigationMarker}
                                        tooltipClassName={styles.navigationTooltip}/>
                <div ref={viewportRef} className={styles.chatViewport}>
                    <ChatRuntimeView runtime={controller.runtime} renderer={demoRenderer} extensions={extensions}
                                     renderInput={renderDemoInput}
                                     classNames={{root: styles.runtime, branch: styles.branch}}
                                     empty={<p className={styles.chatEmpty}>从下方输入框开始对话。</p>}
                                     loadingIndicator={<p className={styles.loading}>正在生成回复…</p>}/>
                </div>
            </div>

            <div className={styles.composerArea}>
                <p className={styles.pocNote}>
                    扩展配置和 / 调用目前仅在 UI 层生成 invocation；实际 Agent 指令、Skill、MCP、Plugin 尚未发送给 BE 执行。
                </p>
                {formError && <p className={styles.formError} role="alert">{formError}</p>}
                <ExtensionComposer
                    reference={reference}
                    onClearReference={() => setReference(undefined)}
                    onNavigateReference={(id) => extensions.navigateToMessage?.(id)}
                    onSend={sendMessage}
                />
            </div>
        </section>
    );
}

function getNavigationPreview({inputMessage, selectedMessages}: {
    inputMessage: DemoMessage;
    selectedMessages?: readonly DemoMessage[];
}) {
    const title = getDemoMessageText(inputMessage);
    const response = selectedMessages?.find((message) => message.role === "assistant");
    return {title, body: response ? getDemoMessageText(response) : undefined, ariaLabel: `预览：${title}`};
}

function createSessionViewportAdapter(getViewport: () => HTMLElement | null): ChatViewportAdapter {
    return {
        getScrollElement: getViewport,
        revealItem: (item, options) => {
            findMessageElement(getViewport(), "data-turn-id", item.turnId)?.scrollIntoView({
                behavior: options.behavior === "instant" ? "auto" : options.behavior,
                block: options.align, inline: "nearest",
            });
        },
    };
}

function revealReferencedMessage(viewport: HTMLElement | null, messageId: string) {
    const element = findMessageElement(viewport, "data-message-id", messageId);
    if (!element) return false;
    element.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"});
    element.focus({preventScroll: true});
    return true;
}

function findMessageElement(viewport: HTMLElement | null, attribute: string, value: string) {
    // Comparing values avoids turning arbitrary message IDs into CSS selectors.
    return Array.from(viewport?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])
        .find((element) => element.getAttribute(attribute) === value);
}

function renderDemoInput(props: FrameCardProps<DemoMessage>) {
    const Card = demoRenderer.getCard(props.message, props.context);
    return <Card {...props}/>;
}
