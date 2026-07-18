import type { ApiVisibility, NodeOwnership } from "./model";

export type ContainmentLayout =
  | "stack"
  | "row"
  | "split"
  | "turn"
  | "support";

export type ContainmentSize =
  | "root"
  | "major"
  | "section"
  | "branch"
  | "frame"
  | "slot"
  | "leaf"
  | "compact";

export interface ContainmentTarget {
  sceneId: string;
  nodeId: string;
}

export interface ContainmentLayerDefinition {
  id: string;
  title: string;
  kind: string;
  summary: string;
  ownership: NodeOwnership;
  visibility: ApiVisibility;
  relation?: string;
  /** Why this boundary exists when it is not backed by an architecture node. */
  rationale?: string;
  target?: ContainmentTarget;
  size?: ContainmentSize;
  layout?: ContainmentLayout;
  children?: readonly ContainmentLayerDefinition[];
}

export interface ContainmentSceneDefinition {
  sceneId: string;
  problem: string;
  designReason: string;
  principles: readonly string[];
  root: ContainmentLayerDefinition;
}

const layer = (
  definition: ContainmentLayerDefinition,
): ContainmentLayerDefinition => definition;

const target = (sceneId: string, nodeId: string): ContainmentTarget => ({
  sceneId,
  nodeId,
});

export const containmentScenes: readonly ContainmentSceneDefinition[] = [
  {
    sceneId: "overview",
    problem: "高频 Agent 消息、会话拓扑和复杂 React Card 如果共用一条更新链，任何 token 都可能扩散成整个 Chat List 的重新执行。",
    designReason: "Core 将事实来源、Runtime 拓扑、消息投影和 React 渲染拆成独立边界，再用稳定 ID 与外部 Store 契约连接。这样既保留 AG-UI 的真实生命周期，又能把实时变化收敛到当前 Card。",
    principles: [
      "AG-UI Agent 是消息与执行生命周期的唯一事实来源",
      "Turn 与 Branch 使用 normalized registry，避免复制整段消息历史",
      "FrameSlot 隔离 Core 结构和用户业务 Card",
    ],
    root: layer({
      id: "core-root",
      title: "Chat Runtime Core",
      kind: "完整组件结构",
      summary: "Core 内部分为 Runtime Engine 与 React View System；二者通过稳定 snapshot 和 message projection 对接。",
      rationale: "用一个明确的 Core 边界把通用会话机制从业务应用中抽离，同时在内部继续区分事实、投影与 UI，避免形成一个无所不管的 Runtime。",
      ownership: "core",
      visibility: "public-api",
      size: "root",
      layout: "stack",
      children: [
        layer({
          id: "runtime-engine",
          title: "Runtime Engine",
          kind: "Topology & Lifecycle",
          summary: "维护 normalized topology、运行 Source，并拥有每个 Branch 的消息投影服务。",
          ownership: "core",
          visibility: "public-api",
          relation: "Core state boundary",
          target: target("overview", "runtime-core"),
          size: "major",
          layout: "split",
          children: [
            layer({
              id: "runtime-implementation",
              title: "ChatRuntime Implementation",
              kind: "命令与状态机",
              summary: "BaseChatRuntime、CompareChatRuntime 与 SingleAgentRuntime 共享同一套状态协议。",
              ownership: "core",
              visibility: "public-api",
              relation: "implements ChatRuntime",
              target: target("runtime", "chat-runtime"),
              size: "section",
            }),
            layer({
              id: "runtime-topology",
              title: "ChatRuntimeSnapshot",
              kind: "Normalized topology",
              summary: "Turn 与 Branch 存在于两个同级 registry；Turn 只通过 branchIds 引用 Branch。",
              ownership: "core",
              visibility: "public-api",
              relation: "owned state",
              target: target("runtime", "runtime-snapshot"),
              size: "section",
              layout: "split",
              children: [
                layer({
                  id: "turn-registry",
                  title: "Turn Registry",
                  kind: "turnIds + turnsById",
                  summary: "保存 inputMessage、branchIds、selectedBranchId 与 metadata。",
                  ownership: "core",
                  visibility: "public-api",
                  relation: "contains ChatTurn records",
                  target: target("runtime", "turn"),
                  size: "compact",
                }),
                layer({
                  id: "branch-registry",
                  title: "Branch Registry",
                  kind: "branchesById",
                  summary: "保存 sourceId、MessageReader、selector、status、error 与 metadata；真实 Source 配置由 Runtime 内部持有。",
                  ownership: "core",
                  visibility: "public-api",
                  relation: "contains ChatBranch records",
                  target: target("runtime", "branch"),
                  size: "compact",
                }),
              ],
            }),
            layer({
              id: "runtime-source-boundary",
              title: "Source / AG-UI Agent",
              kind: "Injected execution boundary",
              summary: "AnswerSource 运行 Agent；AG-UI Agent 继续作为消息与执行生命周期的事实来源。",
              ownership: "ag-ui",
              visibility: "extension-point",
              relation: "Runtime holds Source configs",
              target: target("overview", "source-agent"),
              size: "section",
            }),
            layer({
              id: "runtime-projection-boundary",
              title: "BranchMessageHub",
              kind: "Owned projection service",
              summary: "共享 MessageReader，按 Branch scope 物化稳定快照并按帧通知 React。",
              ownership: "internal",
              visibility: "core-internal",
              relation: "CompareChatRuntime owns hubs/scopes",
              target: target("overview", "message-projection"),
              size: "section",
            }),
          ],
        }),
        layer({
          id: "react-view-system",
          title: "React View System",
          kind: "真实组件包裹结构",
          summary: "ChatRuntimeView 的 DOM/Context 包裹关系逐层收敛到 FrameMessage 与用户 Card。",
          ownership: "core",
          visibility: "public-api",
          relation: "subscribes Runtime + Branch snapshots",
          target: target("overview", "rendering"),
          size: "major",
          layout: "stack",
          children: [
            layer({
              id: "overview-provider",
              title: "ChatProvider",
              kind: "Stable Context wrapper",
              summary: "只提供 Runtime 与 ExtensionStore 稳定引用；消费者通过 selector 订阅。",
              ownership: "core",
              visibility: "public-api",
              relation: "ChatRuntimeView renders",
              target: target("overview", "react-subscription"),
              size: "section",
              layout: "stack",
              children: [
                layer({
                  id: "overview-focus-controller",
                  title: "RuntimeFocusController",
                  kind: "Accessibility wrapper",
                  summary: "包裹整个 Chat list，并管理 User input 与 response Frame 焦点单元。",
                  ownership: "core",
                  visibility: "core-internal",
                  relation: "ChatProvider contains",
                  target: target("overview", "accessibility"),
                  size: "section",
                  layout: "stack",
                  children: [
                    layer({
                      id: "overview-content",
                      title: "ChatRuntimeContent / Chat List",
                      kind: "role=list root",
                      summary: "订阅 status 与 turnIds，并为每个稳定 turnId 创建一个 TurnView。",
                      ownership: "core",
                      visibility: "core-internal",
                      relation: "RuntimeFocusController contains",
                      target: target("rendering", "runtime-view"),
                      size: "section",
                      layout: "stack",
                      children: [
                        layer({
                          id: "overview-turn-view",
                          title: "TurnView × N",
                          kind: "per turnId",
                          summary: "一轮视图包含可选 User input 和 1..N 个回答 BranchView。",
                          ownership: "core",
                          visibility: "public-api",
                          relation: "turnIds.map",
                          target: target("rendering", "turn-view"),
                          size: "section",
                          layout: "turn",
                          children: [
                            layer({
                              id: "overview-user-input",
                              title: "User Input / renderInput",
                              kind: "Optional focus group",
                              summary: "输入消息由 TurnView 独立渲染，不经过 FrameSlot。",
                              ownership: "user",
                              visibility: "extension-point",
                              relation: "turn.inputMessage",
                              rationale: "User Message 属于 Turn 输入而不是 AI response Frame；单独渲染可避免为了兼容 AI-only Turn 而扭曲 Frame 分组语义。",
                              target: target("rendering", "turn-view"),
                              size: "compact",
                            }),
                            layer({
                              id: "overview-branch-view",
                              title: "BranchView × 1..N",
                              kind: "Single / Compare branch",
                              summary: "每个 Branch 独立订阅 topology 和 messageReader；Compare 分支互不影响。",
                              ownership: "core",
                              visibility: "public-api",
                              relation: "turn.branchIds.map",
                              target: target("rendering", "branch-view"),
                              size: "branch",
                              layout: "stack",
                              children: [
                                layer({
                                  id: "overview-frame-list",
                                  title: "FrameListView",
                                  kind: "Branch message list",
                                  summary: "把 Branch 消息分组为稳定 response Frame。",
                                  ownership: "core",
                                  visibility: "core-internal",
                                  relation: "BranchView contains",
                                  target: target("rendering", "frame-list"),
                                  size: "frame",
                                  layout: "stack",
                                  children: [
                                    layer({
                                      id: "overview-frame-item",
                                      title: "FrameListItem / RuntimeFocusGroup",
                                      kind: "per MessageGroup",
                                      summary: "使用稳定 group.id 作为 Frame identity 与焦点单元。",
                                      ownership: "core",
                                      visibility: "core-internal",
                                      relation: "groups.map",
                                      target: target("rendering", "frame-item"),
                                      size: "frame",
                                      layout: "stack",
                                      children: [
                                        layer({
                                          id: "overview-frame-slot",
                                          title: "FrameSlot",
                                          kind: "Core / business UI boundary",
                                          summary: "保持 Frame 稳定挂载，并承载同一 Group 内的 FrameMessage。",
                                          ownership: "core",
                                          visibility: "public-api",
                                          relation: "FrameListItem contains",
                                          target: target("rendering", "frame-slot"),
                                          size: "slot",
                                          layout: "stack",
                                          children: [
                                            layer({
                                              id: "overview-frame-message",
                                              title: "FrameMessage × item",
                                              kind: "memoized message unit",
                                              summary: "按 message.id 隔离渲染，只让发生变化的 Card 更新。",
                                              ownership: "internal",
                                              visibility: "core-internal",
                                              relation: "group.items.map",
                                              rationale: "把 memo 边界落到 message.id，最新消息变化时只更新对应 Card，同时保持 Group 与 FrameSlot 的挂载身份不变。",
                                              target: target("rendering", "render-context"),
                                              size: "compact",
                                              layout: "row",
                                              children: [
                                                layer({
                                                  id: "overview-card",
                                                  title: "Business Card",
                                                  kind: "User message component",
                                                  summary: "由 FrameRenderer 选择，负责 Markdown、工具结果、错误与业务 UI。",
                                                  ownership: "user",
                                                  visibility: "user-provided",
                                                  relation: "renderer.getCard(message, context)",
                                                  target: target("rendering", "business-card"),
                                                  size: "leaf",
                                                }),
                                              ],
                                            }),
                                          ],
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        layer({
          id: "optional-and-integration",
          title: "Optional Capabilities & Public Integration",
          kind: "围绕主结构组合的能力",
          summary: "它们复用公共契约，但不会改变 Runtime Engine 与 React View System 的内部组件结构。",
          rationale: "把可选能力放在主状态机之外组合，业务可以按需接入 Queue、History 或 Extensions，而不会为未使用能力承担额外生命周期。",
          ownership: "extension",
          visibility: "extension-point",
          size: "section",
          layout: "split",
          children: [
            layer({
              id: "overview-orchestration",
              title: "Queue / History / Error / Extensions",
              kind: "Optional capabilities",
              summary: "调度、历史恢复、本地错误消息和 scoped extension state。",
              ownership: "extension",
              visibility: "extension-point",
              relation: "composes around Runtime",
              target: target("overview", "orchestration"),
              size: "section",
            }),
            layer({
              id: "overview-integration",
              title: "Public Integration Surface",
              kind: "Assembly boundary",
              summary: "业务提供 Agent 与 Card，并装配 Source、Runtime、Renderer 和 View。",
              ownership: "extension",
              visibility: "extension-point",
              relation: "user-facing entry points",
              target: target("overview", "integration-surface"),
              size: "section",
            }),
          ],
        }),
      ],
    }),
  },
  {
    sceneId: "runtime",
    problem: "Single、Compare、History 和本地消息都需要共享同一套 Turn/Branch 状态机，同时不能让消息流直接污染拓扑快照。",
    designReason: "Runtime 实现族复用统一状态机；Snapshot 将 Turn 与 Branch 放在同级 registry，通过 ID 引用保持局部更新和稳定 identity。",
    principles: ["命令先校验再原子提交", "Turn 只引用 Branch ID", "消息内容由 Branch.messageReader 持有"],
    root: layer({
      id: "runtime-root",
      title: "ChatRuntime",
      kind: "拓扑、快照与命令边界",
      summary: "实现家族和 normalized snapshot 是 Runtime 的两个内部结构面。",
      ownership: "core",
      visibility: "public-api",
      target: target("runtime", "chat-runtime"),
      size: "root",
      layout: "split",
      children: [
        layer({
          id: "runtime-family",
          title: "Runtime Implementation Family",
          kind: "同一状态机的实现层",
          summary: "SingleAgentRuntime 复用 CompareChatRuntime，而不是维护另一套 Core。",
          rationale: "Single 与 Compare 的差异只是 Source 数量和选择策略；共享实现族可以避免两套状态机在取消、错误和历史恢复上产生语义漂移。",
          ownership: "core",
          visibility: "public-api",
          size: "section",
          layout: "row",
          children: [
            layer({ id: "base-runtime", title: "BaseChatRuntime", kind: "外部 Store 基类", summary: "稳定 snapshot、listener、reset 与 dispose。", ownership: "internal", visibility: "public-api", relation: "base class", target: target("runtime", "base-runtime"), size: "compact" }),
            layer({ id: "compare-runtime", title: "CompareChatRuntime", kind: "完整 Runtime 实现", summary: "创建 Turn/Branch、运行 Sources、管理 activeRuns。", ownership: "core", visibility: "public-api", relation: "extends BaseChatRuntime", target: target("runtime", "compare-runtime"), size: "compact" }),
            layer({ id: "single-runtime", title: "SingleAgentRuntime", kind: "单 Source 配置包装", summary: "把唯一 Source 归一化为 CompareChatRuntime 配置。", ownership: "core", visibility: "public-api", relation: "extends CompareChatRuntime", target: target("runtime", "single-runtime"), size: "compact" }),
          ],
        }),
        layer({
          id: "snapshot-family",
          title: "ChatRuntimeSnapshot",
          kind: "Normalized topology",
          summary: "ID 列表和按 ID 索引记录保持局部引用稳定。",
          ownership: "core",
          visibility: "public-api",
          target: target("runtime", "runtime-snapshot"),
          size: "section",
          layout: "split",
          children: [
            layer({ id: "runtime-turn", title: "Turn Registry", kind: "turnIds + turnsById", summary: "包含 ChatTurn 记录；branchIds 只是对 Branch Registry 的引用。", ownership: "core", visibility: "public-api", relation: "contains ChatTurn records", target: target("runtime", "turn"), size: "section" }),
            layer({ id: "runtime-branch", title: "Branch Registry", kind: "branchesById", summary: "包含同级 ChatBranch 记录、sourceId、MessageReader、selector、状态与错误；不保存 Source 对象。", ownership: "core", visibility: "public-api", relation: "referenced by turn.branchIds", target: target("runtime", "branch"), size: "section" }),
          ],
        }),
      ],
    }),
  },
  {
    sceneId: "source",
    problem: "Runtime 需要运行 Agent，但不应该绑定 WebSocket、SSE 或某一种 Agent SDK 的具体实现。",
    designReason: "AnswerSource 定义最小运行协议，AgUiAgentSource 只做适配；连接、消息和 AG-UI 生命周期继续由 Agent 自己负责。",
    principles: ["传输职责留在 Agent", "每次运行拥有独立 context 与 AbortSignal", "消息读取和生命周期事件分离"],
    root: layer({
      id: "source-root",
      title: "AnswerSource Boundary",
      kind: "执行与消息事实来源",
      summary: "Runtime 依赖 AnswerSource；AG-UI 通过 AgUiAgentSource 实现该协议。",
      ownership: "extension",
      visibility: "extension-point",
      target: target("source", "answer-source"),
      size: "root",
      layout: "stack",
      children: [
        layer({
          id: "agui-source-layer",
          title: "AgUiAgentSource",
          kind: "AG-UI Adapter",
          summary: "把 runAgent 生命周期和 Agent messages 转换成 Source 协议。",
          ownership: "core",
          visibility: "public-api",
          relation: "implements AnswerSource",
          target: target("source", "agui-source"),
          size: "major",
          layout: "split",
          children: [
            layer({ id: "agent-layer", title: "AbstractAgent", kind: "Wrapped AG-UI reference", summary: "业务提供；持有 messages、runAgent、abortRun 和传输策略。", ownership: "ag-ui", visibility: "user-provided", relation: "message fact source", target: target("source", "agui-agent"), size: "section" }),
            layer({ id: "reader-layer", title: "AgentMessageReader", kind: "Core-owned adapter", summary: "把 Agent messages 暴露为稳定的 MessageReader subscribe/getMessages 契约。", ownership: "internal", visibility: "core-internal", relation: "implements MessageReader", target: target("source", "message-reader"), size: "section" }),
          ],
        }),
        layer({
          id: "source-protocol-details",
          title: "Per-Branch Source Protocol",
          kind: "一次 Branch run 的输入与输出",
          summary: "Context 精确描述作用域；事件只推进已有 Branch 的生命周期。",
          rationale: "把一次执行的输入 context 与输出 event 分开，Source 无需获得 Runtime 写权限，Runtime 也无需理解传输协议。",
          ownership: "core",
          visibility: "public-api",
          size: "section",
          layout: "row",
          children: [
            layer({ id: "source-context-layer", title: "ChatSourceRunContext", kind: "输入上下文", summary: "Turn、Branch、Source、inputMessage、metadata 与 signal。", ownership: "core", visibility: "public-api", target: target("source", "source-context"), size: "compact" }),
            layer({ id: "source-event-layer", title: "ChatSourceEvent", kind: "输出事件", summary: "started、message(s)、completed 与 error。", ownership: "core", visibility: "public-api", target: target("source", "source-events"), size: "compact" }),
          ],
        }),
      ],
    }),
  },
  {
    sceneId: "projection",
    problem: "AG-UI 可能高频通知并原地修改消息；直接把每次通知同步推给 React 会导致重入、掉帧和历史 Card 重渲染。",
    designReason: "BranchMessageHub 为共享 Reader 建索引，为每个 Branch 建 Scope，并通过唯一帧调度任务合并可见更新。",
    principles: ["Source 数据完整接收", "React 通知按帧合并", "历史快照引用保持稳定"],
    root: layer({
      id: "projection-root",
      title: "BranchMessageHub",
      kind: "共享 Reader 的投影协调器",
      summary: "一个 Hub 包含 Source 索引、多个 Branch Scope 和唯一待执行 FrameScheduler。",
      ownership: "internal",
      visibility: "core-internal",
      target: target("projection", "branch-hub"),
      size: "root",
      layout: "stack",
      children: [
        layer({ id: "projection-source-reader", title: "Source MessageReader", kind: "Upstream port reference", summary: "接收 AG-UI 高频通知和原地 mutation；Hub 订阅但不拥有 Reader。", ownership: "extension", visibility: "extension-point", relation: "upstream reference", target: target("projection", "source-reader"), size: "section" }),
        layer({
          id: "projection-scope",
          title: "BranchMessageScope × N",
          kind: "每个 Runtime Branch 一个",
          summary: "维护 message IDs、selector、stable snapshot 与 tracking 状态。",
          ownership: "internal",
          visibility: "core-internal",
          relation: "Hub contains scopes",
          target: target("projection", "branch-scope"),
          size: "major",
          layout: "stack",
          children: [
            layer({ id: "projection-materializer", title: "Snapshot Materializer", kind: "消息 identity 边界", summary: "冻结嵌套内容，只刷新 live tail 和 terminal 修正。", ownership: "internal", visibility: "core-internal", target: target("projection", "snapshot-materializer"), size: "section" }),
          ],
        }),
        layer({ id: "projection-scheduler", title: "FrameScheduler", kind: "唯一待执行帧任务", summary: "合并通知、阻止同步重入、dispose 时取消 pending task。", ownership: "internal", visibility: "core-internal", target: target("projection", "frame-scheduler"), size: "section" }),
      ],
    }),
  },
  {
    sceneId: "react",
    problem: "把完整 Runtime snapshot 放进 Context 会让所有消费者随任意字段变化一起刷新。",
    designReason: "Context 只提供稳定依赖，组件通过 selector 分别订阅 topology 和 Branch messages，使更新范围与消费范围一致。",
    principles: ["稳定 Context value", "selector 只返回所需状态", "Branch 消息独立订阅"],
    root: layer({
      id: "react-root",
      title: "ChatProvider",
      kind: "稳定依赖边界",
      summary: "Context 只包含 Runtime 与 Extensions 引用，不广播频繁变化的 snapshot。",
      ownership: "core",
      visibility: "public-api",
      target: target("react", "chat-provider"),
      size: "root",
      layout: "stack",
      children: [
        layer({
          id: "provider-consumers",
          title: "Consumer Subtree",
          kind: "Components rendered inside provider scope",
          summary: "Hooks 不是 Provider 的 DOM 子组件；它们由 Provider 范围内的消费者调用。",
          rationale: "Provider 只建立依赖作用域，真正的更新粒度由消费位置决定；这样 Context 不会成为全局高频广播器。",
          ownership: "core",
          visibility: "core-internal",
          size: "section",
          layout: "split",
          children: [
            layer({ id: "topology-selector", title: "useChatSelector", kind: "Runtime topology subscription", summary: "selector + equalityFn 只更新真正变化的消费者。", ownership: "core", visibility: "public-api", relation: "reads Runtime external store", target: target("react", "chat-selector"), size: "section" }),
            layer({
              id: "branch-subscription",
              title: "useBranchRenderState",
              kind: "Branch split subscription",
              summary: "分别订阅 Branch topology 和 Branch.messageReader。",
              ownership: "core",
              visibility: "core-internal",
              relation: "called by BranchView",
              target: target("react", "branch-render-state"),
              size: "section",
              layout: "stack",
              children: [
                layer({ id: "branch-snapshot-layer", title: "Branch Message Snapshot", kind: "derived result", summary: "历史引用保持稳定，实时尾部按帧变化；它是订阅结果而非 Wrapper。", ownership: "internal", visibility: "core-internal", relation: "returns", target: target("react", "branch-snapshot"), size: "compact" }),
              ],
            }),
          ],
        }),
      ],
    }),
  },
  {
    sceneId: "rendering",
    problem: "复杂 Markdown、Tool Card 和业务 Effect 不能因为最新 token 到达而反复 remount 或重新执行历史节点。",
    designReason: "渲染树按 turnId、branchId、group.id 和 message.id 建立稳定边界，FrameMessage memo 将变化限制在实际更新的消息。",
    principles: ["User Input 不经过 FrameSlot", "FrameSlot 是稳定 UI 边界", "Card 由 Renderer 选择但由 message.id 保持 identity"],
    root: layer({
      id: "render-root",
      title: "ChatRuntimeView",
      kind: "完整 React 组件树",
      summary: "每一层都使用稳定 ID 和 memo 边界，把 streaming 更新收敛到当前 Message Card。",
      ownership: "core",
      visibility: "public-api",
      target: target("rendering", "runtime-view"),
      size: "root",
      layout: "stack",
      children: [
        layer({ id: "render-provider", title: "ChatProvider", kind: "Context wrapper", summary: "提供稳定 Runtime 与 ExtensionStore 引用。", ownership: "core", visibility: "public-api", relation: "ChatRuntimeView contains", target: target("react", "chat-provider"), size: "major", layout: "stack", children: [
          layer({ id: "render-focus-controller", title: "RuntimeFocusController", kind: "Accessibility wrapper", summary: "管理整个 Chat list 的焦点 registry 和 root props。", ownership: "core", visibility: "core-internal", relation: "ChatProvider contains", target: target("accessibility", "focus-controller"), size: "section", layout: "stack", children: [
            layer({ id: "render-content", title: "ChatRuntimeContent / section", kind: "role=list root", summary: "订阅 status/turnIds，并按稳定 turnId 渲染 TurnView。", ownership: "internal", visibility: "core-internal", relation: "RuntimeFocusController contains", target: target("rendering", "runtime-view"), size: "section", layout: "stack", children: [
              layer({ id: "render-turn", title: "TurnView × N", kind: "per turnId", summary: "输入消息和 1..N 个 Branch 列表。", ownership: "core", visibility: "public-api", relation: "turnIds.map", target: target("rendering", "turn-view"), size: "major", layout: "turn", children: [
                layer({ id: "render-input", title: "Input RuntimeFocusGroup", kind: "optional User input", summary: "调用 renderInput 渲染 User Message；不经过 FrameSlot。", ownership: "user", visibility: "extension-point", relation: "turn.inputMessage", target: target("rendering", "turn-view"), size: "compact" }),
                layer({ id: "render-branch", title: "BranchView × 1..N", kind: "per branchId", summary: "订阅一个 Branch 的 topology 与 messages。", ownership: "core", visibility: "public-api", relation: "turn.branchIds.map", target: target("rendering", "branch-view"), size: "branch", layout: "stack", children: [
                  layer({ id: "render-frame-list", title: "FrameListView", kind: "Branch message list", summary: "分组消息，并为每个稳定 Group 创建 FrameGroup。", ownership: "core", visibility: "core-internal", relation: "BranchView contains", target: target("rendering", "frame-list"), size: "frame", layout: "stack", children: [
                    layer({ id: "render-group", title: "FrameGroup", kind: "derived from MessageGroup", summary: "MessageGroup 是数据；FrameGroup 使用 group.id 创建真实 JSX wrapper。", ownership: "core", visibility: "core-internal", relation: "groups.map", target: target("rendering", "message-group"), size: "frame", layout: "stack", children: [
                      layer({ id: "render-frame-item", title: "FrameListItem / RuntimeFocusGroup", kind: "response Frame unit", summary: "全局上下键导航使用的稳定 Frame 单元。", ownership: "core", visibility: "core-internal", relation: "FrameGroup renders", target: target("rendering", "frame-item"), size: "frame", layout: "stack", children: [
                        layer({ id: "render-slot", title: "FrameSlot", kind: "UI boundary", summary: "Core 和用户 Card 之间的稳定挂载层。", ownership: "core", visibility: "public-api", relation: "FrameListItem contains", target: target("rendering", "frame-slot"), size: "slot", layout: "stack", children: [
                          layer({ id: "render-message", title: "FrameMessage × item", kind: "memoized component", summary: "按 message.id 渲染；构造 context 并选择 Card。", ownership: "internal", visibility: "core-internal", relation: "group.items.map", target: target("rendering", "render-context"), size: "section", layout: "row", children: [
                            layer({ id: "render-renderer", title: "FrameRenderer", kind: "Injected selector reference", summary: "按 role/condition 选择 Card component；不是 JSX wrapper。", ownership: "extension", visibility: "extension-point", relation: "renderer.getCard()", target: target("rendering", "frame-renderer"), size: "compact" }),
                            layer({ id: "render-context", title: "MessageRenderContext", kind: "Derived Card prop", summary: "Turn/Branch/Group 稳定标识与状态；不是 JSX wrapper。", ownership: "core", visibility: "public-api", relation: "passed as context prop", target: target("rendering", "render-context"), size: "compact" }),
                            layer({ id: "render-card", title: "Business Card", kind: "Rendered user UI", summary: "渲染 Markdown、工具结果、错误或任意业务内容。", ownership: "user", visibility: "user-provided", relation: "FrameMessage returns", target: target("rendering", "business-card"), size: "leaf" }),
                          ] }),
                        ] }),
                      ] }),
                    ] }),
                  ] }),
                ] }),
              ] }),
            ] }),
          ] }),
        ] }),
      ],
    }),
  },
  {
    sceneId: "orchestration",
    problem: "Queue、History、错误消息和扩展状态都很常用，但如果塞进 Runtime 状态机，会让 Core 边界不断膨胀。",
    designReason: "这些能力围绕 Runtime 公共命令组合，各自拥有独立 Store 或 Helper，不获得 Runtime 内部状态写入口。",
    principles: ["Queue 只通过 Target 调度", "History 只恢复 topology", "Operations 复用公共 Runtime 命令"],
    root: layer({
      id: "support-root",
      title: "Supporting Capabilities",
      kind: "围绕 Runtime 组合",
      summary: "Queue、History、Error Operations 和 ExtensionStore 各自保持独立边界。",
      rationale: "这些能力都需要调用 Runtime，但不应该共享 Runtime 的内部可变状态；围绕公共 API 组合可以维持单向边界。",
      ownership: "extension",
      visibility: "extension-point",
      size: "root",
      layout: "split",
      children: [
        layer({ id: "queue-container", title: "Queue Dispatch", kind: "串行提交容器", summary: "Queue 保存条目，Scheduler 观察 Target 状态。", rationale: "队列状态与会话状态分开保存，Scheduler 只通过 Target 契约判断何时派发，因此 Queue 不依赖某一种 Runtime 实现。", ownership: "core", visibility: "public-api", size: "section", layout: "stack", children: [
          layer({ id: "queue-store", title: "SubmissionQueue", kind: "Queue store", summary: "queued/dispatching/failed、优先级与重试。", ownership: "core", visibility: "public-api", target: target("orchestration", "submission-queue"), size: "compact" }),
          layer({ id: "queue-scheduler-layer", title: "QueueScheduler", kind: "Dispatcher", summary: "目标 idle 时选择并派发下一项。", ownership: "core", visibility: "public-api", target: target("orchestration", "queue-scheduler"), size: "compact" }),
          layer({ id: "queue-target-layer", title: "ChatRuntimeQueueTarget", kind: "Runtime adapter", summary: "把 Runtime status/send 适配为 Queue target。", ownership: "extension", visibility: "public-api", target: target("orchestration", "runtime-target"), size: "compact" }),
        ] }),
        layer({ id: "history-container", title: "History Topology", kind: "历史恢复容器", summary: "Helper 只生成 Turn/Branch topology，消息仍在 Source reader。", rationale: "历史恢复只重建 Runtime 的索引关系，不复制 Agent 已持有的消息，从而保持单一消息所有权。", ownership: "extension", visibility: "public-api", size: "section", layout: "stack", children: [
          layer({ id: "history-helper-layer", title: "createMainBranchHistoryTurns", kind: "Transcript parser", summary: "识别 User、AI-only 和 User-only Turn。", ownership: "extension", visibility: "public-api", target: target("orchestration", "history-helper"), size: "compact" }),
          layer({ id: "history-record-layer", title: "HistoryTurn", kind: "Topology record", summary: "稳定 Turn ID 与 Branch messageIds。", ownership: "extension", visibility: "public-api", target: target("orchestration", "history-turn"), size: "compact" }),
        ] }),
        layer({ id: "error-layer", title: "Error Message Operations", kind: "本地 Error Turn", summary: "复用 sendLocalMessage/removeTurn，不新增错误生命周期。", ownership: "extension", visibility: "public-api", target: target("orchestration", "error-operations"), size: "section" }),
        layer({ id: "extension-layer", title: "ChatExtensionStore", kind: "Scoped plugin state", summary: "conversation/turn/branch/group/message 精确订阅。", ownership: "extension", visibility: "public-api", target: target("orchestration", "extension-store"), size: "section" }),
      ],
    }),
  },
  {
    sceneId: "accessibility",
    problem: "Chat List 需要统一上下键导航，但用户 Card 内部又可能包含任意按钮、链接和输入控件。",
    designReason: "外层 Registry 只管理稳定的 User Input/Frame 单元，InnerFocusManager 管理 Card 内部焦点，两层通过 Enter/Escape 切换。",
    principles: ["Frame identity 与 React key 一致", "Card 无需理解全局列表", "外层与内部焦点职责分离"],
    root: layer({
      id: "focus-root",
      title: "RuntimeFocusController",
      kind: "Chat List 焦点容器",
      summary: "全局只管理 User input 和 response Frame 两类稳定焦点单元。",
      ownership: "core",
      visibility: "core-internal",
      target: target("accessibility", "focus-controller"),
      size: "root",
      layout: "stack",
      children: [
        layer({ id: "focus-registry-layer", title: "RuntimeFocusRegistry", kind: "Owned internal object", summary: "登记稳定 Group ID、当前焦点与移动策略；不是 React child。", rationale: "Registry 用稳定 ID 记录逻辑焦点，不依赖节点数组下标；流式更新或分支切换不会把焦点移动到错误 Card。", ownership: "internal", visibility: "core-internal", relation: "controller owns", size: "section" }),
        layer({ id: "focus-list-root", title: "Chat List Root", kind: "useRuntimeFocusRootProps / role=list", summary: "真实 DOM 根节点，包含 User Input 与 response Frame 两类焦点单元。", rationale: "统一的 list 根节点让上下键导航只处理稳定 Frame，而不介入用户 Card 内部的控件语义。", ownership: "core", visibility: "core-internal", relation: "controller wraps", size: "major", layout: "stack", children: [
          layer({ id: "focus-group-layer", title: "RuntimeFocusGroup × N", kind: "User input or response Frame", summary: "上下键在 Group 间移动，Enter 进入内部。", ownership: "core", visibility: "core-internal", relation: "registered focus unit", target: target("accessibility", "focus-group"), size: "section", layout: "stack", children: [
            layer({ id: "inner-focus-layer", title: "InnerFocusManager", kind: "Card inner boundary", summary: "方向键循环内部控件，Escape 回到外层 Group。", ownership: "core", visibility: "public-api", relation: "optional inner wrapper", target: target("accessibility", "inner-focus"), size: "section", layout: "stack", children: [
              layer({ id: "business-controls-layer", title: "Card Interactive Elements", kind: "业务控件", summary: "语义化按钮、链接、输入框和内容编辑区。", ownership: "user", visibility: "user-provided", relation: "focusable descendants", target: target("accessibility", "business-controls"), size: "leaf" }),
            ] }),
          ] }),
        ] }),
      ],
    }),
  },
  {
    sceneId: "integration",
    problem: "业务接入需要明确哪些对象由用户提供、哪些由 Core 创建，以及这些依赖如何组合。",
    designReason: "接入面只暴露 Agent/Source、Runtime、Renderer 和 View 四类稳定契约；内部 Turn/Branch/Frame 树由 Runtime 自动创建。",
    principles: ["用户提供 Agent 与 Card", "Core 创建 topology 与渲染边界", "通过公共命令发送和扩展"],
    root: layer({
      id: "integration-root",
      title: "Core Integration Surface",
      kind: "业务需要提供和装配的边界",
      summary: "这里只描述 Core 接入插槽；完整顺序和代码位于“接入指南”。",
      rationale: "将接入依赖压缩为 Runtime 与 Renderer 两条装配链，用户只需提供领域 Agent、Card 和少量策略，不需要手工创建内部 Turn/Branch/Frame。",
      ownership: "extension",
      visibility: "extension-point",
      size: "root",
      layout: "row",
      children: [
        layer({ id: "integration-runtime-dependency", title: "Runtime Dependency", kind: "State & execution assembly", summary: "Single/Compare Runtime 接收一个或多个 AnswerSourceConfig。", rationale: "把执行依赖集中在 Runtime 创建阶段，后续 send 只提交命令，不需要重复传递 Agent 与分支装配信息。", ownership: "core", visibility: "public-api", size: "section", layout: "stack", children: [
          layer({ id: "integration-runtime", title: "Single / Compare Runtime", kind: "Topology state", summary: "提供 snapshot、commands 和 subscription。", ownership: "core", visibility: "public-api", relation: "created by application", target: target("integration", "create-runtime"), size: "section", layout: "stack", children: [
            layer({ id: "integration-source", title: "AnswerSourceConfig × N", kind: "Injected Source dependency", summary: "通常使用 AgUiAgentSource，把 Agent 适配为 Core 协议。", ownership: "core", visibility: "public-api", relation: "runtime options", target: target("integration", "create-source"), size: "compact", layout: "stack", children: [
              layer({ id: "integration-agent", title: "AG-UI Agent", kind: "Injected reference", summary: "业务持有连接、执行与消息事实。", ownership: "user", visibility: "user-provided", relation: "AgUiAgentSource wraps", target: target("integration", "provide-agent"), size: "leaf" }),
            ] }),
            layer({ id: "integration-send", title: "runtime.send()", kind: "Public method", summary: "业务命令入口；创建真实 Turn/Branch topology。", ownership: "user", visibility: "public-api", relation: "command surface", target: target("integration", "send-message"), size: "compact" }),
          ] }),
        ] }),
        layer({ id: "integration-renderer-dependency", title: "Renderer Dependency", kind: "Business UI assembly", summary: "FrameRenderer 选择用户注册的 Card。", rationale: "消息事实与业务 UI 映射分离后，同一个 Runtime 可以复用在不同产品外观中，Card 也无需获得 Runtime 内部写权限。", ownership: "extension", visibility: "extension-point", size: "section", layout: "stack", children: [
          layer({ id: "integration-renderer", title: "FrameRenderer", kind: "Card registry", summary: "把 role/condition 映射到 Card component。", ownership: "user", visibility: "extension-point", relation: "created by application", target: target("integration", "register-cards"), size: "section", layout: "stack", children: [
            layer({ id: "integration-card-registrations", title: "Card Registrations", kind: "User components", summary: "Markdown、Tool、Error 与其他业务 Card。", rationale: "业务通过声明式注册扩展消息类型，不需要修改 Core 的分组、订阅或焦点实现。", ownership: "user", visibility: "user-provided", relation: "renderer contains registrations", size: "leaf" }),
          ] }),
        ] }),
        layer({ id: "integration-view", title: "Mounted ChatRuntimeView", kind: "React composition root", summary: "接收 Runtime 与 Renderer 引用，并在内部创建完整 Turn/Branch/FrameSlot 树。", ownership: "core", visibility: "public-api", relation: "mounted by application", target: target("integration", "mount-view"), size: "section", layout: "stack", children: [
          layer({ id: "integration-view-runtime-ref", title: "runtime prop", kind: "Reference", summary: "指向 Runtime Dependency。", rationale: "View 只持有稳定 Runtime 引用，并通过外部 Store selector 读取状态，避免把 snapshot 作为逐层变化的 React prop。", ownership: "core", visibility: "public-api", relation: "injected prop", size: "compact" }),
          layer({ id: "integration-view-renderer-ref", title: "renderer prop", kind: "Reference", summary: "指向 Renderer Dependency。", rationale: "Renderer 作为稳定策略引用注入，使 Card 选择与 Runtime 消息生命周期互不拥有。", ownership: "extension", visibility: "extension-point", relation: "injected prop", size: "compact" }),
          layer({ id: "integration-view-tree", title: "Turn / Branch / FrameSlot Tree", kind: "Internal component structure", summary: "由 Runtime snapshot 自动派生；业务无需手动创建。", ownership: "internal", visibility: "core-internal", relation: "ChatRuntimeView renders", target: target("rendering", "runtime-view"), size: "compact" }),
        ] }),
      ],
    }),
  },
] as const;

const containmentSceneById = new Map(
  containmentScenes.map((scene) => [scene.sceneId, scene]),
);

export function getContainmentScene(sceneId: string) {
  return containmentSceneById.get(sceneId) ?? containmentScenes[0]!;
}

export function flattenContainmentLayers(
  root: ContainmentLayerDefinition,
): readonly ContainmentLayerDefinition[] {
  return [
    root,
    ...(root.children?.flatMap((child) => flattenContainmentLayers(child)) ?? []),
  ];
}
