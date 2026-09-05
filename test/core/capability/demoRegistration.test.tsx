// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "../../../src/chat/demo/capabilityDemo.capabilities";
import { capabilityDemoRegistry } from "../../../src/chat/demo/capabilityDemoRegistry";
import type { FeeResult, MarketBannerProps } from "../../../src/chat/demo/capabilityDemo.capabilities";
import type { CapabilityCondition } from "../../../src/core/capability";

afterEach(cleanup);

it("loads the real decorator module and renders both exact versions and future fallback", () => {
  for (const version of ["2.1.0", "2.5.0", "99.0.0"]) {
    const condition = { market: "cn", version };
    const result = capabilityDemoRegistry.getFunction<
      (amount: number, condition: CapabilityCondition) => FeeResult
    >("calculate-fee", condition)(100, condition);
    expect(result.chain).toHaveLength(3);
    const Banner = capabilityDemoRegistry.getComponent<MarketBannerProps>("market-banner", condition);
    const view = render(<Banner condition={condition} strategy={result.strategy} />);
    expect(view.container.textContent).toContain(version);
    const report = capabilityDemoRegistry.explain("market-banner", "component", condition);
    expect(report.selected?.moduleId).toContain("capabilityDemo.capabilities.tsx");
    expect(report.selected?.level).toBe(version === "99.0.0" ? "global-fallback" : "market-exact");
    view.unmount();
  }
});
