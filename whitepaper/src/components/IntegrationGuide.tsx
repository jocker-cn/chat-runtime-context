import { integrationSteps, quickStartCode } from "../data/integration";
import type { IntegrationStep } from "../data/model";
import { CodeBlock } from "./CodeBlock";

interface IntegrationGuideProps {
  selectedStepId?: string;
  onSelect(step: IntegrationStep): void;
  onOpenArchitecture(step: IntegrationStep): void;
}

export function IntegrationGuide({
  selectedStepId,
  onSelect,
  onOpenArchitecture,
}: IntegrationGuideProps) {
  const selected = integrationSteps.find((step) => step.id === selectedStepId) ?? integrationSteps[0]!;

  return (
    <div className="integration-layout">
      <aside className="integration-steps" aria-label="接入步骤">
        <div className="integration-steps__intro">
          <span>Quick Start</span>
          <strong>六步完成基础接入</strong>
          <p>先跑通最短路径，再按业务需要接入 Compare、Queue、History、Error 和 Extensions。</p>
        </div>
        <ol>
          {integrationSteps.map((step, index) => (
            <li key={step.id} data-selected={step.id === selected.id ? "true" : undefined}>
              <button type="button" onClick={() => onSelect(step)}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.owner}</small>
                </div>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="integration-content">
        <header>
          <span className="section-kicker">{selected.owner}负责</span>
          <h2>{selected.title}</h2>
          <p>{selected.summary}</p>
          <button type="button" className="secondary-button" onClick={() => onOpenArchitecture(selected)}>
            在架构图中查看
          </button>
        </header>

        {selected.code ? <CodeBlock code={selected.code} /> : null}

        <section className="integration-checks">
          <h3>接入检查</h3>
          <ul>{selected.checks.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>

        <details className="full-example">
          <summary>查看完整最小示例</summary>
          <CodeBlock code={quickStartCode} />
        </details>
      </main>
    </div>
  );
}
