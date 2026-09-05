import { createCapabilityDecorators, type CapabilityCondition } from "../../core/capability";
import styles from "../../App.module.css";
import { capabilityDemoRegistry } from "./capabilityDemoRegistry";

export type DemoMarket = "cn" | "sg" | "us";

export interface FeeResult {
  strategy: string;
  fee: number;
  chain: string[];
}

interface CalculationResult {
  value: number;
  chain: string[];
}

export interface MarketBannerProps {
  condition: CapabilityCondition;
  strategy: string;
}

const capabilityModule = capabilityDemoRegistry.createModule(
  "src/chat/demo/capabilityDemo.capabilities.tsx",
);
const {
  RegisterFunction,
  RegisterComponent: RegisterDemoComponent,
} = createCapabilityDecorators(capabilityModule);


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
    version: "2.5.0",
  })
  static baseRateCnV2(amount: number): CalculationResult {
    return { value: amount * 0.05, chain: ["base-rate[market-exact]"] };
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
    version: "2.5.0",
  })
  static adjustmentCnV2(
    amount: number,
    condition: CapabilityCondition,
  ): CalculationResult {
    return adjustFromBase(amount, condition, 1.2, "market-exact");
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
    version: "2.5.0",
  })
  static calculateCnV2(
    amount: number,
    condition: CapabilityCondition,
  ): FeeResult {
    return calculateFromAdjustment(
      "CN / exact 2.5.0",
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
    version: "2.5.0",
  })
  static CnV2Banner({ condition, strategy }: MarketBannerProps) {
    return (
      <div className={styles.capabilityResult}>
        精确版本 2.5.0 组件：{condition.market} / {condition.version} / {strategy}
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


capabilityModule.commit();
