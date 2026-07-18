import type { ArchitectureNodeDefinition } from "../data/model";
import { ApiFieldTable } from "./ApiFieldTable";
import { CodeBlock } from "./CodeBlock";

export function ComponentExpandedView({
  node,
  onBack,
}: {
  node: ArchitectureNodeDefinition;
  onBack(): void;
}) {
  return (
    <section
      className={`component-expanded-canvas component-expanded-canvas--${node.ownership}`}
      aria-label={`${node.title} 组件详情`}
    >
      <button type="button" className="architecture-back-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        返回当前结构
      </button>
      <header className="component-expanded__header">
        <div>
          <span>{node.kind}</span>
          <span>{node.visibility.replaceAll("-", " ")}</span>
        </div>
        <h2>{node.title}</h2>
        <p>{node.summary}</p>
      </header>

      <div className="component-expanded__structure">
        <section className="component-info-block component-info-block--purpose">
          <h3>解决的问题与设计目的</h3>
          <p>{node.purpose}</p>
        </section>

        <section className="component-info-block">
          <h3>核心职责</h3>
          <ul>{node.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        {node.lifecycle?.length ? (
          <section className="component-info-block">
            <h3>生命周期</h3>
            <ol>{node.lifecycle.map((item) => <li key={item}>{item}</li>)}</ol>
          </section>
        ) : null}

        {node.inputs?.length ? (
          <section className="component-info-block">
            <h3>输入</h3>
            <ul>{node.inputs.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        ) : null}

        {node.outputs?.length ? (
          <section className="component-info-block">
            <h3>输出</h3>
            <ul>{node.outputs.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        ) : null}

        {node.extensionGuidance || node.integration ? (
          <section className="component-info-block component-info-block--extension">
            <h3>接入与扩展</h3>
            {node.extensionGuidance ? <p>{node.extensionGuidance}</p> : null}
            {node.integration ? <p>{node.integration}</p> : null}
          </section>
        ) : null}

        {node.fields?.length ? (
          <section className="component-info-block component-info-block--wide">
            <h3>创建对象与字段</h3>
            <ApiFieldTable fields={node.fields} />
          </section>
        ) : null}

        {node.codeExample ? (
          <section className="component-info-block component-info-block--wide">
            <h3>最小示例</h3>
            <CodeBlock code={node.codeExample} />
          </section>
        ) : null}

        <section className="component-info-block component-info-block--source">
          <h3>对应源码</h3>
          <ul>
            {node.sourceRefs.map((item) => (
              <li key={`${item.label}:${item.path}`}>
                <strong>{item.label}</strong>
                <code>{item.path}</code>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
