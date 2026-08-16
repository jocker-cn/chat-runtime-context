import type {
  CapabilityCondition,
  CapabilityKind,
} from "./contracts";

export class CapabilityRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRegistrationError";
  }
}

export class CapabilityNotFoundError extends Error {
  constructor(
    name: string,
    kind: CapabilityKind,
    condition: CapabilityCondition,
  ) {
    super(
      `No ${kind} capability "${name}" matched market "${condition.market ?? "*"}" and version "${condition.version}".`,
    );
    this.name = "CapabilityNotFoundError";
  }
}

export class CircularCapabilityError extends Error {
  public readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`Circular capability dependency: ${path.join(" -> ")}`);
    this.name = "CircularCapabilityError";
    this.path = path;
  }
}
