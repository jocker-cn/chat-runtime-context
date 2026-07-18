import { useEffect, useMemo, useState } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import { runtimeScenarios } from "../data/scenarios";
import type { ScenarioId } from "../data/model";
import { explainScenarioEvent } from "../lib/explainScenarioEvent";
import {
  projectSimulatorGraph,
  type RuntimeFlowGraph,
} from "../lib/projectSimulatorGraph";
import { replayScenario } from "../lib/simulator";
import { RuntimeNode } from "./RuntimeNode";

const nodeTypes: NodeTypes = {
  runtimeInstance: RuntimeNode,
};

interface RuntimeSimulatorProps {
  scenarioId: ScenarioId;
  initialEventIndex: number;
  onScenarioChange(id: ScenarioId): void;
}

export function RuntimeSimulator({
  scenarioId,
  initialEventIndex,
  onScenarioChange,
}: RuntimeSimulatorProps) {
  const scenario = runtimeScenarios.find((item) => item.id === scenarioId) ?? runtimeScenarios[0]!;
  const [eventIndex, setEventIndex] = useState(() =>
    clampEventIndex(initialEventIndex, scenario.events.length),
  );
  const [playing, setPlaying] = useState(false);
  const boundedIndex = clampEventIndex(eventIndex, scenario.events.length);
  const state = useMemo(
    () => replayScenario(scenario, boundedIndex),
    [boundedIndex, scenario],
  );
  const graph = useMemo(() => projectSimulatorGraph(state), [state]);
  const currentEvent = boundedIndex >= 0 ? scenario.events[boundedIndex] : undefined;
  const explanation = useMemo(
    () => explainScenarioEvent(currentEvent, state),
    [currentEvent, state],
  );

  useEffect(() => {
    setPlaying(false);
    setEventIndex(clampEventIndex(initialEventIndex, scenario.events.length));
  }, [initialEventIndex, scenario.id, scenario.events.length]);

  useEffect(() => {
    if (!playing) return;
    if (boundedIndex >= scenario.events.length - 1) {
      setPlaying(false);
      return;
    }

    const timeoutId = window.setTimeout(
      () => setEventIndex((index) => Math.min(scenario.events.length - 1, index + 1)),
      1_650,
    );
    return () => window.clearTimeout(timeoutId);
  }, [boundedIndex, playing, scenario.events.length]);

  const start = () => {
    if (boundedIndex >= scenario.events.length - 1) {
      setEventIndex(0);
    } else if (boundedIndex < 0) {
      setEventIndex(0);
    }
    setPlaying(true);
  };

  const selectScenario = (id: ScenarioId) => {
    setPlaying(false);
    setEventIndex(-1);
    onScenarioChange(id);
  };

  const selectEvent = (index: number) => {
    setPlaying(false);
    setEventIndex(clampEventIndex(index, scenario.events.length));
  };

  return (
    <div className="simulator-layout">
      <section className="simulator-main">
        <div className="simulator-toolbar">
          <label>
            <span>演示场景</span>
            <select value={scenario.id} onChange={(event) => selectScenario(event.target.value as ScenarioId)}>
              {runtimeScenarios.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
          <div className="simulator-actions">
            <button type="button" onClick={() => selectEvent(boundedIndex - 1)} disabled={boundedIndex < 0}>
              上一步
            </button>
            <button type="button" className="primary-button" onClick={playing ? () => setPlaying(false) : start}>
              {playing ? "暂停" : boundedIndex < 0 ? "播放演进" : "继续播放"}
            </button>
            <button type="button" onClick={() => selectEvent(boundedIndex + 1)} disabled={boundedIndex >= scenario.events.length - 1}>
              下一步
            </button>
            <button type="button" onClick={() => selectEvent(-1)}>
              重置
            </button>
          </div>
        </div>

        <div className="simulator-summary" aria-live="polite">
          <div>
            <span>当前步骤</span>
            <strong>{currentEvent?.label ?? "等待发送"}</strong>
          </div>
          <p>{currentEvent?.description ?? scenario.summary}</p>
          <div className="active-components" aria-label="当前活动组件">
            {state.activeComponentIds.map((id) => <code key={id}>{id}</code>)}
          </div>
        </div>

        <RuntimeFlowCanvas graph={graph} />
      </section>

      <div className="simulator-sidebar">
        <ScenarioEventDetails explanation={explanation} />
        <aside className="timeline-panel" aria-label="生命周期时间线">
          <div className="timeline-panel__header">
            <span>事件时间线</span>
            <strong>{Math.max(0, boundedIndex + 1)} / {scenario.events.length}</strong>
          </div>
          <ol>
            {scenario.events.map((event, index) => (
              <li key={event.id} data-state={index === boundedIndex ? "current" : index < boundedIndex ? "done" : "pending"}>
                <button type="button" onClick={() => selectEvent(index)}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{event.label}</strong>
                    <small>{event.type}</small>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function ScenarioEventDetails({
  explanation,
}: {
  explanation: ReturnType<typeof explainScenarioEvent>;
}) {
  return (
    <section className="scenario-event-details" aria-label="当前事件的数据与设计说明">
      <header>
        <span>触发节点</span>
        <strong>{explanation.trigger}</strong>
      </header>
      <div className="scenario-event-details__grid">
        <section>
          <h2>输入与事件内容</h2>
          <dl>
            {explanation.payload.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd><code>{item.value}</code><span>{item.meaning}</span></dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2>创建或更新什么</h2>
          <div className="scenario-state-changes">
            {explanation.changes.map((change) => (
              <article key={change.title}>
                <strong>{change.title}</strong>
                <ul>{change.fields.map((item) => <li key={item}>{item}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>
        <section>
          <h2>为什么需要这样做</h2>
          <ul className="scenario-reasons">
            {explanation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>
      </div>
    </section>
  );
}

function RuntimeFlowCanvas({ graph }: { graph: RuntimeFlowGraph }) {
  const height = getCanvasHeight(graph);

  return (
    <div
      className="simulator-canvas"
      style={{ height }}
      role="region"
      aria-label="Runtime 动态实例图"
    >
      <ReactFlowProvider>
        <DynamicRuntimeFlow graph={graph} />
      </ReactFlowProvider>
    </div>
  );
}

function DynamicRuntimeFlow({ graph }: { graph: RuntimeFlowGraph }) {
  const flow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const nodeSignature = graph.nodes.map((node) => node.id).join("|");

  useEffect(() => {
    if (!nodesInitialized) return;

    const frameId = window.requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.12, maxZoom: 1.18, duration: 420 });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [flow, nodeSignature, nodesInitialized]);

  return (
    <ReactFlow
      nodes={graph.nodes}
      edges={graph.edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1.18 }}
      defaultEdgeOptions={{ animated: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.5}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
    </ReactFlow>
  );
}

function getCanvasHeight(graph: RuntimeFlowGraph) {
  const kinds = new Set(graph.nodes.map((node) => node.data.kind));
  if (kinds.has("card")) return 860;
  if (kinds.has("source-message")) return 700;
  if (kinds.has("branch")) return 560;
  if (kinds.has("turn") || kinds.has("input")) return 410;
  return 290;
}

function clampEventIndex(index: number, eventCount: number) {
  return Math.max(-1, Math.min(eventCount - 1, index));
}
