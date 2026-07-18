import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { RuntimeFlowNodeData } from "../lib/projectSimulatorGraph";

export type RuntimeFlowNode = Node<RuntimeFlowNodeData, "runtimeInstance">;

export function RuntimeNode({ data }: NodeProps<RuntimeFlowNode>) {
  return (
    <article className={`runtime-node runtime-node--${data.kind}`} data-status={data.status}>
      <Handle type="target" position={Position.Top} />
      <div className="runtime-node__heading">
        <strong>{data.title}</strong>
        {data.status ? <span>{data.status}</span> : null}
      </div>
      <small>{data.subtitle}</small>
      {data.content ? <p>{data.content}</p> : null}
      <Handle type="source" position={Position.Bottom} />
    </article>
  );
}
