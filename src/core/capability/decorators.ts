import type { ComponentType } from "react";
import { CapabilityRegistry } from "./CapabilityRegistry";
import type {
  CapabilityFunction,
  CapabilityRegistration,
} from "./contracts";
import { capabilityRegistry } from "./defaultRegistry";
import { CapabilityRegistrationError } from "./errors";

export type FunctionCapabilityDecorator = MethodDecorator;
export type ComponentCapabilityDecorator = ClassDecorator & MethodDecorator;

export function createCapabilityDecorators(registry: CapabilityRegistry) {
  return {
    RegisterFunction(
      registration: CapabilityRegistration,
    ): FunctionCapabilityDecorator {
      return (target, propertyKey, descriptor) => {
        const implementation = getPublicMethod(
          target,
          propertyKey,
          descriptor,
          "RegisterFunction",
        );
        registry.registerFunction(
          registration,
          implementation as CapabilityFunction,
          decoratorSource(target, propertyKey),
        );
      };
    },

    RegisterComponent(
      registration: CapabilityRegistration,
    ): ComponentCapabilityDecorator {
      return ((
        target: object | Function,
        propertyKey?: string | symbol,
        descriptor?: PropertyDescriptor,
      ) => {
        if (propertyKey === undefined) {
          registry.registerComponent(
            registration,
            target as ComponentType<any>,
            `@class:${target instanceof Function ? target.name : "anonymous"}`,
          );
          return;
        }

        const implementation = getPublicMethod(
          target,
          propertyKey,
          descriptor,
          "RegisterComponent",
        );
        registry.registerComponent(
          registration,
          implementation as ComponentType<any>,
          decoratorSource(target, propertyKey),
        );
      }) as ComponentCapabilityDecorator;
    },
  };
}

const defaultDecorators = createCapabilityDecorators(capabilityRegistry);

export const RegisterFunction = defaultDecorators.RegisterFunction;
export const RegisterComponent = defaultDecorators.RegisterComponent;

export function defineFunctionCapability<TFunction extends CapabilityFunction>(
  registration: CapabilityRegistration,
  implementation: TFunction,
  registry: CapabilityRegistry = capabilityRegistry,
) {
  return registry.registerFunction(registration, implementation);
}

export function defineComponentCapability<TProps>(
  registration: CapabilityRegistration,
  implementation: ComponentType<TProps>,
  registry: CapabilityRegistry = capabilityRegistry,
) {
  return registry.registerComponent(registration, implementation);
}

function getPublicMethod(
  target: object | Function,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor | undefined,
  decoratorName: string,
): Function {
  const resolvedDescriptor =
    descriptor ?? Object.getOwnPropertyDescriptor(target, propertyKey);

  if (!resolvedDescriptor || typeof resolvedDescriptor.value !== "function") {
    throw new CapabilityRegistrationError(
      `${decoratorName} can only decorate public methods; "${String(propertyKey)}" is not supported.`,
    );
  }

  return resolvedDescriptor.value;
}

function decoratorSource(
  target: object | Function,
  propertyKey: string | symbol,
) {
  const owner =
    typeof target === "function"
      ? target.name
      : target.constructor?.name ?? "anonymous";
  return `@method:${owner}.${String(propertyKey)}`;
}
