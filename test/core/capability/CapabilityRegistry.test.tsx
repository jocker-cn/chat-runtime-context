// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CapabilityNotFoundError,
  CapabilityRegistrationError,
  CapabilityRegistry,
  CircularCapabilityError,
  createCapabilityDecorators,
} from "../../../src/core/capability";

const condition = { market: "cn", version: "2.1.0" };

describe("CapabilityRegistry", () => {
  it("prefers an exact market version before ranges and fallbacks", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(
      { name: "price", market: "cn", versionRange: ">=2 <3", priority: 100 },
      () => "range",
    );
    registry.registerFunction(
      { name: "price", market: "cn", version: "2.1.0" },
      () => "exact",
    );
    registry.registerFunction(
      { name: "price", market: "cn", fallback: true },
      () => "fallback",
    );

    const price = registry.getFunction<() => string>("price", condition);

    expect(price()).toBe("exact");
    expect(registry.explain("price", "function", condition).selected?.level)
      .toBe("market-exact");
  });

  it("uses versionRange before fallback and supports exact plus range on one declaration", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(
      {
        name: "format",
        market: "cn",
        version: "3.0.0",
        versionRange: ">=2 <4",
      },
      () => "compatible",
    );
    registry.registerFunction(
      { name: "format", fallback: true },
      () => "fallback",
    );

    expect(
      registry.getFunction<() => string>("format", condition)(),
    ).toBe("compatible");
    expect(
      registry.explain("format", "function", condition).selected?.level,
    ).toBe("market-range");
  });

  it("uses priority only within the same resolution level", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(
      { name: "submit", market: "cn", version: "2.1.0", priority: 1 },
      () => "market",
    );
    registry.registerFunction(
      { name: "submit", version: "2.1.0", priority: 100 },
      () => "global",
    );

    expect(
      registry.getFunction<() => string>("submit", condition)(),
    ).toBe("market");
  });

  it("returns a stable lazy function reference without changing its return type", async () => {
    const registry = new CapabilityRegistry();
    const syncReference = registry.getFunction<(value: number) => number>(
      "double",
      condition,
    );
    const sameReference = registry.getFunction<(value: number) => number>(
      "double",
      condition,
    );

    registry.registerFunction(
      { name: "double", market: "cn", version: "2.1.0" },
      (value: number) => value * 2,
    );
    registry.registerFunction(
      { name: "async-double", market: "cn", version: "2.1.0" },
      async (value: number) => value * 2,
    );

    expect(syncReference).toBe(sameReference);
    expect(syncReference(4)).toBe(8);
    expect(
      await registry.getFunction<(value: number) => Promise<number>>(
        "async-double",
        condition,
      )(4),
    ).toBe(8);
  });

  it("detects duplicate registrations during linking", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(
      { name: "duplicate", version: "1.0.0" },
      () => 1,
      "first",
    );
    registry.registerFunction(
      { name: "duplicate", version: "1.0.0" },
      () => 2,
      "second",
    );

    expect(() => registry.link()).toThrow(CapabilityRegistrationError);
  });

  it("detects synchronous function capability cycles", () => {
    const registry = new CapabilityRegistry();
    const a = registry.getFunction<() => void>("a", condition);
    const b = registry.getFunction<() => void>("b", condition);
    registry.registerFunction(
      { name: "a", market: "cn", version: "2.1.0" },
      () => b(),
    );
    registry.registerFunction(
      { name: "b", market: "cn", version: "2.1.0" },
      () => a(),
    );

    expect(() => a()).toThrow(CircularCapabilityError);
  });

  it("detects component capability cycles through render boundaries", () => {
    const registry = new CapabilityRegistry();
    const A = registry.getComponent("a", condition);
    const B = registry.getComponent("b", condition);
    registry.registerComponent(
      { name: "a", market: "cn", version: "2.1.0" },
      () => <B />,
    );
    registry.registerComponent(
      { name: "b", market: "cn", version: "2.1.0" },
      () => <A />,
    );

    expect(() => render(<A />)).toThrow(CircularCapabilityError);
  });

  it("supports automatic decorator registration on static methods", () => {
    const registry = new CapabilityRegistry();
    const { RegisterFunction } = createCapabilityDecorators(registry);

    class PriceCapabilities {
      @RegisterFunction({ name: "decorated-price", version: "1.0.0" })
      static calculate(value: number) {
        return value * 2;
      }
    }

    expect(PriceCapabilities.calculate(2)).toBe(4);
    expect(
      registry.getFunction<(value: number) => number>(
        "decorated-price",
        { version: "1.0.0" },
      )(3),
    ).toBe(6);
  });

  it("recovers a static method descriptor when the transform omits it", () => {
    const registry = new CapabilityRegistry();
    const { RegisterComponent } = createCapabilityDecorators(registry);

    class BannerCapabilities {
      static DefaultBanner() {
        return <div>default banner</div>;
      }
    }

    const decorator = RegisterComponent({
      name: "default-banner",
      fallback: true,
    }) as MethodDecorator;
    decorator(
      BannerCapabilities,
      "DefaultBanner",
      undefined as unknown as PropertyDescriptor,
    );

    const Banner = registry.getComponent("default-banner", condition);
    expect(render(<Banner />).getByText("default banner")).toBeTruthy();
  });

  it("registers an instance method without constructing its class", () => {
    const registry = new CapabilityRegistry();
    const { RegisterComponent } = createCapabilityDecorators(registry);

    class BannerCapabilities {
      @RegisterComponent({ name: "instance-banner", fallback: true })
      DefaultBanner() {
        return <div>instance method banner</div>;
      }
    }

    void BannerCapabilities;
    const Banner = registry.getComponent("instance-banner", condition);
    expect(render(<Banner />).getByText("instance method banner")).toBeTruthy();
  });

  it("throws a descriptive error when no implementation matches", () => {
    const registry = new CapabilityRegistry();
    const missing = registry.getFunction<() => void>("missing", condition);

    expect(() => missing()).toThrow(CapabilityNotFoundError);
  });
});
