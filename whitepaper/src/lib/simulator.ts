import { initialSimulatorState } from "../data/scenarios";
import type {
  RuntimeScenario,
  ScenarioEvent,
  SimulatorState,
} from "../data/model";

export function reduceScenarioEvent(
  state: SimulatorState,
  event: ScenarioEvent,
): SimulatorState {
  switch (event.type) {
    case "input-created":
      return {
        ...state,
        inputMessage: {
          id: event.messageId,
          content: event.content,
        },
        activeComponentIds: ["createInputMessage", "Message"],
      };

    case "topology-committed": {
      const branches = { ...state.branches };
      event.branches.forEach(({ branchId, sourceId }) => {
        branches[branchId] = {
          id: branchId,
          turnId: event.turnId,
          sourceId,
          status: "idle",
        };
      });

      return {
        ...state,
        runtimeStatus: "running",
        turnId: event.turnId,
        turnPhase: "active",
        branches,
        activeComponentIds: [
          "CompareChatRuntime",
          "openTrackedTurn",
          "ChatTurn",
          "ChatBranch",
        ],
      };
    }

    case "branch-running": {
      const branch = state.branches[event.branchId];
      if (!branch) return state;

      return {
        ...state,
        branches: {
          ...state.branches,
          [event.branchId]: { ...branch, status: "running" },
        },
        activeComponentIds: ["AnswerSource", "AgUiAgentSource", "ChatSourceEvent"],
      };
    }

    case "assistant-message-created":
      return {
        ...state,
        assistantMessages: {
          ...state.assistantMessages,
          [event.messageId]: {
            id: event.messageId,
            branchId: event.branchId,
            sourceContent: "",
            visibleContent: "",
            status: "streaming",
            sourceRevision: 0,
            visibleRevision: 0,
          },
        },
        activeComponentIds: ["AbstractAgent", "AgentMessageReader", "MessageReader"],
      };

    case "assistant-message-delta": {
      const message = state.assistantMessages[event.messageId];
      if (!message) return state;

      return {
        ...state,
        assistantMessages: {
          ...state.assistantMessages,
          [event.messageId]: {
            ...message,
            sourceContent: event.content,
            sourceRevision: message.sourceRevision + 1,
          },
        },
        activeComponentIds: ["MessageReader", "BranchMessageHub", "FrameScheduler"],
      };
    }

    case "projection-frame-flushed": {
      const nextMessages = { ...state.assistantMessages };
      event.messageIds.forEach((messageId) => {
        const message = nextMessages[messageId];
        if (!message) return;

        nextMessages[messageId] = {
          ...message,
          visibleContent: message.sourceContent,
          visibleRevision: message.sourceRevision,
        };
      });

      return {
        ...state,
        assistantMessages: nextMessages,
        projectedMessageIdsByBranchId: {
          ...state.projectedMessageIdsByBranchId,
          [event.branchId]: [...event.messageIds],
        },
        activeComponentIds: [
          "BranchMessageScope",
          "useBranchRenderState",
          "FrameListView",
          "FrameSlot",
          "Card",
        ],
      };
    }

    case "branch-completed": {
      const branch = state.branches[event.branchId];
      if (!branch) return state;
      const assistantMessages = Object.fromEntries(
        Object.entries(state.assistantMessages).map(([id, message]) => [
          id,
          message.branchId === event.branchId
            ? { ...message, status: "completed" as const }
            : message,
        ]),
      );

      return {
        ...state,
        branches: {
          ...state.branches,
          [event.branchId]: { ...branch, status: "completed" },
        },
        assistantMessages,
        activeComponentIds: ["BranchMessageScope", "stopTracking", "CompareChatRuntime"],
      };
    }

    case "branch-error": {
      const branch = state.branches[event.branchId];
      if (!branch) return state;

      return {
        ...state,
        branches: {
          ...state.branches,
          [event.branchId]: {
            ...branch,
            status: "error",
            error: event.error,
          },
        },
        turnPhase: "error",
        activeComponentIds: ["ChatSourceEvent", "ChatBranch.error", "CompareChatRuntime"],
      };
    }

    case "runtime-settled":
      return {
        ...state,
        runtimeStatus: event.status,
        turnPhase: event.status === "error" ? "error" : "settled",
        activeComponentIds: ["ChatRuntimeSnapshot", "ChatRuntimeView"],
      };
  }
}

export function replayScenario(
  scenario: RuntimeScenario,
  eventIndex: number,
): SimulatorState {
  return scenario.events
    .slice(0, Math.max(0, eventIndex + 1))
    .reduce(reduceScenarioEvent, initialSimulatorState);
}
