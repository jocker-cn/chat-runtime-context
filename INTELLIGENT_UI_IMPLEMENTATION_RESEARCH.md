# LLM 交互式 UI 实现机制研究总结

- 整理日期：2026-10-18
- 研究对象：GPT-6 / ChatGPT Intelligent UI、DIL、OpenUI、Codex 公开源码。
- 当前范围：理解实现机制、整理证据；不修改现有业务渲染方案。
- 本文件记录本轮讨论和核查结果。产品、文档和仓库会继续变化，后续结论应以对应版本为准。

## 1. 背景与讨论重点

现有业务通过 Markdown fenced code block 返回组件：

- code block 的语言名作为组件 key。
- block 内容作为组件渲染数据。
- UI 识别后映射到已有组件。

本轮不讨论如何改造这套方案，重点研究：

1. 模型如何描述可交互 UI。
2. 描述语言如何被解析、编译、执行和渲染。
3. 流式生成期间如何处理未完成内容。
4. 组件位置、数据到达与用户状态如何分离。
5. 复杂参数如何表达，以及模型如何获知组件契约。
6. OpenUI 和 Codex 公开实现能提供哪些参考。

关于“顺序”的实际关注点：某个位置的组件是否必须随文本在该位置一次完整返回，还是可以先表达结构或位置，后续独立补充内容。它不等于网络传输是否有序。

## 2. 证据分层

| 证据 | 能说明什么 | 不能直接推出什么 |
| --- | --- | --- |
| OpenAI 官方产品说明 | 原生、可流式组件库和编译器的总体方向；模型经过相关训练 | DIL 完整规范、内部解析器源码、Codex 采用同一实现 |
| OpenUI 的逆向分析文章 | 作者观察到的 ChatGPT Web 源码、编译结果、消息更新和运行时行为 | 所有客户端、所有回答和未来版本均采用相同行为 |
| OpenUI 官方文档及公开源码 | OpenUI Lang 的解析、解释执行和组件渲染机制 | OpenUI Lang 等于 DIL，或所有 demo 使用完全相同路径 |
| Codex 官方公开仓库 | 特定提交中的协议、终端降级展示和 HTML 包装实现 | 桌面端完整前端已公开，或公开代码覆盖全部产品内部机制 |

主要来源：

- [OpenUI：How ChatGPT Intelligent UI works](https://www.openui.com/blog/how-chatgpt-intelligent-ui-works)
- [OpenAI：GPT-6 and Intelligent UI for everyone](https://openai.com/index/gpt-6-for-everyone/)
- [OpenUI Lang 文档](https://www.openui.com/docs/openui-lang)
- [Codex 官方仓库](https://github.com/openai/codex)

## 3. GPT / DIL：目前能确认的机制

按逆向文章，模型生成 DIL；服务端编译；客户端隔离运行时执行程序并生成 UI 更新操作；宿主渲染组件。

```text
模型：DIL 源码
    ↓
服务端：解析、校验、恢复未完成内容、编译
    ↓
程序 + 文本常量 + 外部数据
    ↓
客户端运行时：执行、状态管理、组件树比较
    ↓
宿主：应用 UI 更新操作、显示组件
```

DIL 组合 Markdown、组件标签、JavaScript 语句和表达式。Markdown 并未被完全舍弃，而是进入统一编译过程。文章还观察到 Markdown 降级内容。

组件目录约束可使用的组件、属性和设计 token；部分数据通过服务端绑定提供；事件函数保留在运行时，以标识与宿主通信。

这些是逆向文章中的观察，不是已公开的完整语言规范。所有普通回答是否经过 DIL、Codex 是否采用同一链路，尚未确认。

参考：[原文](https://www.openui.com/blog/how-chatgpt-intelligent-ui-works)。

## 4. 如何理解 `{@body ...}`

讨论中的例子：

```text
{@body const price = seats * 29}
```

以下是用标准编译技术解释其含义，不是对 OpenAI 内部解析器的源码还原。

### 4.1 两层语法

- DIL 外层识别“这里是一段逻辑声明”。
- JavaScript 内层解析变量声明和表达式。
- 编译器把声明组织到生成的渲染作用域。
- 运行时执行后才得到数值。

概念性语法树：

```text
变量声明：const
└─ 变量：price
   └─ 初始化表达式：乘法
      ├─ 变量：seats
      └─ 数字：29
```

解析只识别结构，不计算价格。若用 Babel 实现类似语言，声明应使用程序或语句解析入口，单个插值表达式可使用表达式入口；这不代表 OpenAI 使用 Babel。

参考：[Babel Parser](https://babeljs.io/docs/babel-parser)。

### 4.2 作用域与重新计算

下面只是普通 JavaScript 的解释用示意：

```js
function renderResponse() {
  const seats = readCurrentState("seats");
  const price = seats * 29;
  return createNode("title", {}, price);
}
```

`readCurrentState` 和 `createNode` 是虚构名称，不是 DIL API。

当外围运行时因状态变化再次执行函数时，`price` 会重新求值。`const` 声明本身不具备监听能力。单凭这种行为，不能推断系统一定使用了细粒度依赖图。

### 4.3 解析边界

实现类似外层语法时，不能仅用正则寻找第一个右花括号：内部可能包含对象、字符串、注释或模板字符串，需要识别词法上下文。

未完成输入不等于可执行程序。例如乘法右操作数尚未生成时，系统需要暂缓该结构，或采用明确的恢复规则。语法可恢复也不保证业务含义正确。

## 5. 流式 UI、Markdown 与 Content Parts

应区分三个层次：

| 层次 | 职责 |
| --- | --- |
| 消息内容单元 | 表达一条消息包含哪些内容 |
| 消息字段更新 | 表达源码、程序或数据发生哪些变化 |
| UI 树及节点更新 | 表达哪些组件存在、放在哪里、如何变化 |

DIL 源码仍然有顺序要求。它与单纯 Markdown 文档的差异，主要来自编译恢复、可更新程序和运行时维护的界面，而不是“文本可以任意乱序执行”。

此前把“有序 Content Part 序列”当作 GPT Intelligent UI 已确认具体实现，证据不足。逆向文章没有证明每个组件对应独立的 UI Part。

Markdown 本身也并非要求所有语法都闭合才可展示，例如 CommonMark 允许未闭合代码围栏延伸到文档末尾。但这不意味着其中的 JSON 或程序已经可以执行。

参考：[CommonMark fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)。

## 6. OpenUI：公开了哪些类似能力

OpenUI 公开主线使用自己的 **OpenUI Lang**。没有证据表明公开 SDK 就是 ChatGPT 的 DIL 编译器。

### 6.1 公开实现链路

```text
组件定义与参数 schema
    ↓
生成模型提示词
    ↓
模型输出 OpenUI Lang
    ↓
解析为语法树和组件描述
    ↓
解释器求值、状态与动作处理
    ↓
框架渲染器映射到已注册组件
```

常规 React 路径在浏览器解析并运行语言，与 GPT 逆向文章描述的服务端编译路径不同。

参考：[概念总览](https://www.openui.com/docs/openui-lang/overview)、[架构](https://www.openui.com/docs/openui-lang/architecture)。

### 6.2 实际支持的能力

| 能力 | 对应机制 |
| --- | --- |
| 组件组合 | 命名语句、组件调用和引用 |
| 流式展示 | 处理部分输入，后续定义到达后解析向前引用 |
| 本地状态 | `$变量` 和输入绑定 |
| 计算逻辑 | 表达式、内置函数和注册函数 |
| 用户动作 | `@Set` 等动作和自定义动作 |
| 数据读写 | `Query`、`Mutation`、宿主提供的工具 |
| 修改已有界面 | 按语句名称合并补丁 |

解释用示例：

```text
root = Stack([price, plus])
$seats = 8
price = TextContent("每月费用：" + $seats * 29)
plus = Button("增加一人", @Set($seats, $seats + 1))
```

该例用于说明语言分工，未在当前项目安装或运行。

参考：[Renderer](https://www.openui.com/docs/openui-lang/renderer)、[Reactive State](https://www.openui.com/docs/openui-lang/reactive-state)、[Functions](https://www.openui.com/docs/openui-lang/functions)。

### 6.3 源码中核查到的细节

- [parser.ts](https://github.com/thesysdev/openui/blob/main/packages/lang-core/src/parser/parser.ts)：词法分析、语句拆分、表达式解析、引用及组件结果构建；流式解析器缓存已完成语句，对末尾未完成语句处理自动闭合。
- [evaluator.ts](https://github.com/thesysdev/openui/blob/main/packages/lang-core/src/runtime/evaluator.ts)：按 AST 节点解释状态引用、运算、条件和调用。
- [Renderer.tsx](https://github.com/thesysdev/openui/blob/main/packages/react-lang/src/Renderer.tsx)：React 渲染入口。

上述链接指向 main，后续可能变化。这里核查到的是自定义 AST 的解释执行路径，不是把全部模型输出作为任意 JavaScript 执行。

### 6.4 增量编辑的边界

初次生成时的流式解析，与后续补丁合并不是同一问题。官方增量编辑示例等待补丁流结束后再合并，以免未完成的根结构导致旧内容被删除。

参考：[Incremental Editing](https://www.openui.com/docs/openui-lang/incremental-editing)。

## 7. 模型如何学习语法：提示词与 Skill

| 形式 | 使用对象 | 目的 |
| --- | --- | --- |
| 开发用 Skill | Codex 等编码 Agent | 指导开发者接入或开发 OpenUI |
| 业务运行时提示词 | 后端调用的业务 LLM | 说明输出语言、组件签名、参数和规则 |

OpenUI 可以根据组件定义生成模型提示词。安装开发 Skill 不会自动让业务 API 请求携带这些规则。

职责分工：

- 提示词和训练：帮助模型生成合适内容。
- 解析与校验：检查语法、引用和参数契约。
- 运行时：执行状态、计算和动作。
- 渲染器：展示实际组件。

OpenAI 官方说明 GPT-6 接受了使用组件库、组织界面和交互方面的训练。不能假设给通用模型提供相同语法说明，就能得到同等稳定性。

## 8. 复杂参数：已知能力与未解决问题

需要区分复杂度来源：

| 来源 | 可以如何分担 |
| --- | --- |
| 大量业务记录 | 在支持绑定的位置引用数据，避免模型重复搬运 |
| 布局与展示配置 | 仍需模型理解契约并生成配置 |
| 状态与事件 | 由运行时维护和绑定 |
| 复合组件内部细节 | 由预先实现的组件承担 |

这是架构层面的分析，不是对现有业务方案的改造建议。

DIL 或任何 DSL 都不会自动消除大量参数的复杂度：

- 能表达复杂对象，不等于模型能稳定填写。
- 类型正确，不等于指标选择和计算含义正确。
- 数据引用减少搬运，不替代配置决策。
- 模型生成、解析校验和业务正确性需要分别评估。

尚未确认 GPT 的完整组件契约如何进入上下文、是否按需提供、如何处理大量嵌套参数，以及诊断是否反馈给模型。

## 9. Codex 官方仓库核查

### 9.1 核查范围与结果

- 仓库：[openai/codex](https://github.com/openai/codex)
- 核查日期：2026-10-18
- 提交：`8c076942cb70fba8e5c4732c23f1faabc4aed484`
- 检查完整目录树，并下载该提交归档进行内容检索；扫描约 9,283 个文件，跳过部分媒体及超大文件。
- `DIL`、`model_dil_v2`、`__dil`、`{@body`、`Skybridge` 未命中。

未命中限定于本次公开源码检索，不能证明未公开的桌面产品内部不存在这些机制。

没有在该仓库找到桌面端完整消息渲染前端。找到的直接相关代码主要是 **终端可视化降级处理**、HTML 浏览器包装和协议。

### 9.2 可视化引用解析

源码：

[inline_visualization.rs](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/tui/src/inline_visualization.rs#L174)

`rewrite_inline_visualizations()` 处理专用可视化引用和 `::codex-inline-vis{…}` 指令：

- 提取 HTML 文件路径。
- 跳过 Markdown 代码块里的指令。
- 校验文件路径并生成浏览器打开链接。
- 无法读取时显示不可用提示。

这里解析的是 **HTML 文件引用**，不是 DIL 组件树。

### 9.3 HTML 片段包装和隔离

源码：

[inline_visualization/viewer.rs](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/tui/src/inline_visualization/viewer.rs#L58)

`render_fragment()` 将 HTML 片段放入模板，加入样式、脚本和 CSP，再通过 `srcdoc` 放进 `sandbox="allow-scripts"` 的 iframe。

配套脚本：

[assets/inline_visualization/visualize.html](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/tui/assets/inline_visualization/visualize.html)

公开链路：

```text
Agent 写入 HTML 片段
    ↓
回答包含专用文件引用
    ↓
终端识别引用、检查路径、读取文件
    ↓
加入公共样式和运行脚本
    ↓
生成带 CSP 的 sandbox iframe 页面
    ↓
提供浏览器打开链接
```

这是终端降级实现，不是桌面端内嵌消息卡片的完整源码。

### 9.4 Content 数组的实际含义

源码：

[protocol/src/items.rs](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/protocol/src/items.rs#L124)

`AgentMessageItem` 使用 `Vec<AgentMessageContent>`，但该提交的 `AgentMessageContent` 只有文本类型。

因此：

- “消息有 Content 数组”有源码依据。
- “每个 Content Part 对应可交互组件”没有从该类型得到证明。
- 可视化引用可以存在于文本中，再由展示层识别。

底层 Responses 协议还有其他内容类型，应与上述 Agent 消息类型分开讨论：

[protocol/src/models.rs](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/protocol/src/models.rs#L821)

### 9.5 MCP App UI 是另一条路径

源码说明：

[app-server/README.md — MCP App UI](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/app-server/README.md#L75)

工具调用可以携带 UI 资源地址和 inline / fullscreen 显示偏好；信息进入事件和历史，由客户端处理。

这是“工具关联 UI 资源”的机制，不能与“Agent 生成 HTML 文件”或“DIL 编译原生组件”合并为同一个实现。

### 9.6 当前能支持的判断

| 机制 | 本次公开源码证据 |
| --- | --- |
| HTML 可视化引用解析 | 有 |
| HTML 沙箱页面包装 | 有 |
| MCP 工具关联 UI 资源 | 有协议说明 |
| Agent 消息 Content 数组 | 有，此处内容类型只有文本 |
| 桌面端完整内嵌渲染器 | 未找到 |
| DIL 编译器、隔离执行和原生组件更新协议 | 未找到 |

## 10. 后续研究方向

1. 复杂组件的契约如何提供给模型：全部注入、按需发现，还是其他机制。
2. 流式输入如何恢复，以及什么时候提交一个可显示版本。
3. 组件身份、模型生成配置与用户操作状态如何协调。
4. 源码引用、数据绑定和组件位置如何解耦。
5. 补丁更新如何保持旧界面可用，失败时如何回退。
6. 结构校验、运行错误和业务语义错误如何分别处理。

研究时应持续标注“官方确认”“逆向观察”“源码证据”和“解释性推断”，避免把一种合理架构当作某个产品的已验证内部实现。
