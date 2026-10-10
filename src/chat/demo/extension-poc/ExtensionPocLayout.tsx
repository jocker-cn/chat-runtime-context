import {useCallback, useRef, useState} from "react";
import {ExtensionPocPage} from "./ExtensionPocPage";
import {ExtensionPocSidebar} from "./ExtensionPocSidebar";
import {AgentSettings, McpSettings, PluginSettings, SkillSettings} from "./ExtensionSettings";
import type {ExtensionKind} from "./extensionModel";
import styles from "./ExtensionPocPage.module.css";
import "../../../theme/tokens.css";

export function ExtensionPocLayout() {
    const [sessionId, setSessionId] = useState<string>();
    const [activeFeature, setActiveFeature] = useState<ExtensionKind | null>(null);
    const [skillVisited, setSkillVisited] = useState(false);
    const settingsDirty = useRef(false);
    const onDirtyChange = useCallback((dirty: boolean) => { settingsDirty.current = dirty; }, []);
    const canNavigate = useCallback(() => {
        if (!settingsDirty.current) return true;
        if (!window.confirm("尚有未保存的配置修改，确定放弃吗？")) return false;
        settingsDirty.current = false;
        return true;
    }, []);
    const openChat = useCallback((id: string) => {
        if (!canNavigate()) return;
        setSessionId(id);
        setActiveFeature(null);
    }, [canNavigate]);
    const openFeature = (kind: ExtensionKind) => {
        if (kind === activeFeature || !canNavigate()) return;
        setActiveFeature(kind);
        if (kind === "skill") setSkillVisited(true);
    };
    return (
        <main className={styles.page}>
            <ExtensionPocSidebar activeSessionId={sessionId} activeFeature={activeFeature}
                                 onSelectSession={openChat} onSelectFeature={openFeature} canNavigate={canNavigate}/>
            <div className={styles.contentArea}>
                <div hidden={activeFeature !== null} className={styles.conversationArea}>
                    {sessionId && <ExtensionPocPage key={sessionId} sessionId={sessionId}/>}
                </div>
                <section className={styles.settingsPage} aria-label="扩展管理页面" hidden={activeFeature === null}>
                    {skillVisited && <div className={styles.skillPage} hidden={activeFeature !== "skill"}><SkillSettings/></div>}
                    {activeFeature === "agent" && <AgentSettings onDirtyChange={onDirtyChange}/>}
                    {activeFeature === "mcp" && <McpSettings onDirtyChange={onDirtyChange}/>}
                    {activeFeature === "plugin" && <PluginSettings onDirtyChange={onDirtyChange}/>}
                </section>
            </div>
        </main>
    );
}
