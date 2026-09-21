# Add to Chat 插件设计记录

> 状态：设计草案，尚未实现  
> 记录日期：2026-09-21  
> 依据：`CHAT_TURN_NAVIGATION_DESIGN.md` 的可选 View 插件、Controller、Store、Adapter 与宿主边界。

## 1. 结论

Add to Chat 应实现为独立的可选 View 插件，不进入 Chat Runtime Core，也不由具体 Message Card、Agent Adapter 或 Composer 持有核心逻辑。

推荐边界：

- Runtime 继续只负责 `Turn / Branch / Message / lifecycle`。
- 插件负责当前 selection、已添加 reference、浮动操作和引用列表。
- 宿主决定 reference 如何进入 Submission，以及何时清空。
- 应用启动时调用一次 `registerAddToChat()`；插件宿主通过 DOM Adapter 观察现有聊天区域，不包裹 Runtime 或消息内容。
- 远程 Renderer、Web Component 和 Worker 通过统一 selection/reference 协议接入，不依赖 React 组件。
- 插件不直接调用 Agent、不操作 Message Queue、不修改输入框文本。

```mermaid
flowchart LR
  Renderer["Native / Remote Renderer"] --> Provider["Selection Provider"]
  Provider --> Controller["AddToChat Controller"]
  Controller --> Store["AddToChat Store"]
  Store --> Action["Floating Add to chat Action"]
  Store --> List["Composer Reference List"]
  Host["Host Composer"] -->|snapshot references| Submission["Submission / Agent Adapter"]
  Store --> Host
```

## 2. 不进入 Runtime Core

该功能不应修改：

- `ChatRuntimeSnapshot`
- `ChatTurn`
- `ChatBranch`
- `BranchMessageHub`
- `FrameSlot`
- `RuntimeFocusController`
- `SubmissionQueue` 内部实现
- WebSocket/SSE Agent Adapter 协议

原因：选区和待发送引用属于 Composer/View 状态，不是已经发生的对话事实。用户可以添加、删除或取消引用，这些操作不应产生 Turn 或 Message。

## 3. 目录结构

与当前已实现的 Chat Turn Navigation 插件保持一致：

```text
src/core/chat/plugins/add-to-chat/
  contracts.ts
  AddToChatStore.ts
  createAddToChatController.ts
  registerAddToChat.ts
  AddToChatAction.tsx
  AddToChatReferenceList.tsx
  createDomSelectionAdapter.ts
  styles.css
  index.ts
```

如果未来拆包，可发布为：

```text
@chat-runtime/add-to-chat
```

不放入 `src/core/react`。Core React 组件不应该知道 Add to Chat 的产品语义。

## 4. 数据协议

### 4.1 临时选区

Selection 是尚未添加的瞬时 View 状态：

```ts
export interface AddToChatSelection {
  readonly text: string;
  readonly source: ContextReferenceSource;
  readonly anchor?: AddToChatAnchor;
}

export interface AddToChatAnchor {
  readonly x: number;
  readonly y: number;
}
```

`anchor` 只用于宿主定位浮动按钮，不进入 Submission，也不持久化。

### 4.2 已添加引用

用户点击 Add to chat 后，Selection 转换为稳定、可序列化的 `ContextReference`：

```ts
export interface ContextReference {
  readonly id: string;
  readonly type: "text-selection";
  readonly text: string;
  readonly source: ContextReferenceSource;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextReferenceSource {
  readonly type: string;
  readonly title?: string;
  readonly messageId?: string;
  readonly turnId?: string;
  readonly branchId?: string;
  readonly pluginId?: string;
  readonly targetId?: string;
}
```

约束：

- Reference 必须可序列化。
- 不保存 `Range`、`HTMLElement`、React state 或函数。
- `id` 在添加时生成，不能使用数组索引。
- 相同文本可以被添加多次，每一次都是独立数据源。
- 插件不解释 `metadata`，只负责保留和转交。

## 5. Store 与 Controller

Selection 和已添加 references 都由每个 Add to Chat 注册实例自己的 Store 管理：

```ts
export interface AddToChatSnapshot {
  readonly selection?: AddToChatSelection;
  readonly references: readonly ContextReference[];
}

export class AddToChatStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AddToChatSnapshot;

  setSelection(selection?: AddToChatSelection): void;
  addSelection(): ContextReference | undefined;
  removeReference(id: string): void;
  clearReferences(): void;
  reset(): void;
}
```

Controller 由注册函数内部创建，不向业务 React 组件暴露生命周期：

```ts
export interface AddToChatController {
  setSelection(selection?: AddToChatSelection): void;
  addSelection(): void;
  removeReference(id: string): void;
  clearReferences(): void;
  getReferences(): readonly ContextReference[];
}

export function createAddToChatController(): AddToChatController;

export interface AddToChatRegistration {
  getReferences(): readonly ContextReference[];
  clearReferences(): void;
  subscribeReferences(listener: () => void): () => void;
}
```

一个 Composer/Runtime 实例对应一个 Controller。不要使用进程级或模块级全局 Store，以免多个聊天窗口串数据。

## 6. View 插件

### 6.1 主入口：`registerAddToChat()`

主入口不依赖 React，也不要求修改 JSX。应用入口注册一次即可：

```ts
import { registerAddToChat } from "@chat-runtime/add-to-chat";
import { chatPluginRegistry } from "./chatPluginRegistry";

const id = "main-chat-add-to-chat";

export const mainChatAddToChat = registerAddToChat({
  registry: chatPluginRegistry,
  id,
  selectionRoot: ".crt-runtime",
  referenceHost: "[data-chat-reference-host]",
  resolveSource: ({ startElement }) => ({
    type: "chat-message",
    messageId: startElement
      .closest("[data-message-id]")
      ?.getAttribute("data-message-id") ?? undefined,
  }),
});
```

每次注册根据 `id` 创建并拥有独立 Store。调用方不创建、不传入 Store：

```ts
export const supportAddToChat = registerAddToChat({
  id: "support-chat",
  selectionRoot: "#support-chat .crt-runtime",
  referenceHost: "#support-chat [data-chat-reference-host]",
});

export const salesAddToChat = registerAddToChat({
  id: "sales-chat",
  selectionRoot: "#sales-chat .crt-runtime",
  referenceHost: "#sales-chat [data-chat-reference-host]",
});
```

`registerAddToChat()` 返回稳定 handle，发送链路通过它读取和清理 references。相同 `id` 再次注册时 Registry 替换 View 配置，但保持同一实例 Store，避免 HMR 清空用户当前引用。不同 ID 的 Store 完全隔离。

同一实例内的每次 Add to Chat 都生成独立 `ContextReference.id`，追加到 references 数组，不覆盖旧数据。第一版只提供实例生命周期内的内存状态，不做持久化。

注册之后，插件宿主负责：

- 等待 `selectionRoot` 和 `referenceHost` 出现在 DOM 中。
- Runtime 或 Composer 重挂载后重新绑定。
- 创建和销毁 Controller、监听器及 Portal。
- 同一个 `id` 再次注册时原子替换旧配置，支持 HMR。
- Registry、应用或动态插件销毁时自动清理。

业务页面不调用 `mount()`、`dispose()` 或 `useEffect()`。只 import 模块不会产生副作用；不调用 `registerAddToChat()` 时功能完全不存在。

如果希望做到纯副作用 import，可以由业务项目建立自己的注册模块：

```ts
// features/add-to-chat.register.ts
registerAddToChat({ /* application config */ });

// application bootstrap
import "./features/add-to-chat.register";
```

库本身不能在 import 时自动注册，因为它不知道当前应用的聊天根节点、Composer 插槽和数据源映射。

### 6.2 DOM Selection Adapter

Adapter 接收现有 DOM 节点，不要求业务 Renderer 使用任何 Add to Chat React 组件：

```ts
export interface AddToChatSelectionAdapter {
  getSelectionRoot(): HTMLElement | null;
  getReferenceHost(): HTMLElement | null;
  getOverlayHost?(): HTMLElement | null;
  resolveSource(context: {
    range: Range;
    startElement: Element;
    endElement: Element;
  }): ContextReferenceSource | null;
}
```

默认实现由 `createDomSelectionAdapter()` 提供。插件在 `selectionRoot` 上使用事件委托，读取浏览器 Selection，并且只接受起点和终点都位于该 root 内的选区。来源可通过现有的 `data-message-id`、`data-turn-id`、`data-branch-id` 等稳定属性解析，也可完全由业务传入 `resolveSource`。

Adapter 的职责包括：

- 限定插件可读取的 DOM 范围。
- 把现有 DOM 映射为公共 `ContextReferenceSource`。
- 提供现有的引用列表挂载点和可选浮层挂载点。
- 销毁时移除 selection、pointer、keyboard 和 resize/scroll 监听。

Adapter 不改变这些 DOM 节点的层级，也不持有 Runtime 内部对象。

### 6.3 浮动 Action

插件实例只创建一个共享 Action。它订阅当前 selection：

- 没有 selection 时不渲染。
- 使用 selection anchor 定位。
- 点击时调用 `controller.addSelection()`。
- 通过 Portal 挂载到 overlay host；未提供时挂载到 `document.body`。
- 支持键盘 Focus、Escape 和 `prefers-reduced-motion`。

不能让每个 Message Card 各自创建按钮或 Portal。

### 6.4 Composer Reference List

插件实例把 Reference List 通过 Portal 渲染到 `getReferenceHost()` 返回的现有节点。列表负责：

- 在输入框上方渲染每个数据源。
- 使用稳定的 `reference.id` 作为 key。
- 每条引用独立删除。
- 新引用追加，不覆盖旧引用。
- 不修改 input value。
- 不直接发送消息。

## 7. 宿主接入

```tsx
// ChatPage.tsx：没有 Add to Chat import、组件或 effect。
export function ChatPage() {
  return (
    <ChatLayout>
      <ChatRuntimeView runtime={runtime} renderer={renderer} />

      <Composer>
        <div data-chat-reference-host />
        <ComposerInput />
      </Composer>
    </ChatLayout>
  );
}
```

`ChatRuntimeView` 已经提供 `.crt-runtime` 根节点。Composer 只需提供一个通用 extension slot；它不 import Add to Chat，也不被 Add to Chat 包裹。注册函数通过 selector 或 Adapter 找到这些现有节点。

发送链路通过注册返回的 handle 读取不可变快照：

```ts
import { mainChatAddToChat } from "./addToChat.register";

const contextReferences = mainChatAddToChat.getReferences();

queue.enqueue({
  text: input,
  contextReferences,
});

mainChatAddToChat.clearReferences();
```

清理策略由宿主决定：

- 成功进入发送队列后清空。
- 入队失败时保留。
- 用户切换 Thread 时 reset 或切换对应 Controller。
- 用户删除单条引用时只影响 Composer 状态。

Submission 必须复制 reference 快照。入队之后继续修改 Store，不能改变已经排队的请求。

## 8. Agent Adapter 边界

插件不规定 DeepSeek 或其他 Agent 的请求格式。当前项目使用 AG-UI，`RunAgentParameters.context` 已经提供标准的 `{ description, value }[]` 通道，因此 Queue target 应把整组 references 投影为一个 context entry：

```ts
interface DemoRuntimeInput {
  message: DemoMessage;
  parameters?: RunAgentParameters;
}

function toRuntimeInput(
  item: QueueItem<DemoSubmission>,
): DemoRuntimeInput {
  return {
    message: {
      id: `${item.id}:input`,
      role: "user",
      content: item.payload.text,
    },
    parameters: {
      context: [{
        description: "addToChatReferences",
        value: JSON.stringify(
          item.payload.contextReferences ?? [],
        ),
      }],
    },
  };
}
```

相应地，BE Demo 的 Runtime input 类型从 `string` 调整为 `DemoRuntimeInput`，`createInputMessage` 返回 `input.message`，`DemoAgUiAgentSource` 使用同一 input 类型。`createChatRuntimeQueueTarget.toInput` 调用 `toRuntimeInput(item)`；Runtime Core、Queue Core 和 transport 不增加 Add to Chat 语义。

当前 WebSocket transport 会发送包含完整 `input` 的 `{ event: "run", input }`，SSE transport 会序列化完整 `RunAgentInput`。后端 `AgUiRunMapper` 已经解析 `input.context`，把 `addToChatReferences` JSON value 合并到 `ChatStreamRequest.context`；`DeepSeekStreamingChatService` 已经把非空 context 写入 system message。因此这条路径无需修改自定义 WebSocket/SSE wire protocol。

必须增加端到端验证，确认 reference 没有在以下任何一层被丢弃：

```text
Composer
→ SubmissionQueue item
→ Runtime queue target
→ Agent input
→ WebSocket/SSE request
→ Backend model context
```

## 9. 第三方 Renderer 接入

第三方能力分为两类。

### 9.1 同宿主 React Renderer

第三方 React Renderer 不需要 import Add to Chat，也不需要包裹自身内容。宿主在 `resolveSource` 中读取该 Renderer 已有的稳定 DOM 属性：

```tsx
function OrderDetails({ order }: Props) {
  return <article data-order-id={order.id}>{/* existing content */}</article>;
}

const adapter = createDomSelectionAdapter({
  getSelectionRoot: () => existingWorkbenchElement,
  getReferenceHost: () => existingComposerReferenceSlot,
  resolveSource: ({ startElement }) => ({
    type: "order",
    targetId: startElement
      .closest("[data-order-id]")
      ?.getAttribute("data-order-id") ?? undefined,
  }),
});
```

如果 Renderer 连稳定属性也不能增加，业务可以在 `resolveSource` 中使用自身已有 DOM 到业务 ID 的映射。这个适配逻辑属于宿主，不进入 Renderer。

### 9.2 远程或非 React Renderer

远程 ESM、Web Component、Vue、Svelte 或 Worker 不导入宿主 React 组件。它们通过 scoped Plugin API 上报统一 Selection：

```ts
interface RendererSelectionAPI {
  setSelection(selection: AddToChatSelection | null): void;
}
```

或者由 Renderer Handle 暴露：

```ts
interface WorkbenchRendererHandle {
  getSelection?(): AddToChatSelection | null;
  subscribeSelection?(
    listener: (selection: AddToChatSelection | null) => void,
  ): () => void;
  dispose(): void;
}
```

宿主把这些 selection 统一接入同一个 AddToChat Controller。浮动 Action、Reference List 和发送链路只实现一次。

## 10. 与 Chat Turn Navigation 一致的设计原则

| Chat Turn Navigation | Add to Chat |
| --- | --- |
| Runtime 投影 NavigationItem | Renderer 投影 ContextReference |
| NavigationStore | AddToChatStore |
| `useChatTurnNavigation()` | `registerAddToChat()` |
| `ChatViewportAdapter` | `AddToChatSelectionAdapter` |
| `ChatTurnNavigationRail` | Registry 托管的 Add to Chat View |
| Runtime 不处理滚动 | Runtime 不处理 selection/context draft |
| 业务提供 Preview | 业务提供 Reference source/metadata |

共同原则：

- 插件是可选 View Enhancement。
- Runtime Core 零改动。
- Store 和 Controller 有明确生命周期。
- 业务数据通过公共契约投影。
- 宿主拥有 Portal、Composer 和发送流程。
- 第三方不取得 Runtime 内部对象。

## 11. Accessibility 与交互

- Action 使用原生 `button`。
- 按钮文案和 `aria-label` 明确说明添加的是当前选区。
- Reference 删除按钮包含数据源序号或标题。
- 键盘选区同样可以触发 Action。
- Escape 只关闭当前 selection，不删除已添加 references。
- 点击 Add 后清理浏览器原生选区。
- Action 不进入 transcript 的 ArrowUp/ArrowDown 焦点状态机。
- Portal 应挂在宿主 overlay root，避免被消息区域 `overflow` 截断。

## 12. 性能与清理

必须满足：

1. 页面只挂载一个共享浮动 Action。
2. 每个 Controller 只拥有一个 Store。
3. Streaming token 不重建已添加 references。
4. Selection 几何更新按 animation frame 合并。
5. Adapter root 变化或插件卸载时撤销临时 selection。
6. Controller 销毁时清理事件监听、frame 和 subscriptions。
7. Store 不持有 DOM 引用。
8. Reference List 使用稳定 ID，不使用数组 offset 作为身份。

## 13. 第一阶段范围

第一版实现：

- `ContextReference` 和 Selection contracts。
- 每个注册实例独立的 `AddToChatStore`。
- 内部 `AddToChatController`。
- DOM Selection Adapter。
- 框架无关、应用启动时调用一次的 `registerAddToChat()`。
- Capability Registry 托管的替换与销毁生命周期。
- 通过 Portal 渲染的单例浮动 Action 和 Composer Reference List。
- 多引用追加和独立删除。
- 宿主 Submission reference 快照。
- 一个原生聊天 Renderer 示例。
- Store、Adapter、Plugin、列表和发送投影测试。

第一版不实现：

- 远程 ESM loader。
- iframe selection 桥接。
- 跨多个 selection root 的选区。
- Reference 持久化和跨会话恢复。
- 自动摘要或 token 截断。
- Agent 特定的 prompt 拼接规则。

## 14. 验收标准

1. 未安装/未挂载插件时，Chat Runtime 行为完全不变。
2. 一个页面存在多个 Runtime 时，references 不串数据。
3. 添加两次 selection 后出现两个独立 reference。
4. 删除一项不影响其余 reference，也不修改输入框。
5. Reference 可以携带稳定的 message/turn/branch/plugin source。
6. Submission 获取不可变 reference 快照。
7. 入队失败保留 references，成功入队后宿主可以清空。
8. Agent 请求端能观察到完整 references，不能只停留在 Demo UI。
9. 第三方 Renderer 可以只通过 selection 协议接入，不依赖 React。
10. 插件销毁后不存在 document listener、Portal 或 Store subscription 泄漏。
11. 插件不作为 `ChatRuntimeView`、消息内容或 Composer 的父组件，不改变现有内容树层级。
12. 未调用 `registerAddToChat()` 时，页面没有该功能及任何相关副作用。
13. React 页面不渲染 Add to Chat JSX，也不包含 Add to Chat `useEffect()`。
14. 使用同一注册 `id` 重复执行时不产生重复监听、按钮或引用列表。

## 15. 对当前仓库的具体改动

### 15.1 新增插件实现

新增 `src/core/chat/plugins/add-to-chat/`，包含：

- 公共 selection/reference/registration contracts。
- 同时保存 selection 和 references 的 `AddToChatStore`。
- 创建并管理实例 Store 的 Controller。
- 支持同 ID 原子替换和销毁的 `registerAddToChat()`。
- DOM selection adapter、浮动 Action、Reference List、Portal 和样式。
- `index.ts` 公共导出。

新增通用 Chat View Plugin Registry/Host。它属于插件基础设施，不写入 `ChatRuntimeSnapshot`；负责 registration activate/dispose、等待 DOM target、重挂载和 HMR 替换。

### 15.2 当前 Runtime View 不改结构

以下现有 DOM 已满足 selection source 解析：

- `ChatRuntimeView` 的 `.crt-runtime`。
- `TurnView` 的 `data-turn-id`。
- `BranchView` 的 `data-branch-id`。
- `FrameListItem` 的 `data-frame-id`。

因此不新增 Selection Boundary，不包裹 Message Card，不修改 Renderer API。第一阶段 reference source 使用 frame/turn/branch ID；如果以后必须精确到一条 message，再单独设计无 wrapper 的 message identity contract。

### 15.3 Composer 增加通用插槽

Demo Composer 在输入框上方增加一个空的、产品无关的 extension slot：

```tsx
<div data-chat-reference-host />
```

它只作为 Portal target，不 import Add to Chat，也不持有 references 状态。现有手写的单条 `compareReference` UI 删除，改由插件渲染多条 reference。

### 15.4 应用启动注册一次

新增业务注册模块，例如 `src/chat/demo/addToChat.register.ts`，并由 `src/main.tsx` side-effect import。React 页面中不新增 Hook 或 effect。

多个 Demo Runtime 使用不同注册 ID 和 DOM scope；插件 Registry 为每个 ID 创建独立 Store：

```text
compare-chat -> add-to-chat/compare-chat/references
single-chat  -> add-to-chat/single-chat/references
```

### 15.5 Submission 改为多引用

Demo 的 `DemoSubmission` 将单值 `referencedMessageId?: string` 升级为：

```ts
contextReferences?: readonly ContextReference[];
```

Composer 发送时读取当前注册 ID 的不可变快照。Runtime queue target 和 Agent adapter 必须继续传递该数组；成功入队后清空当前 ID，失败时保留。

如果旧的 Chat from here 仍需兼容，可在业务 adapter 中把旧字段投影成一个 `ContextReference`，不把兼容逻辑放入 Runtime Core。

### 15.6 公共导出与测试

从 `src/core/chat/index.ts` 导出 Add to Chat contracts 和 registration API。

新增测试覆盖：

- 同 ID 重复注册不会重复挂载。
- 不同注册 ID 的内部 Store 数据隔离。
- 多次 Add 追加而非覆盖。
- 选区只能来自对应 `.crt-runtime`。
- Portal 渲染到对应 Composer slot。
- 删除单项及发送成功清空。
- DOM 重挂载后重新绑定。
- Registry dispose 后没有 listener、observer、Portal 或 subscription 泄漏。

### 15.7 明确不修改

以下模块不需要为该功能增加业务逻辑：

- `BaseChatRuntime`、`SingleAgentRuntime`、`CompareChatRuntime`。
- `BranchMessageHub`、`RuntimeFocusController`。
- Message Renderer 和 Markdown Renderer。
- `ChatRuntimeSnapshot`、Turn、Branch 和 Message contracts。
