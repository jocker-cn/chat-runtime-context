import { useEffect, useMemo, useState } from "react";
import {
  CapabilityRegistry,
  ChatRuntimeView,
  SubmissionQueueProvider,
  createCapabilityDecorators,
  createChatExtensionStore,
  type CapabilityCondition,
  useQueuedSubmissions,
  useSubmissionQueue,
} from "./core";
import {
  DEMO_COMPARE_SOURCE_BRANCH_IDS,
  createBeComparisonRuntime,
  createBeSingleRuntime,
} from "./chat/demo/demoRuntime";
import {
  demoRenderer,
  type DemoChatExtensions,
} from "./chat/demo/demoRenderer";
import type { FrameCardProps } from "./core";
import type {
  BeComparisonRuntimeController,
  BeSingleRuntimeController,
  DemoMessage,
  DemoSubmission,
} from "./chat/demo/demoRuntime";
import styles from "./App.module.css";
import { AgUiStatusDemoPage } from "./chat/demo/AgUiStatusDemoPage";
import { SseDemoPage } from "./chat/demo/SseDemoPage";

type DemoMarket = "cn" | "sg" | "us";

interface FeeResult {
  strategy: string;
  fee: number;
  chain: string[];
}

interface CalculationResult {
  value: number;
  chain: string[];
}

interface MarketBannerProps {
  condition: CapabilityCondition;
  strategy: string;
}

const capabilityDemoRegistry = new CapabilityRegistry();
const {
  RegisterFunction,
  RegisterComponent: RegisterDemoComponent,
} = createCapabilityDecorators(capabilityDemoRegistry);


class CapabilityDemoDefinitions {

  @RegisterFunction({
    name: "base-rate",
    market: "cn",
    version: "2.1.0",
  })
  static baseRateCnExact(amount: number): CalculationResult {
    return { value: amount * 0.04, chain: ["base-rate[market-exact]"] };
  }

  @RegisterFunction({
    name: "base-rate",
    market: "cn",
    versionRange: ">=2 <3",
  })
  static baseRateCnV2(amount: number): CalculationResult {
    return { value: amount * 0.05, chain: ["base-rate[market-range]"] };
  }

  @RegisterFunction({ name: "base-rate", fallback: true })
  static baseRateDefault(amount: number): CalculationResult {
    return { value: amount * 0.07, chain: ["base-rate[global-fallback]"] };
  }

  @RegisterFunction({
    name: "market-adjustment",
    market: "cn",
    version: "2.1.0",
  })
  static adjustmentCnExact(
    amount: number,
    condition: CapabilityCondition,
  ): CalculationResult {
    return adjustFromBase(amount, condition, 1.1, "market-exact");
  }

  @RegisterFunction({
    name: "market-adjustment",
    market: "cn",
    versionRange: ">=2 <3",
  })
  static adjustmentCnV2(
    amount: number,
    condition: CapabilityCondition,
  ): CalculationResult {
    return adjustFromBase(amount, condition, 1.2, "market-range");
  }

  @RegisterFunction({ name: "market-adjustment", fallback: true })
  static adjustmentDefault(
    amount: number,
    condition: CapabilityCondition,
  ): CalculationResult {
    return adjustFromBase(amount, condition, 1.3, "global-fallback");
  }

  @RegisterFunction({
    name: "calculate-fee2",
    market: "cn",
    version: "2.1.0",
  })
  static calculateCnExact2(
    amount: number,
    condition: CapabilityCondition,
  ): FeeResult {
    return calculateFromAdjustment("CN / exact 2.1.0", amount, condition);
  }

  @RegisterFunction({
    name: "calculate-fee",
    market: "cn",
    version: "2.1.0",
  })
  static calculateCnExact(
    amount: number,
    condition: CapabilityCondition,
  ): FeeResult {
    return calculateFromAdjustment("CN / exact 2.1.0", amount, condition);
  }

  @RegisterFunction({
    name: "calculate-fee",
    market: "cn",
    versionRange: ">=2 <3",
  })
  static calculateCnV2(
    amount: number,
    condition: CapabilityCondition,
  ): FeeResult {
    return calculateFromAdjustment(
      "CN / versionRange >=2 <3",
      amount,
      condition,
    );
  }

  @RegisterFunction({ name: "calculate-fee", fallback: true })
  static calculateDefault(
    amount: number,
    condition: CapabilityCondition,
  ): FeeResult {
    return calculateFromAdjustment("global fallback", amount, condition);
  }

  @RegisterDemoComponent({
    name: "market-banner",
    market: "cn",
    version: "2.1.0",
  })
  static CnExactBanner({ condition, strategy }: MarketBannerProps) {
    return (
      <div className={styles.capabilityResult}>
        精确版本组件：{condition.market} / {condition.version} / {strategy}
      </div>
    );
  }

  @RegisterDemoComponent({
    name: "market-banner",
    market: "cn",
    versionRange: ">=2 <3",
  })
  static CnV2Banner({ condition, strategy }: MarketBannerProps) {
    return (
      <div className={styles.capabilityResult}>
        V2 范围组件：{condition.market} / {condition.version} / {strategy}
      </div>
    );
  }

  @RegisterDemoComponent({
    name: "market-banner",
    fallback: true,
    market: "*",
  })
  DefaultBanner({ condition, strategy }: MarketBannerProps) {
    return (
      <div className={styles.capabilityResult}>
        兜底组件：{condition.market} / {condition.version} / {strategy}
      </div>
    );
  }
}

void CapabilityDemoDefinitions;

function adjustFromBase(
  amount: number,
  condition: CapabilityCondition,
  multiplier: number,
  resolution: string,
): CalculationResult {
  const baseResult = capabilityDemoRegistry.getFunction<(value: number) => CalculationResult>("base-rate", condition)(amount);

  return {
    value: baseResult.value * multiplier,
    chain: [`market-adjustment[${resolution}]`, ...baseResult.chain],
  };
}

function calculateFromAdjustment(
  strategy: string,
  amount: number,
  condition: CapabilityCondition,
): FeeResult {
  const adjustedResult = capabilityDemoRegistry.getFunction<
    (value: number, currentCondition: CapabilityCondition) => CalculationResult
  >("market-adjustment", condition)(amount, condition);

  return {
    strategy,
    fee: adjustedResult.value,
    chain: ["calculate-fee", ...adjustedResult.chain],
  };
}

export function App() {
  if (window.location.pathname === "/ag-ui-status-demo") {
    return <AgUiStatusDemoPage />;
  }
  if (window.location.pathname === "/sse-demo") {
    return <SseDemoPage />;
  }
  const websocketUrl =
    import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
  const demos = useDemoRuntimeControllers(websocketUrl);
  if (!demos) {
    return <main className="app" aria-busy="true" />;
  }

  return <DemoChats websocketUrl={websocketUrl} demos={demos} />;
}

function DemoChats({
  websocketUrl,
  demos,
}: {
  websocketUrl: string;
  demos: {
    compareDemo: BeComparisonRuntimeController;
    singleDemo: BeSingleRuntimeController;
  };
}) {
  const { compareDemo, singleDemo } = demos;
  const compareRuntime = compareDemo.runtime;
  const singleRuntime = singleDemo.runtime;
  const compareExtensions = useMemo<DemoChatExtensions>(
    () =>
      Object.assign(createChatExtensionStore(), {
        retryUserError: compareDemo.retryUserError,
      }),
    [compareDemo],
  );
  const singleExtensions = useMemo<DemoChatExtensions>(
    () =>
      Object.assign(createChatExtensionStore(), {
        retryUserError: singleDemo.retryUserError,
      }),
    [singleDemo],
  );
  const [compareInput, setCompareInput] = useState("帮我总结一下当前发布风险。");
  const [singleInput, setSingleInput] = useState("帮我总结一下当前发布风险。");

  const sendCompare = () => {
    const trimmed = compareInput.trim();
    if (!trimmed) return;

    compareDemo.queue.enqueue({ text: trimmed });
    setCompareInput("");
  };

  const sendSingle = () => {
    const trimmed = singleInput.trim();
    if (!trimmed) return;

    singleDemo.queue.enqueue({ text: trimmed });
    setSingleInput("");
  };

  return (
    <main className="app">
      <section className="chat-shell">
        <header className="chat-header">
          <p className="eyebrow">AG-UI A/B Runtime</p>
          <h1>Two agents, one backend</h1>
          <p className="connection">Backend: {websocketUrl}</p>
        </header>
        <div className="composer">
          <input
            value={compareInput}
            onChange={(event) => setCompareInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendCompare();
              }
            }}
          />
          <button type="button" onClick={sendCompare}>
            Send
          </button>
          <button
            className="error-action"
            type="button"
            onClick={() =>
              void compareDemo.addUserError(
                DEMO_COMPARE_SOURCE_BRANCH_IDS.agentA,
              )
            }
          >
            User error
          </button>
          <button
            className="error-action"
            type="button"
            onClick={() =>
              void compareDemo.addAiError(
                DEMO_COMPARE_SOURCE_BRANCH_IDS.agentA,
              )
            }
          >
            AI error + tool
          </button>
          <button
            className="error-action"
            type="button"
            onClick={() =>
              compareDemo.socket.closeWithError(
                DEMO_COMPARE_SOURCE_BRANCH_IDS.agentA,
              )
            }
          >
            Socket close error
          </button>
          <RuntimeOperationButtons
            controller={compareDemo}
            sourceBranchId={DEMO_COMPARE_SOURCE_BRANCH_IDS.agentA}
          />
        </div>
        <SubmissionQueueProvider queue={compareDemo.queue}>
          <SubmissionQueuePanel onEdit={setCompareInput} />
        </SubmissionQueueProvider>
        <ChatRuntimeView
          runtime={compareRuntime}
          extensions={compareExtensions}
          renderer={demoRenderer}
          renderInput={renderDemoInput}
          classNames={{
            root: styles.runtime,
            branch: styles.branch,
            slot: styles.frameSlot,
          }}
          empty={<p className="empty">Send a message to create a turn.</p>}
          loadingIndicator={<DemoLoadingIndicator />}
        />
      </section>

      <section className="chat-shell">
        <header className="chat-header">
          <p className="eyebrow">AG-UI Single Runtime</p>
          <h1>One agent, one branch</h1>
          <p className="connection">Backend: {websocketUrl}</p>
        </header>
        <div className="composer">
          <input
            value={singleInput}
            onChange={(event) => setSingleInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendSingle();
              }
            }}
          />
          <button type="button" onClick={sendSingle}>
            Send
          </button>
          <button
            className="error-action"
            type="button"
            onClick={() => void singleDemo.addUserError()}
          >
            User error
          </button>
          <button
            className="error-action"
            type="button"
            onClick={() => void singleDemo.addAiError()}
          >
            AI error + tool
          </button>
          <button
            className="error-action"
            type="button"
            onClick={() => singleDemo.socket.closeWithError()}
          >
            Socket close error
          </button>
          <RuntimeOperationButtons controller={singleDemo} />
        </div>
        <SubmissionQueueProvider queue={singleDemo.queue}>
          <SubmissionQueuePanel onEdit={setSingleInput} />
        </SubmissionQueueProvider>
        <ChatRuntimeView
          runtime={singleRuntime}
          extensions={singleExtensions}
          renderer={demoRenderer}
          renderInput={renderDemoInput}
          classNames={{
            root: styles.runtime,
            branch: styles.singleBranch,
            slot: styles.frameSlot,
          }}
          empty={<p className="empty">Send a message to create a turn.</p>}
          loadingIndicator={<DemoLoadingIndicator />}
        />
      </section>

      <CapabilityRegistryDemo />
    </main>
  );
}

function RuntimeOperationButtons({
  controller,
  sourceBranchId,
}: {
  controller: BeComparisonRuntimeController | BeSingleRuntimeController;
  sourceBranchId?: string;
}) {
  return (
    <>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.removeUserMessage()}
      >
        Remove user message
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.removeUserError()}
      >
        Remove user error
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.removeAiError()}
      >
        Remove AI error response
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.removeAiResponse(sourceBranchId)}
      >
        Remove AI response
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.clearErrors()}
      >
        Clear tail errors
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.cancelActiveTurn()}
      >
        Cancel active turn
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() => void controller.deleteLastTurn()}
      >
        Delete last turn
      </button>
    </>
  );
}

function CapabilityRegistryDemo() {
  const [market, setMarket] = useState<DemoMarket>("cn");
  const [version, setVersion] = useState("2.1.0");
  const [amount, setAmount] = useState(100);
  const condition: CapabilityCondition = { market, version };
  const MarketBanner = capabilityDemoRegistry.getComponent<MarketBannerProps>(
    "market-banner",
    condition,
  );
  const feeResult = capabilityDemoRegistry.getFunction<
    (value: number, currentCondition: CapabilityCondition) => FeeResult
  >("calculate-fee", condition)(amount, condition);
  const functionCallChain = [
    "calculate-fee",
    "market-adjustment",
    "base-rate",
  ].map((name) =>
    capabilityDemoRegistry.explain(name, "function", condition),
  );
  const functionResolution = functionCallChain[0];
  const componentResolution = capabilityDemoRegistry.explain(
    "market-banner",
    "component",
    condition,
  );

  return (
    <section className={`chat-shell ${styles.capabilityDemo}`}>
      <header className="chat-header">
        <p className="eyebrow">Capability Registry</p>
        <h1>Market / Version 选择测试</h1>
        <p className="connection">
          version 优先于 versionRange，最后使用 fallback
        </p>
      </header>

      <div className={styles.capabilityControls}>
        <label>
          Market
          <select
            value={market}
            onChange={(event) => setMarket(event.target.value as DemoMarket)}
          >
            <option value="cn">cn</option>
            <option value="sg">sg</option>
            <option value="us">us</option>
          </select>
        </label>
        <label>
          Version
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="例如 2.1.0"
          />
        </label>
        <label>
          Amount
          <input
            type="number"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </label>
      </div>

      <div className={styles.capabilityPresets}>
        <button type="button" onClick={() => setVersion("2.1.0")}>
          测试精确版本
        </button>
        <button type="button" onClick={() => setVersion("2.5.0")}>
          测试版本范围
        </button>
        <button
          type="button"
          onClick={() => {
            setMarket("sg");
            setVersion("1.0.0");
          }}
        >
          测试兜底
        </button>
      </div>

      <MarketBanner condition={condition} strategy={feeResult.strategy} />

      <div className={styles.capabilityChain}>
        {feeResult.chain.map((step, index) => (
          <span key={step}>
            {index > 0 ? "→" : null}
            <code>{step}</code>
          </span>
        ))}
      </div>

      <dl className={styles.capabilityDetails}>
        <div>
          <dt>函数结果</dt>
          <dd>
            {feeResult.strategy}，fee = {feeResult.fee.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt>函数命中层级</dt>
          <dd>{functionResolution.selected?.level ?? "未命中"}</dd>
        </div>
        <div>
          <dt>组件命中层级</dt>
          <dd>{componentResolution.selected?.level ?? "未命中"}</dd>
        </div>
      </dl>

      <section className={styles.capabilityExplanation}>
        <h2>explain() 解析结果</h2>
        <p>
          explain 只用于诊断，不会执行已注册的函数或渲染组件。
        </p>
        <pre>
          {JSON.stringify(
            {
              functionCallChain,
              component: componentResolution,
            },
            null,
            2,
          )}
        </pre>
      </section>
    </section>
  );
}

function useDemoRuntimeControllers(websocketUrl: string) {
  const [demos, setDemos] = useState<{
    websocketUrl: string;
    compareDemo: BeComparisonRuntimeController;
    singleDemo: BeSingleRuntimeController;
  }>();

  useEffect(() => {
    const compareDemo = createBeComparisonRuntime({ websocketUrl });
    const singleDemo = createBeSingleRuntime({ websocketUrl });
    const nextDemos = { websocketUrl, compareDemo, singleDemo };
    setDemos(nextDemos);

    return () => {
      void Promise.allSettled([
        compareDemo.dispose(),
        singleDemo.dispose(),
      ]);
    };
  }, [websocketUrl]);

  return demos?.websocketUrl === websocketUrl ? demos : undefined;
}

function renderDemoInput(props: FrameCardProps<DemoMessage>) {
  const Card = demoRenderer.getCard(props.message, props.context);

  return <Card {...props} />;
}

function DemoLoadingIndicator() {
  return (
    <div className="chat-loading" role="status" aria-live="polite">
      <span className="chat-loading-dot" aria-hidden="true" />
      Generating response...
    </div>
  );
}

function SubmissionQueuePanel({
  onEdit,
}: {
  onEdit(text: string): void;
}) {
  const queue = useSubmissionQueue<DemoSubmission>();
  const items = useQueuedSubmissions<DemoSubmission>();

  if (items.length === 0) {
    return null;
  }

  const highestPriority = items.reduce(
    (highest, item) => Math.max(highest, item.priority),
    0,
  );

  return (
    <aside className="submission-queue" aria-label="Queued messages">
      <header className="submission-queue-header">
        <strong>Queued messages</strong>
        <span>{items.length}</span>
      </header>
      <ol className="submission-queue-list">
        {items.map((item) => (
          <li
            className="submission-queue-item"
            data-status={item.status}
            key={item.id}
          >
            <p>{item.payload.text}</p>
            <div className="submission-queue-actions">
              {item.status === "failed" ? (
                <button type="button" onClick={() => queue.retry(item.id)}>
                  Retry
                </button>
              ) : (
                <button
                  type="button"
                  disabled={item.status === "dispatching"}
                  onClick={() =>
                    queue.reprioritize(item.id, highestPriority + 1)
                  }
                >
                  Send next
                </button>
              )}
              <button
                type="button"
                disabled={item.status === "dispatching"}
                onClick={() => {
                  const selected = queue.take(item.id);
                  if (selected) {
                    onEdit(selected.payload.text);
                  }
                }}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={item.status === "dispatching"}
                onClick={() => queue.remove(item.id)}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
