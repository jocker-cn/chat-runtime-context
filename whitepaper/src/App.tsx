import { useMemo, useState } from "react";
import { ComponentExpandedView } from "./components/ComponentExpandedView";
import { ContainmentDiagram } from "./components/ContainmentDiagram";
import { IntegrationGuide } from "./components/IntegrationGuide";
import { RuntimeSimulator } from "./components/RuntimeSimulator";
import {
  getScene,
  getSceneBreadcrumbs,
  searchableArchitecture,
} from "./data/architecture";
import {
  getContainmentScene,
  type ContainmentTarget,
} from "./data/containment";
import type {
  ScenarioId,
  WhitepaperSection,
} from "./data/model";
import {
  navigateToArchitecture,
  navigateToIntegration,
  navigateToLifecycle,
  navigateToSection,
  useWhitepaperRoute,
} from "./lib/hashRoute";

const sectionLabels: Record<WhitepaperSection, string> = {
  architecture: "架构视图",
  lifecycle: "生命周期",
  integration: "接入指南",
};

export function App() {
  const route = useWhitepaperRoute();
  const [searchQuery, setSearchQuery] = useState("");
  const section = route.section;

  return (
    <div className="whitepaper-app">
      <a className="skip-link" href="#whitepaper-content">跳到主要内容</a>
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">CR</span>
          <div>
            <strong>Chat Runtime Core</strong>
            <small>Interactive Architecture Whitepaper</small>
          </div>
        </div>

        <nav className="section-navigation" aria-label="白皮书章节">
          {(Object.keys(sectionLabels) as WhitepaperSection[]).map((item) => (
            <button
              type="button"
              key={item}
              data-active={section === item ? "true" : undefined}
              onClick={() => navigateToSection(item)}
            >
              {sectionLabels[item]}
            </button>
          ))}
        </nav>

        <SearchBox query={searchQuery} onQueryChange={setSearchQuery} />
      </header>

      <div className="app-body">
        <main id="whitepaper-content" className="app-content">
          {route.section === "architecture" ? (
            <ArchitecturePage sceneId={route.sceneId} nodeId={route.nodeId} />
          ) : null}
          {route.section === "lifecycle" ? (
            <LifecyclePage scenarioId={route.scenarioId} eventIndex={route.eventIndex} />
          ) : null}
          {route.section === "integration" ? (
            <IntegrationPage stepId={route.stepId} />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function ArchitecturePage({ sceneId, nodeId }: { sceneId: string; nodeId?: string }) {
  const scene = getScene(sceneId);
  const selectedNode = nodeId
    ? scene.nodes.find((node) => node.id === nodeId)
    : undefined;
  const breadcrumbs = getSceneBreadcrumbs(scene.id);
  const parentScene = scene.parentId ? getScene(scene.parentId) : undefined;
  const activate = (target: ContainmentTarget) => {
    const targetScene = getScene(target.sceneId);
    const targetNode = targetScene.nodes.find((node) => node.id === target.nodeId);

    if (targetNode?.childSceneId) {
      navigateToArchitecture(targetNode.childSceneId);
      return;
    }

    navigateToArchitecture(target.sceneId, target.nodeId);
  };

  return (
    <div className="page architecture-page">
      <header className="page-heading">
        <nav className="breadcrumbs" aria-label="架构层级">
          {breadcrumbs.map((item, index) => (
            <span key={item.id}>
              {index > 0 ? <i aria-hidden="true">/</i> : null}
              <button type="button" onClick={() => navigateToArchitecture(item.id)}>{item.title}</button>
            </span>
          ))}
          {selectedNode ? (
            <span>
              <i aria-hidden="true">/</i>
              <strong>{selectedNode.title}</strong>
            </span>
          ) : null}
        </nav>
        <span className="section-kicker">{scene.eyebrow}</span>
        <h1>{scene.title}</h1>
        <p>{scene.description}</p>
      </header>

      <div className="architecture-workbench">
        {selectedNode ? (
          <ComponentExpandedView
            node={selectedNode}
            onBack={() => navigateToArchitecture(scene.id)}
          />
        ) : (
          <ContainmentDiagram
            key={scene.id}
            scene={getContainmentScene(scene.id)}
            onActivate={activate}
            onBack={parentScene ? () => navigateToArchitecture(parentScene.id) : undefined}
            backLabel={parentScene ? `返回 ${parentScene.title}` : undefined}
          />
        )}
      </div>
    </div>
  );
}

function LifecyclePage({ scenarioId, eventIndex }: { scenarioId: ScenarioId; eventIndex: number }) {
  return (
    <div className="page lifecycle-page">
      <header className="page-heading page-heading--compact">
        <span className="section-kicker">Runtime Scenario Simulator</span>
        <h1>一次消息如何改变 Core 结构</h1>
        <p>静态组件定义保持不变；Turn、Branch、Message 和 Card 是随事件动态出现的运行实例。</p>
      </header>
      <RuntimeSimulator
        scenarioId={scenarioId}
        initialEventIndex={eventIndex}
        onScenarioChange={(id) => navigateToLifecycle(id)}
      />
    </div>
  );
}

function IntegrationPage({ stepId }: { stepId?: string }) {
  return (
    <div className="page integration-page">
      <header className="page-heading page-heading--compact">
        <span className="section-kicker">From Agent to Chat List</span>
        <h1>把 Runtime 接入业务</h1>
        <p>基础接入只需要 Agent、Source、Runtime、Renderer 和 View；其他能力按需组合。</p>
      </header>
      <IntegrationGuide
        selectedStepId={stepId}
        onSelect={(step) => navigateToIntegration(step.id)}
        onOpenArchitecture={(step) => navigateToArchitecture(step.sceneId, step.nodeId)}
      />
    </div>
  );
}

function SearchBox({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange(value: string): void;
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      normalized
        ? searchableArchitecture
            .filter((item) =>
              `${item.sceneTitle} ${item.nodeTitle} ${item.summary}`
                .toLocaleLowerCase()
                .includes(normalized),
            )
            .slice(0, 8)
        : [],
    [normalized],
  );

  return (
    <div className="search-box">
      <label htmlFor="whitepaper-search">搜索组件、职责或扩展点</label>
      <input
        id="whitepaper-search"
        type="search"
        value={query}
        placeholder="搜索 Runtime、FrameSlot…"
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {normalized ? (
        <div className="search-results">
          {results.length ? results.map((item) => (
            <button
              type="button"
              key={`${item.sceneId}:${item.nodeId}`}
              onClick={() => {
                navigateToArchitecture(item.sceneId, item.nodeId);
                onQueryChange("");
              }}
            >
              <strong>{item.nodeTitle}</strong>
              <span>{item.sceneTitle}</span>
              <small>{item.summary}</small>
            </button>
          )) : <p>没有匹配内容</p>}
        </div>
      ) : null}
    </div>
  );
}
