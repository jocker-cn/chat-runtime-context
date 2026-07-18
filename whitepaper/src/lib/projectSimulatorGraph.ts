import type { Edge, Node } from "@xyflow/react";
import type { SimulatorState } from "../data/model";

export interface RuntimeFlowNodeData extends Record<string, unknown> {
  kind: "runtime" | "turn" | "input" | "branch" | "source-message" | "card";
  title: string;
  subtitle: string;
  status?: string;
  content?: string;
  revision?: number;
}

export interface RuntimeFlowGraph {
  nodes: Node<RuntimeFlowNodeData>[];
  edges: Edge[];
}

export function projectSimulatorGraph(state: SimulatorState): RuntimeFlowGraph {
  const branches = Object.values(state.branches);
  const branchGap = 430;
  const centerX = Math.max(0, ((branches.length - 1) * branchGap) / 2);
  const nodes: Node<RuntimeFlowNodeData>[] = [
    createNode("runtime", "runtime", centerX, 0, {
      kind: "runtime",
      title: "ChatRuntime",
      subtitle: state.turnId ? "activeTurnId 已建立" : "等待发送",
      status: state.runtimeStatus,
    }),
  ];
  const edges: Edge[] = [];

  if (state.inputMessage) {
    nodes.push(
      createNode("input", `message:${state.inputMessage.id}`, centerX - 390, 170, {
        kind: "input",
        title: "User Message",
        subtitle: state.inputMessage.id,
        content: state.inputMessage.content,
      }),
    );
  }

  if (state.turnId) {
    nodes.push(
      createNode("turn", `turn:${state.turnId}`, centerX + 40, 170, {
        kind: "turn",
        title: "ChatTurn",
        subtitle: state.turnId,
        status: state.turnPhase ?? "active",
      }),
    );
    edges.push(createEdge("runtime-turn", "runtime", `turn:${state.turnId}`, "owns"));
    if (state.inputMessage) {
      edges.push(
        createEdge(
          "input-turn",
          `message:${state.inputMessage.id}`,
          `turn:${state.turnId}`,
          "inputMessage",
        ),
      );
    }
  }

  branches.forEach((branch, index) => {
    const x = index * branchGap;
    const branchNodeId = `branch:${branch.id}`;
    nodes.push(
        createNode("branch", branchNodeId, x, 350, {
        kind: "branch",
        title: "ChatBranch",
        subtitle: `${branch.id} · ${branch.sourceId}`,
        status: branch.status,
        content: branch.error,
      }),
    );
    if (state.turnId) {
      edges.push(createEdge(`turn-${branch.id}`, `turn:${state.turnId}`, branchNodeId, "branchIds"));
    }

    const branchMessages = Object.values(state.assistantMessages).filter(
      (message) => message.branchId === branch.id,
    );
    branchMessages.forEach((message, messageIndex) => {
      const messageX = x + messageIndex * 42;
      const sourceMessageId = `source-message:${message.id}`;
      nodes.push(
        createNode("source-message", sourceMessageId, messageX, 530, {
          kind: "source-message",
          title: "AG-UI Message",
          subtitle: `${message.id} · 源消息 r${message.sourceRevision}（演示计数）`,
          status: message.status,
          content: message.sourceContent || "等待 token…",
          revision: message.sourceRevision,
        }),
      );
      edges.push(createEdge(`branch-message-${message.id}`, branchNodeId, sourceMessageId, "messageReader"));

      const projectedIds = state.projectedMessageIdsByBranchId[branch.id] ?? [];
      if (projectedIds.includes(message.id)) {
        const cardNodeId = `card:${message.id}`;
        nodes.push(
          createNode("card", cardNodeId, messageX, 710, {
            kind: "card",
            title: "FrameSlot → Card",
            subtitle: `${message.id} · 可见快照 r${message.visibleRevision}（演示计数）`,
            status: message.status,
            content: message.visibleContent || "空快照",
            revision: message.visibleRevision,
          }),
        );
        edges.push(createEdge(`message-card-${message.id}`, sourceMessageId, cardNodeId, "frame flush"));
      }
    });
  });

  return { nodes, edges };
}

function createNode(
  kind: RuntimeFlowNodeData["kind"],
  id: string,
  x: number,
  y: number,
  data: RuntimeFlowNodeData,
): Node<RuntimeFlowNodeData> {
  return {
    id,
    type: "runtimeInstance",
    position: { x, y },
    draggable: false,
    selectable: false,
    focusable: true,
    ariaLabel: `${data.title}，${data.subtitle}${data.status ? `，${data.status}` : ""}`,
    data: { ...data, kind },
  };
}

function createEdge(id: string, source: string, target: string, label: string): Edge {
  return {
    id,
    source,
    target,
    label,
    type: "smoothstep",
    animated: true,
  };
}
