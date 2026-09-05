import { describe, expect, expectTypeOf, it } from "vitest";
import { CapabilityRegistry, createTypedCapabilities } from "../../../src/core/capability";

interface Functions {
  price: (amount: number) => number;
}
interface Components {
  banner: { title: string };
}

describe("typed capabilities", () => {
  it("uses the same contract for const registration and lookup", () => {
    const registry = new CapabilityRegistry();
    const api = createTypedCapabilities<Functions, Components>(registry);
    const module = registry.createModule("/typed.ts");
    const registrations = api.forModule(module);
    registrations.registerFunction("price", { fallback: true }, (amount) => amount * 2);
    registrations.registerComponent("banner", { version: "1" }, ({ title }) => <div>{title}</div>);
    module.commit();
    const price = api.getFunction("price", { version: "1" });
    expectTypeOf(price).toEqualTypeOf<(amount: number) => number>();
    expect(price(4)).toBe(8);
  });
});

// Checked by tsc; never executed as runtime registrations.
function verifyTypeErrors() {
  const registry = new CapabilityRegistry();
  const api = createTypedCapabilities<Functions, Components>(registry);
  const registrations = api.forModule(registry.createModule("/types.ts"));
  // @ts-expect-error Unknown name.
  api.getFunction("typo", { version: "1" });
  // @ts-expect-error Contract requires a numeric return value.
  registrations.registerFunction("price", { fallback: true }, () => "wrong");
  // @ts-expect-error Props must satisfy the shared banner contract.
  registrations.registerComponent("banner", { fallback: true }, (_props: { count: number }) => null);
}
void verifyTypeErrors;
