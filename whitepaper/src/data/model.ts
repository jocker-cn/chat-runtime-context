export type WhitepaperSection =
  | "architecture"
  | "lifecycle"
  | "integration";

export type NodeOwnership =
  | "core"
  | "user"
  | "ag-ui"
  | "extension"
  | "internal";

export type ApiVisibility =
  | "public-api"
  | "extension-point"
  | "user-provided"
  | "core-internal";

export interface SourceReference {
  label: string;
  path: string;
}

export interface ApiFieldDefinition {
  name: string;
  type: string;
  required: boolean;
  owner: "用户" | "Core" | "Source" | "AG-UI";
  description: string;
  defaultValue?: string;
  stability?: string;
}

export interface ArchitectureNodeDefinition {
  id: string;
  title: string;
  kind: string;
  summary: string;
  ownership: NodeOwnership;
  visibility: ApiVisibility;
  responsibilities: readonly string[];
  purpose: string;
  lifecycle?: readonly string[];
  inputs?: readonly string[];
  outputs?: readonly string[];
  extensionGuidance?: string;
  integration?: string;
  fields?: readonly ApiFieldDefinition[];
  codeExample?: string;
  sourceRefs: readonly SourceReference[];
  childSceneId?: string;
}

export interface ArchitectureEdgeDefinition {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export interface ArchitectureScene {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  parentId?: string;
  entryNodeId?: string;
  nodes: readonly ArchitectureNodeDefinition[];
  edges: readonly ArchitectureEdgeDefinition[];
}

export interface IntegrationStep {
  id: string;
  title: string;
  summary: string;
  owner: "用户" | "Core" | "AG-UI";
  sceneId: string;
  nodeId: string;
  code?: string;
  checks: readonly string[];
}

export interface SearchResult {
  sceneId: string;
  nodeId: string;
  sceneTitle: string;
  nodeTitle: string;
  summary: string;
}

export type ScenarioId = "single-send" | "compare-send" | "branch-error";

export type ScenarioEvent =
  | {
      id: string;
      type: "input-created";
      label: string;
      description: string;
      turnId: string;
      messageId: string;
      content: string;
    }
  | {
      id: string;
      type: "topology-committed";
      label: string;
      description: string;
      turnId: string;
      inputMessageId: string;
      branches: readonly {
        branchId: string;
        sourceId: string;
      }[];
    }
  | {
      id: string;
      type: "branch-running";
      label: string;
      description: string;
      branchId: string;
    }
  | {
      id: string;
      type: "assistant-message-created";
      label: string;
      description: string;
      branchId: string;
      messageId: string;
    }
  | {
      id: string;
      type: "assistant-message-delta";
      label: string;
      description: string;
      messageId: string;
      content: string;
    }
  | {
      id: string;
      type: "projection-frame-flushed";
      label: string;
      description: string;
      branchId: string;
      messageIds: readonly string[];
      liveMessageId?: string;
    }
  | {
      id: string;
      type: "branch-completed";
      label: string;
      description: string;
      branchId: string;
    }
  | {
      id: string;
      type: "branch-error";
      label: string;
      description: string;
      branchId: string;
      error: string;
    }
  | {
      id: string;
      type: "runtime-settled";
      label: string;
      description: string;
      status: "idle" | "error";
    };

export interface RuntimeScenario {
  id: ScenarioId;
  title: string;
  summary: string;
  events: readonly ScenarioEvent[];
}

export interface SimulatedInputMessage {
  id: string;
  content: string;
}

export interface SimulatedAssistantMessage {
  id: string;
  branchId: string;
  sourceContent: string;
  visibleContent: string;
  status: "streaming" | "completed" | "error";
  sourceRevision: number;
  visibleRevision: number;
}

export interface SimulatedBranch {
  id: string;
  turnId: string;
  sourceId: string;
  status: "idle" | "running" | "completed" | "error";
  error?: string;
}

export interface SimulatorState {
  runtimeStatus: "idle" | "running" | "error";
  turnId?: string;
  /** Derived presentation state; ChatTurn itself has no status field. */
  turnPhase?: "active" | "settled" | "error";
  inputMessage?: SimulatedInputMessage;
  branches: Readonly<Record<string, SimulatedBranch>>;
  assistantMessages: Readonly<Record<string, SimulatedAssistantMessage>>;
  projectedMessageIdsByBranchId: Readonly<Record<string, readonly string[]>>;
  activeComponentIds: readonly string[];
}
