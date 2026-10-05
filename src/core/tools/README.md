# 独立工具入口机制

工具不是输入框的子功能。这里不依赖 ChatRuntime、Tiptap、扩展目录结构或 Workbench。

## 职责

- `toolRegistry.ts`：普通 TypeScript 注册表，管理 POJO 描述和执行回调。可由 React、业务模块或插件注册。
- `toolReact.tsx`：类型化 Provider 和 Hooks，负责注册生命周期、订阅列表、调用行为。
- `ToolList.tsx`：纯展示列表；可放在弹窗、页面或其他容器中，不访问 Registry。
- `toolMenuContracts.ts` / `useToolMenu.ts` / `ToolMenu.tsx`：可选两级菜单；分类导航、子项搜索和展示与工具注册、输入框解耦。
- `ToolPresentation.tsx`：可选公共 Dialog 容器；工具提供 React 内容组件和业务按钮。

已有 `core/capability` 负责按 market/version 解析函数或组件实现；本模块负责用户可发现、可选择的工具入口。两者不相互替代，也不使用全局单例。

## 接入：创建一次绑定，工具组件注册，入口组件调用

应用在模块顶层定义自己的能力类型和 React 绑定。不要在组件渲染期间创建绑定。

```tsx
import { useState } from "react";
import {
  createToolRegistry, createToolReactBindings, ToolList,
  ToolPresentationProvider, useToolPresentation,
  type ToolPresentationAPI,
} from "./index";

interface AppToolCapabilities {
  presentation: ToolPresentationAPI;
  // 后续迁移输入框时，增加可选 composer 适配器；不改 Registry。
}

const tools = createToolReactBindings<AppToolCapabilities>();

function AgentTool() {
  tools.useRegisterTool({
    definition: { id: "agent.configure", name: "选择 Agent", group: "Agent" },
    onSelect: ({ capabilities }) => {
      capabilities.presentation.openDialog({
        title: "Agent 配置",
        render: ({ close }) => <AgentConfigPanel onCancel={close} />,
      });
    },
  });
  return null;
}

// AgentConfigPanel 是业务方自己的组件，自己管理表单、确认和后续动作。
function AgentConfigPanel({ onCancel }: { onCancel(): void }) {
  return <button onClick={onCancel}>关闭配置</button>;
}

function ToolEntry() {
  const definitions = tools.useTools(); // 也可传搜索词
  const presentation = useToolPresentation();
  const launch = tools.useToolLauncher({
    source: "page-list", capabilities: { presentation },
  });
  const [error, setError] = useState("");
  return <>
    <ToolList tools={definitions} onSelect={(tool) => {
      void launch(tool.id).catch((cause: unknown) => setError(String(cause)));
    }} />
    {error && <p role="alert">{error}</p>}
  </>;
}

function App() {
  const [registry] = useState(() => createToolRegistry<AppToolCapabilities>());
  return (
    <tools.Provider registry={registry}>
      <ToolPresentationProvider>
        <AgentTool />
        <ToolEntry />
      </ToolPresentationProvider>
    </tools.Provider>
  );
}
```

`useRegisterTool` 接受内联对象和回调，不要求接入方手写 `useMemo`：元数据不变时不重新注册，回调始终使用最新已提交的组件状态。组件卸载时自动注销。

非 React 模块直接调用 `registry.register({ definition, onSelect })`，保留返回的清理函数，在模块/插件卸载时调用。注册 ID 必须唯一，重复注册立即报错；建议用 `module.action` 命名，一个模块可以注册多个入口。

## 工具选择弹窗和工具业务弹窗是两个独立过程

选择器可以复用公共 Dialog，但并不是必须：

```tsx
presentation.openDialog({
  title: "选择工具",
  render: ({ close }) => (
    <ToolList tools={definitions} onSelect={(tool) => {
      close(); // 关闭选择器由入口负责，不由 Registry 负责
      void launch(tool.id).catch(reportError);
    }} />
  ),
});
```

`/` 入口将来负责清理本次 `/查询词` 并关闭自己的菜单，再调用 `launch`；工具自己决定是否插入引用、展示输入框上方内容、打开公共 Dialog 或使用已有业务弹窗。

## 展示与数据边界

- `ToolDefinition` 只有描述字段，可以来自 Repository；不保存 JSX、函数、编辑器实例或弹窗句柄。
- `ToolRegistration` 和 `ToolDialogRequest` 是运行时对象，不持久化。React 内容通过 `render: ({ close }) => <FeaturePanel />` 直接组合，无需再建立一套 rendererId 注册表。
- `ToolExecutionContext` 的能力由入口提供，使用应用自己的 TypeScript 接口。可选能力由工具检查；没有输入框的入口不必伪造 Composer。
- `onSelect` 与 `onReferenceClick` 分离。没有注册引用点击行为时不执行任何动作，不回退到选择行为。
- 工具选择不自动插入引用，也不等同于 LLM tool execution。提交/调用 POJO 的组装仍由业务适配器负责。

## 第一阶段边界

- 公共 Dialog 同时只展示一个；新请求替换旧请求并重置内容状态。旧句柄不能关闭新的 Dialog。
- 容器处理遮罩关闭、Esc、焦点约束/恢复、页面滚动恢复和卸载清理。返回焦点目标已卸载时，入口负责提供自己的焦点策略。
- 工具内容负责确认、校验、请求和错误显示。公共层不强制所有内容拥有确认/取消按钮，不决定取消业务请求；异步操作的资源清理由业务组件负责。
- 列表外观可以用 `className` / `renderTool` 调整，也可完全自建列表，复用 `useTools` 和 `useToolLauncher`。
- 不实现 Dialog 堆叠、远程组件加载、权限沙箱、BE 执行或 Workbench。需要其他展示形式时增加独立 Host/能力，不修改 Registry。

现有 `/extension-poc` 已接入公共两级菜单展示；插入引用、预览和提交仍沿用原有业务逻辑。完整的 Registry 行为注册与 Composer 能力 Adapter 迁移仍是后续阶段。

## 可选两级菜单：分类与工具自己的详情

`ToolMenuEntry` 有两种形态：`action` 是可直接调用的入口，`group` 是只负责展开的分类。分类提供描述、子项、选择回调以及可选 `renderItem`；公共层不识别 Agent/Skill/MCP 等业务类型，也不读取原始字段。

```tsx
import { ToolMenu, useToolMenu, type ToolMenuEntry } from "./index";

function ServicePicker({ services, close, launch }: {
  services: Array<{ id: string; name: string; description: string; endpoint: string }>;
  close(): void;
  launch(id: string): void;
}) {
  const entries: ToolMenuEntry[] = [{
    type: "group",
    definition: { id: "services", name: "MCP", description: "选择已配置的服务" },
    items: services.map(({ id, name, description, endpoint }) => ({
      id, name, description, keywords: [endpoint],
    })),
    renderItem: (item) => {
      const service = services.find((entry) => entry.id === item.id);
      return <span><strong>{item.name}</strong><small>{service?.endpoint}</small></span>;
    },
    empty: "请先配置服务",
    onSelect: (item) => launch(item.id),
  }];
  const menu = useToolMenu({ entries, onClose: close });
  return <ToolMenu menu={menu} />;
}
```

- 进入分类不关闭菜单、不调用子项；选择具体子项先关闭，再交由该分类的 `onSelect` 处理业务。
- 没有 `renderItem` 时复用名称/描述默认行。自定义内容放在公共可选行内，不嵌套按钮；有独立交互需求时可自建展示层复用 `useToolMenu`。
- 根搜索可匹配分类及子项，但仍只展示分类；二级有独立搜索、返回和空状态。子项增多时列表内部滚动，不扩大输入框。
- `menu.handleKey` 可由输入框/快捷键入口代理：上下移动，Enter 选择，右键进入分类，左键返回；Esc 在二级返回，在一级关闭。二级搜索输入框保留左键移动光标的行为。
- 元数据仍是 POJO；`renderItem`、`onSelect`、JSX 只属于运行时展示贡献，不能写入 Repository。分类 ID 在菜单内唯一，子项 ID 在分类内唯一。
- 菜单不直接访问 Registry：子项可以投影自 `useTools()`，在 `onSelect` 中调用 `useToolLauncher()`；也可来自业务 Repository。分类本身不必注册成可执行工具。

POC 的 `extensionToolMenu.tsx` 是业务投影示例：MCP 展示 Endpoint，Skill 展示指令摘要，Agent 展示 Prompt/关联数量，Plugin 展示 Manifest。更换字段或详情组件只调整这一层，不修改公共菜单。当前 MCP 子项为本地配置的服务记录，不代表已从 BE 发现或执行服务端 tools。
