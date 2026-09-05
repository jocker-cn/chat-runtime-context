// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CapabilityNotFoundError, CapabilityRegistrationError, CapabilityRegistry,
  CapabilityView, CircularCapabilityError, createCapabilityDecorators,
  defineFunctionCapability, useCapabilityRevision,
  type CapabilityRegistration,
} from "../../../src/core/capability";

const condition = { market: "cn", version: "2.1.0" };
const exact = { name: "price", ...condition };
afterEach(cleanup);

describe("CapabilityRegistry exact versions", () => {
  it("uses only fallbacks for omitted and blank query versions", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(exact, () => "exact");
    registry.registerFunction({ name: "price", market: "cn", fallback: true }, () => "market");
    registry.registerFunction({ name: "price", fallback: true }, () => "global");
    const reference = registry.getFunction<() => string>("price", { market: "cn" });
    expect(reference()).toBe("market");
    for (const version of [undefined, "", "   "]) {
      expect(registry.getFunction("price", { market: "cn", version })).toBe(reference);
      expect(registry.explain("price", "function", { market: "cn", version }).selected?.level)
        .toBe("market-fallback");
    }
    expect(registry.getFunction<() => string>("price", {})()).toBe("global");
    expect(registry.explain("price", "function", {}).selected?.level).toBe("global-fallback");
    expect(registry.getFunction<() => string>("price", condition)()).toBe("exact");
  });

  it("does not arbitrarily select an exact version when there is no fallback", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(exact, () => 1);
    expect(() => registry.getFunction("price", { market: "cn" })()).toThrow(CapabilityNotFoundError);
    expect(() => registry.getFunction("price", { version: ">=2" })).toThrow(CapabilityRegistrationError);
  });

  it("renders a component fallback without a query version", () => {
    const registry = new CapabilityRegistry();
    registry.registerComponent({ name: "banner", ...condition }, () => <div>exact</div>);
    registry.registerComponent({ name: "banner", fallback: true }, () => <div>base</div>);
    const Banner = registry.getComponent("banner", { market: "cn" });
    const view = render(<Banner />);
    expect(view.getByText("base")).toBeTruthy();
    expect(registry.explain("banner", "component", { market: "cn" }).selected?.level)
      .toBe("global-fallback");
  });

  it("selects market exact, global exact, market fallback, then global fallback", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction({ name: "price", fallback: true }, () => "global fallback");
    registry.registerFunction({ name: "price", market: "cn", fallback: true }, () => "market fallback");
    registry.registerFunction({ name: "price", version: "2.1.0" }, () => "global exact");
    registry.registerFunction(exact, () => "market exact");
    const read = (market: string, version: string) =>
      registry.getFunction<() => string>("price", { market, version })();
    expect(read("cn", "2.1.0")).toBe("market exact");
    expect(read("sg", "2.1.0")).toBe("global exact");
    expect(read("cn", "99.0.0")).toBe("market fallback");
    expect(read("sg", "99.0.0")).toBe("global fallback");
  });

  it("does not match another exact version", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(exact, () => 1);
    expect(() => registry.getFunction("price", { ...condition, version: "2.1.1" })())
      .toThrow(CapabilityNotFoundError);
  });

  it("rejects legacy ranges, implicit fallback, and ambiguous metadata", () => {
    const registry = new CapabilityRegistry();
    const invalid = [
      { name: "x" },
      { name: "x", versionRange: ">=2 <3" },
      { name: "x", version: ">=2" },
      { name: "x", version: "2.1.0", fallback: true },
      { name: "x", version: "2.1.0", priority: 1 },
    ];
    for (const registration of invalid) {
      expect(() => registry.registerFunction(registration as CapabilityRegistration, () => 1))
        .toThrow(CapabilityRegistrationError);
    }
    expect(registry.list()).toHaveLength(0);
  });

  it("rejects duplicate standalone declarations even when sources are identical", () => {
    const registry = new CapabilityRegistry();
    registry.registerFunction(exact, () => 1, "Same.method");
    expect(() => registry.registerFunction(exact, () => 2, "Same.method"))
      .toThrow(CapabilityRegistrationError);
    expect(registry.getFunction<() => number>("price", condition)()).toBe(1);
  });

  it("ignores repeated registration of the same component without any hot callbacks", async () => {
    const registry = new CapabilityRegistry();
    const Banner = () => <div>banner</div>;
    const registration = { name: "banner", fallback: true } as const;
    registry.registerComponent(registration, Banner);
    await Promise.resolve();
    const revision = registry.getSnapshot();
    let notifications = 0;
    registry.subscribe(() => { notifications++; });
    registry.registerComponent(registration, Banner);
    registry.registerComponent(registration, Banner);
    await Promise.resolve();
    expect(registry.list()).toHaveLength(1);
    expect(registry.getSnapshot()).toBe(revision);
    expect(notifications).toBe(0);
  });

  it("allows the same decorator to execute again on the same class method", () => {
    const registry = new CapabilityRegistry();
    const { RegisterComponent } = createCapabilityDecorators(registry);
    class Demo {
      static Banner() { return <div>banner</div>; }
    }
    const decorator = RegisterComponent({ name: "banner", fallback: true });
    const descriptor = Object.getOwnPropertyDescriptor(Demo, "Banner")!;
    decorator(Demo, "Banner", descriptor);
    decorator(Demo, "Banner", descriptor);
    expect(registry.list()).toHaveLength(1);
  });

  it("keeps lazy references and Promise identity across module updates", () => {
    const registry = new CapabilityRegistry();
    const reference = registry.getFunction<() => unknown>("price", condition);
    const first = registry.createModule("/price.ts");
    first.registerFunction(exact, () => 1);
    first.commit();
    expect(reference()).toBe(1);
    const promise = Promise.resolve(2);
    const next = registry.createModule("/price.ts");
    next.registerFunction(exact, () => promise);
    next.commit();
    expect(registry.getFunction("price", { ...condition })).toBe(reference);
    expect(reference()).toBe(promise);
  });

  it("explains module ownership and why other candidates were not selected", () => {
    const registry = new CapabilityRegistry();
    const module = registry.createModule("/price.ts");
    module.registerFunction(exact, () => 1, "Price.cn");
    module.registerFunction({ name: "price", version: "2.1.0" }, () => 2);
    module.registerFunction({ name: "price", fallback: true }, () => 3);
    module.registerFunction({ name: "price", version: "3.0.0" }, () => 4);
    module.commit();
    const report = registry.explain("price", "function", condition);
    expect(report.selected?.moduleId).toBe("/price.ts");
    expect(report.candidates.map((item) => item.reason)).toEqual([
      "selected", "lower-precedence", "lower-precedence", "version-mismatch",
    ]);
    expect(registry.explain("missing", "function", condition).selected).toBeUndefined();
  });
});

describe("Capability module lifecycle", () => {
  it("normalizes Vite timestamp URLs to the same module identity", () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("http://localhost:5173/src/price.ts?t=100");
    first.registerFunction(exact, () => 1);
    first.commit();
    const next = registry.createModule("http://localhost:5173/src/price.ts?t=200");
    next.registerFunction(exact, () => 2);
    next.commit();
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].moduleId).toBe("http://localhost:5173/src/price.ts");
  });
  it("publishes a complete generation and removes deleted and renamed declarations", () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("/price.ts");
    first.registerFunction(exact, () => "old");
    first.registerFunction({ name: "deleted", fallback: true }, () => "deleted");
    first.commit();
    const next = registry.createModule("/price.ts");
    next.registerFunction({ name: "renamed", fallback: true }, () => "new");
    expect(registry.getFunction<() => string>("price", condition)()).toBe("old");
    next.commit();
    expect(registry.list().map((item) => item.registration.name)).toEqual(["renamed"]);
    expect(() => registry.getFunction("price", condition)()).toThrow(CapabilityNotFoundError);
    expect(() => registry.getFunction("deleted", condition)()).toThrow(CapabilityNotFoundError);
  });

  it("preserves the previous generation if replacement conflicts with another module", () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("/a.ts");
    first.registerFunction(exact, () => 1);
    first.commit();
    const other = registry.createModule("/b.ts");
    other.registerFunction({ name: "taken", fallback: true }, () => 2);
    other.commit();
    const next = registry.createModule("/a.ts");
    next.registerFunction({ name: "taken", fallback: true }, () => 3);
    expect(() => next.commit()).toThrow(CapabilityRegistrationError);
    expect(registry.getFunction<() => number>("price", condition)()).toBe(1);
  });

  it("does not conflate identical class and method names from different modules", () => {
    const registry = new CapabilityRegistry();
    const a = registry.createModule("/a.ts");
    a.registerFunction(exact, () => 1, "@method:Demo.run");
    a.commit();
    const b = registry.createModule("/b.ts");
    b.registerFunction(exact, () => 2, "@method:Demo.run");
    expect(() => b.commit()).toThrow(CapabilityRegistrationError);
  });

  it("retains stacked version decorators on the same method", () => {
    const registry = new CapabilityRegistry();
    const module = registry.createModule("/stacked.ts");
    const { RegisterFunction } = createCapabilityDecorators(module);
    class Demo {
      @RegisterFunction({ name: "price", version: "1" })
      @RegisterFunction({ name: "price", version: "2" })
      static price() { return 7; }
    }
    void Demo;
    module.commit();
    expect(registry.list()).toHaveLength(2);
    expect(registry.getFunction<() => number>("price", { version: "2" })()).toBe(7);
  });

  it("protects a replacement from an old module's explicit disposal", () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("/price.ts");
    first.registerFunction(exact, () => 1);
    first.commit();
    const next = registry.createModule("/price.ts");
    next.registerFunction(exact, () => 2);
    next.commit();
    first.dispose();
    expect(registry.getFunction<() => number>("price", condition)()).toBe(2);
    next.dispose();
    next.dispose();
    expect(registry.list()).toHaveLength(0);
  });

  it("supports const helper registration and rejects use after commit or dispose", () => {
    const registry = new CapabilityRegistry();
    const module = registry.createModule("/const.ts");
    const original = () => 3;
    expect(defineFunctionCapability(exact, original, module)).toBe(original);
    module.commit();
    expect(() => module.registerFunction(exact, original)).toThrow(CapabilityRegistrationError);
    module.dispose();
    expect(() => module.commit()).toThrow(CapabilityRegistrationError);
  });
});

describe("React registration updates", () => {
  it("updates an already mounted component without rerendering its parent", async () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("/banner.tsx");
    first.registerComponent({ name: "banner", fallback: true }, () => <div>before</div>);
    first.commit();
    const Banner = registry.getComponent("banner", condition);
    const view = render(<Banner />);
    expect(view.getByText("before")).toBeTruthy();
    await act(async () => {
      const next = registry.createModule("/banner.tsx");
      next.registerComponent({ name: "banner", fallback: true }, () => <div>after</div>);
      next.commit();
    });
    expect(view.queryByText("before")).toBeNull();
    expect(view.getByText("after")).toBeTruthy();
    expect(registry.getComponent("banner", condition)).toBe(Banner);
  });

  it("selects the surviving fallback when a module is disposed", async () => {
    const registry = new CapabilityRegistry();
    registry.registerComponent({ name: "banner", fallback: true }, () => <div>base</div>);
    const module = registry.createModule("/banner.tsx");
    module.registerComponent({ name: "banner", ...condition }, () => <div>market</div>);
    module.commit();
    const Banner = registry.getComponent("banner", condition);
    const view = render(<Banner />);
    await act(async () => { module.dispose(); });
    expect(view.getByText("base")).toBeTruthy();
    expect(view.queryByText("market")).toBeNull();
  });

  it("batches dispose plus replacement without rendering a missing declaration", async () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("/banner.tsx");
    first.registerComponent({ name: "banner", fallback: true }, () => <div>before</div>);
    first.commit();
    const Banner = registry.getComponent("banner", condition);
    const view = render(<Banner />);
    await act(async () => {
      first.dispose();
      const next = registry.createModule("/banner.tsx");
      next.registerComponent({ name: "banner", fallback: true }, () => <div>after</div>);
      next.commit();
    });
    expect(view.getByText("after")).toBeTruthy();
  });

  it("preserves component state across condition changes when the implementation is shared", () => {
    const registry = new CapabilityRegistry();
    function Counter() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>{count}</button>;
    }
    registry.registerComponent({ name: "counter", fallback: true }, Counter);
    const view = render(<CapabilityView registry={registry} name="counter" condition={condition} componentProps={{}} />);
    fireEvent.click(view.getByRole("button"));
    view.rerender(<CapabilityView registry={registry} name="counter" condition={{ ...condition, version: "9" }} componentProps={{}} />);
    expect(view.getByRole("button").textContent).toBe("1");
  });

  it("updates function-derived UI at a subscribed boundary", async () => {
    const registry = new CapabilityRegistry();
    const first = registry.createModule("/price.ts");
    first.registerFunction(exact, () => 1);
    first.commit();
    function Price() {
      useCapabilityRevision(registry);
      return <div>{registry.getFunction<() => number>("price", condition)()}</div>;
    }
    const view = render(<Price />);
    await act(async () => {
      const next = registry.createModule("/price.ts");
      next.registerFunction(exact, () => 2);
      next.commit();
    });
    expect(view.getByText("2")).toBeTruthy();
  });

  it("keeps synchronous cycle detection and component cycle detection", () => {
    const registry = new CapabilityRegistry();
    const a = registry.getFunction<() => void>("a", condition);
    registry.registerFunction({ name: "a", fallback: true }, () => a());
    expect(a).toThrow(CircularCapabilityError);
    const A = registry.getComponent("A", condition);
    registry.registerComponent({ name: "A", fallback: true }, () => <A />);
    expect(() => render(<A />)).toThrow(CircularCapabilityError);
  });
});
