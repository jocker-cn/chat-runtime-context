import type { ComponentType } from "react";
import type { CapabilityRegistry } from "./CapabilityRegistry";
import type {
  CapabilityCondition, CapabilityFunction, CapabilityRegistrar, CapabilityRegistration,
} from "./contracts";

type RegistrationOptions = CapabilityRegistration extends infer R
  ? R extends CapabilityRegistration ? Omit<R, "name"> : never
  : never;

/** Opt-in shared name -> signature/props contract for registration and consumption. */
export function createTypedCapabilities<
  Functions extends { [K in keyof Functions]: CapabilityFunction },
  Components,
>(registry: CapabilityRegistry) {
  return {
    getFunction<K extends keyof Functions & string>(name: K, condition: CapabilityCondition): Functions[K] {
      return registry.getFunction<Functions[K]>(name, condition);
    },
    getComponent<K extends keyof Components & string>(name: K, condition: CapabilityCondition): ComponentType<Components[K]> {
      return registry.getComponent<Components[K]>(name, condition);
    },
    forModule(registrar: CapabilityRegistrar) {
      return {
        registerFunction<K extends keyof Functions & string>(
          name: K, options: RegistrationOptions, implementation: Functions[K],
        ): Functions[K] {
          return registrar.registerFunction({ ...options, name }, implementation);
        },
        registerComponent<K extends keyof Components & string>(
          name: K, options: RegistrationOptions, implementation: ComponentType<Components[K]>,
        ): ComponentType<Components[K]> {
          return registrar.registerComponent({ ...options, name }, implementation);
        },
      };
    },
  };
}
