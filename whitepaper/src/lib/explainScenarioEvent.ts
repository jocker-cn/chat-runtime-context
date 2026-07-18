import type {
  ScenarioEvent,
  SimulatorState,
} from "../data/model";

export interface ScenarioEventField {
  label: string;
  value: string;
  meaning: string;
}

export interface ScenarioStateChange {
  title: string;
  fields: readonly string[];
}

export interface ScenarioEventExplanation {
  trigger: string;
  payload: readonly ScenarioEventField[];
  changes: readonly ScenarioStateChange[];
  reasons: readonly string[];
}

export function explainScenarioEvent(
  event: ScenarioEvent | undefined,
  state: SimulatorState,
): ScenarioEventExplanation {
  if (!event) {
    return {
      trigger: "等待用户调用 runtime.send(input, options)",
      payload: [
        {
          label: "input",
          value: "业务输入",
          meaning: "Runtime 不规定输入类型，由 createInputMessage 转成 User Message。",
        },
        {
          label: "options",
          value: "turnId? · inputMessage? · branchIds? · metadata?",
          meaning: "只在需要覆盖默认 Turn、输入消息或参与 Source 时提供。",
        },
      ],
      changes: [
        {
          title: "当前状态",
          fields: [
            `Runtime.status = ${state.runtimeStatus}`,
            "turnIds / turnsById / branchesById 尚未变化",
          ],
        },
      ],
      reasons: [
        "发送前不创建空 Turn，避免历史中出现没有真实消息和运行来源的占位拓扑。",
        "输入结构由业务定义，Core 只负责生命周期与投影。",
      ],
    };
  }

  switch (event.type) {
    case "input-created":
      return {
        trigger: "send() 调用 createInputMessage(input, turnId)",
        payload: [
          field("turnId", event.turnId, "本轮拓扑和所有 Branch identity 的根 ID。"),
          field("input", event.content, "原始业务输入的示例内容。"),
        ],
        changes: [
          {
            title: "创建 User Message",
            fields: [
              `id: ${event.messageId}`,
              "role: user",
              `content: ${event.content}`,
            ],
          },
          {
            title: "Runtime Snapshot",
            fields: ["此时尚未发布 Turn 或 Branch", "status 仍为 idle"],
          },
        ],
        reasons: [
          "createInputMessage 是必需边界：业务可以保留自己的 Message subtype、metadata 和 ID 规则，Runtime 不猜测消息结构。",
          "先完成输入消息创建再提交拓扑，React 不会观察到只有 Turn、却没有输入 identity 的中间状态。",
        ],
      };

    case "topology-committed": {
      const branchIds = event.branches.map((branch) => branch.branchId);
      return {
        trigger: "openTrackedTurn() 完成 Branch scope/context 创建后执行一次 patchSnapshot()",
        payload: [
          field("turnId", event.turnId, "写入 activeTurnId 和 Turn Registry。"),
          field("inputMessageId", event.inputMessageId, "把 User Message 绑定到当前 Turn。"),
          field("source branches", branchIds.join(" · "), "每个选中的 Source 对应一个运行 Branch。"),
        ],
        changes: [
          {
            title: "ChatTurn",
            fields: [
              `id: ${event.turnId}`,
              `inputMessageId: ${event.inputMessageId}`,
              "inputMessage: 创建完成的 User Message 引用",
              `branchIds: [${branchIds.join(", ")}]`,
              `selectedBranchId: ${branchIds.length === 1 ? branchIds[0] : "undefined (Compare 等待选择)"}`,
              "createdAt: Date.now()",
              "metadata: send options 提供的 Turn metadata（可选）",
            ],
          },
          {
            title: `ChatBranch × ${event.branches.length}`,
            fields: event.branches.map(
              ({ branchId, sourceId }) =>
                `${branchId} { turnId, sourceId: ${sourceId}, label?, anchorMessageId?, messageReader, selector?, status: idle, metadata? }`,
            ),
          },
          {
            title: `ChatSourceRunContext × ${event.branches.length}`,
            fields: event.branches.map(
              ({ branchId, sourceId }) =>
                `${branchId} { threadId, turnId, branchId, sourceId: ${sourceId}, inputMessage, metadata, signal: AbortSignal }`,
            ),
          },
          {
            title: "ChatRuntimeSnapshot",
            fields: [
              "status: running",
              `activeTurnId: ${event.turnId}`,
              "turnIds + turnsById + branchesById 在同一次通知中更新",
            ],
          },
        ],
        reasons: [
          "原子提交避免 React 观察到 Turn 已存在但 Branch 或 messageReader 尚未建立的非法中间态。",
          "Turn/Branch 使用同级 registry 与 ID 引用，更新一个 Branch 时不必重建整个会话树。",
          "每个 Branch 在运行前就拥有独立 messageReader、AbortSignal 与运行 Context，Single 与 Compare 可以复用同一渲染协议。",
        ],
      };
    }

    case "branch-running": {
      const branch = state.branches[event.branchId];
      return {
        trigger: "AnswerSource.run() 产生 branch-started 事件",
        payload: [
          field("branchId", event.branchId, "定位已经存在的运行 Branch。"),
          field("sourceId", branch?.sourceId ?? "Source", "定位本次执行使用的 Agent/Source。"),
        ],
        changes: [
          {
            title: "ChatSourceRunContext",
            fields: [
              `turnId: ${branch?.turnId ?? state.turnId}`,
              `branchId: ${event.branchId}`,
              `sourceId: ${branch?.sourceId ?? "Source"}`,
              "inputMessage · metadata · AbortSignal",
            ],
          },
          {
            title: "ChatBranch",
            fields: ["status: idle → running", "不会创建新的 Turn 或 Branch"],
          },
        ],
        reasons: [
          "Context 将取消信号、输入和 metadata 精确绑定到一个 Branch，Compare 并行运行不会相互覆盖。",
          "Branch 在第一个 token 前已经创建，因此 Loading、错误和取消都有稳定的状态定位目标；是否渲染空 Branch 仍由 View 策略决定。",
        ],
      };
    }

    case "assistant-message-created":
      return {
        trigger: "AG-UI Agent 在自己的 messages 中加入稳定 messageId",
        payload: [
          field("branchId", event.branchId, "选择消息所属 Branch scope。"),
          field("messageId", event.messageId, "后续所有 delta 与 Card identity 都复用此 ID。"),
        ],
        changes: [
          {
            title: "AG-UI Assistant Message",
            fields: [
              `id: ${event.messageId}`,
              "role: assistant",
              "content: 空字符串（等待 delta）",
              "模拟器派生 sourceRevision: 0 · visibleRevision: 0（不是 Core/AG-UI 公共字段）",
            ],
          },
        ],
        reasons: [
          "消息由 Agent 持有，Runtime 不复制第二份消息生命周期。",
          "稳定 messageId 让 streaming 更新同一个 Card，而不是为每批 token 新建节点。",
        ],
      };

    case "assistant-message-delta": {
      const message = state.assistantMessages[event.messageId];
      return {
        trigger: "AG-UI messageReader 通知同一个 Assistant Message 内容变化",
        payload: [
          field("messageId", event.messageId, "定位 live tail。"),
          field("source content", event.content, "Agent 当前已经接收的完整内容。"),
        ],
        changes: [
          {
            title: "Source Message",
            fields: [
              `sourceRevision: ${message?.sourceRevision ?? 0}`,
              `sourceContent: ${message?.sourceContent ?? event.content}`,
              "revision 仅用于白皮书展示 Source 与可见快照的节奏差，不属于 Message schema",
            ],
          },
          {
            title: "React 可见状态",
            fields: [
              `visibleRevision: ${message?.visibleRevision ?? 0}`,
              "等待 FrameScheduler 合并后再通知",
              "visibleRevision 是模拟器派生计数，不是 Runtime snapshot 字段",
            ],
          },
        ],
        reasons: [
          "数据完整性与屏幕刷新频率分离：每批 token 都被 Agent 接收，但 React 不需要渲染每一批。",
          "BranchMessageHub 能识别原地 mutation，并只把 live tail 标记为 dirty。",
        ],
      };
    }

    case "projection-frame-flushed": {
      const firstMessage = state.assistantMessages[event.messageIds[0] ?? ""];
      return {
        trigger: "FrameScheduler 在动画帧中 flush dirty BranchMessageScope",
        payload: [
          field("branchId", event.branchId, "只通知这一个 Branch 的订阅者。"),
          field("messageIds", event.messageIds.join(" · "), "本次 Branch 可见快照的稳定顺序。"),
          field("liveMessageId", event.liveMessageId ?? "无", "允许实时尾部更新，历史项继续复用旧引用。"),
        ],
        changes: [
          {
            title: "Branch Message Snapshot",
            fields: [
              `visibleRevision: ${firstMessage?.visibleRevision ?? 0}`,
              `visibleContent: ${firstMessage?.visibleContent || "空"}`,
              "messageIds 顺序保持稳定",
              "revision 是演示字段；真实 Core 通过稳定快照引用表达可见版本",
            ],
          },
          {
            title: "React Tree",
            fields: [
              "首次 flush：创建 MessageGroup → FrameListItem → FrameSlot → Card",
              "后续 flush：只更新同一个 message.id 对应的 FrameMessage/Card",
            ],
          },
        ],
        reasons: [
          "按帧合并提供 UI backpressure，让浏览器有机会绘制 Loading 和交互动画。",
          "历史消息引用不变，因此历史 Card 不 rerender、不 remount，内部 Effect 不会重复执行。",
        ],
      };
    }

    case "branch-completed":
      return {
        trigger: "Source AsyncIterable 完成，Runtime 结束 active Branch run",
        payload: [field("branchId", event.branchId, "定位需要进入终态的 Branch。")],
        changes: [
          {
            title: "Terminal State",
            fields: [
              "stopTracking / terminal reconcile",
              "ChatBranch.status: completed",
              "最后一次 MessageReader 内容同步进入可读快照",
              "Assistant Message 是否包含 status 由 Agent/message subtype 决定，Core 不补写",
            ],
          },
        ],
        reasons: [
          "终态前同步 reconcile，保证最后一批内容可读，不会因为取消 pending frame 而丢失尾部。",
          "不新增 finalized 生命周期；completed 仍来自 AG-UI/Source。",
        ],
      };

    case "branch-error":
      return {
        trigger: "Source 产生 branch-error 或运行抛出异常",
        payload: [
          field("branchId", event.branchId, "定位失败的运行 Branch。"),
          field("error", event.error, "保留原始错误供业务和状态判断使用。"),
        ],
        changes: [
          {
            title: "ChatBranch",
            fields: ["status: error", `error: ${event.error}`, "停止该 Branch tracking"],
          },
          {
            title: "Error Card",
            fields: ["Core 不自动创建", "业务可按需调用 Error Message Operations"],
          },
        ],
        reasons: [
          "运行错误和可见错误消息是两个不同责任：Runtime 保存真实状态，业务决定如何展示。",
          "错误不会偷偷创建另一轮消息或改变 AG-UI 的消息所有权。",
        ],
      };

    case "runtime-settled":
      return {
        trigger: "所有 active Branch runs 已完成或失败",
        payload: [field("status", event.status, "由 Branch outcomes 决定 Runtime 最终状态。")],
        changes: [
          {
            title: "ChatRuntimeSnapshot",
            fields: [
              `status: ${event.status}`,
              "activeTurnId: undefined",
              "Turn 与 Branch 最终快照继续保留",
            ],
          },
          {
            title: "ChatTurn",
            fields: ["没有 status 字段", "settled 只是演示层从 Runtime/Branch 派生的显示状态"],
          },
        ],
        reasons: [
          "Runtime status 在有 active run 时为 running；全部结束后再根据 Branch outcome 派生 idle 或 error，历史 Turn 不额外复制同一生命周期。",
          "回到 idle 后 Queue 可以继续派发下一条输入。",
        ],
      };
  }
}

function field(
  label: string,
  value: string,
  meaning: string,
): ScenarioEventField {
  return { label, value, meaning };
}
