import type {
  ContainmentLayerDefinition,
  ContainmentSceneDefinition,
  ContainmentTarget,
} from "../data/containment";
import { getScene } from "../data/architecture";

interface ContainmentDiagramProps {
  scene: ContainmentSceneDefinition;
  onActivate(target: ContainmentTarget): void;
  onBack?(): void;
  backLabel?: string;
}

export function ContainmentDiagram({
  scene,
  onActivate,
  onBack,
  backLabel = "返回上层结构",
}: ContainmentDiagramProps) {
  return (
    <section
      className="containment-canvas"
      aria-label={`${scene.root.title} 组件包含结构`}
    >
      <div className="containment-canvas__toolbar">
        {onBack ? (
          <button type="button" className="architecture-back-button" onClick={onBack}>
            <span aria-hidden="true">←</span>
            {backLabel}
          </button>
        ) : <span />}
        <div className="containment-canvas__legend" aria-label="所有权图例">
          <span data-owner="core">Core</span>
          <span data-owner="user">用户组件</span>
          <span data-owner="ag-ui">AG-UI</span>
          <span data-owner="extension">扩展点</span>
          <span data-owner="internal">内部实现</span>
        </div>
      </div>

      <section className="containment-rationale" aria-label="当前结构设计说明">
        <header>
          <span>Why this structure</span>
          <strong>这一层为什么这样设计</strong>
        </header>
        <div className="containment-rationale__body">
          <div>
            <span>需要解决的问题</span>
            <p>{scene.problem}</p>
          </div>
          <div>
            <span>结构选择</span>
            <p>{scene.designReason}</p>
          </div>
          <ul>
            {scene.principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
        </div>
      </section>

      <ContainmentLayer
        definition={scene.root}
        depth={0}
        onActivate={onActivate}
      />
    </section>
  );
}

function ContainmentLayer({
  definition,
  depth,
  onActivate,
}: {
  definition: ContainmentLayerDefinition;
  depth: number;
  onActivate(target: ContainmentTarget): void;
}) {
  const interactive = Boolean(definition.target);
  const activate = () => {
    if (definition.target) onActivate(definition.target);
  };

  return (
    <article
      className={`containment-layer containment-layer--${definition.ownership}`}
      data-depth={depth}
      data-size={definition.size ?? "section"}
      data-interactive={interactive ? "true" : undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (interactive) activate();
      }}
    >
      <header className="containment-layer__header">
        {interactive ? (
          <button
            type="button"
            className="containment-layer__trigger"
            onClick={(event) => {
              event.stopPropagation();
              activate();
            }}
          >
            <LayerHeading definition={definition} />
          </button>
        ) : (
          <div className="containment-layer__heading">
            <LayerHeading definition={definition} />
          </div>
        )}
        {definition.relation ? (
          <span className="containment-layer__relation">
            {definition.relation}
          </span>
        ) : null}
      </header>

      {definition.children?.length ? (
        <div
          className="containment-layer__children"
          data-layout={definition.layout ?? "stack"}
        >
          {definition.children.map((child) => (
            <ContainmentLayer
              key={child.id}
              definition={child}
              depth={depth + 1}
              onActivate={onActivate}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function LayerHeading({
  definition,
}: {
  definition: ContainmentLayerDefinition;
}) {
  const targetNode = definition.target
    ? getScene(definition.target.sceneId).nodes.find(
        (node) => node.id === definition.target?.nodeId,
      )
    : undefined;
  const rationale =
    definition.rationale ??
    targetNode?.purpose ??
    (definition.children?.length
      ? `把 ${definition.children.map((child) => child.title).join("、")} 收敛在同一边界中，避免它们的状态和职责扩散到外层。`
      : definition.relation
        ? `明确它通过“${definition.relation}”与上层协作，避免把引用、数据或方法误认为新的生命周期所有者。`
        : `为 ${definition.kind} 提供单一、可定位的责任边界。`);

  return (
    <>
      <span className="containment-layer__meta">
        <i>{definition.kind}</i>
        <i>{definition.visibility.replaceAll("-", " ")}</i>
      </span>
      <strong>{definition.title}</strong>
      <p>{definition.summary}</p>
      <span className="containment-layer__rationale">
        <i>为什么需要</i>
        <span>{rationale}</span>
      </span>
    </>
  );
}
