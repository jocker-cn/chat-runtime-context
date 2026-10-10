# 前端模块设计与修改准则

适用于本项目的前端设计、实现和重构。采用按功能组织的模块化设计（Feature-based Modular Architecture）：模块内部高内聚，对外只提供必要的业务接口。目标是降低接入和阅读成本，不是增加层次，也不是单纯减少文件数量。

## 模块边界

- 按完整业务职责拆分，例如配置管理、Session 列表、聊天页、输入框。不要按代码长度，或仅按 state / hook / controller / helper 等技术类别拆分业务。
- 模块尽量在内部完成自己的数据读取、计算、校验、状态和生命周期管理。只有真正跨模块的交互才成为组件入参或对外能力。
- UI、交互逻辑和数据访问保持职责分离，但不强制每层一个文件、一个接口或一个包装组件。小型私有实现可以放在业务模块内。
- 允许抽取已有实际复用价值的纯 UI 或业务机制。不要为猜测中的复用、BE 接入或兼容需求提前建立框架。
- 不能通过把所有依赖塞进一个 options 对象，或转移到隐式全局状态，来假装减少耦合。应用级共享数据与会话级 Runtime 的生命周期必须明确区分。

## 当前工作台的职责归属

- `ExtensionPocLayout`：布局、当前 Session / 功能页切换、必要的离开确认；不初始化聊天 controller/runtime，不查询消息历史，不组装菜单业务数据。
- `ExtensionPocSidebar` / 内部 Session 列表：功能导航和会话目录；列表自己维护加载、新建、标题更新与错误，不缓存聊天页或 Runtime。
- `AgentSettings`、`SkillSettings`、`McpSettings`、`PluginSettings`：各自维护配置页面的内容和业务状态；共用的目录/表单/CRUD 只作为配置模块内部机制。
- `ExtensionPocPage`：接收 `sessionId`，内部查询历史、管理 controller/runtime、A/B 开关、引用和导航；组合消息区、输入框等聊天区域。
- `ChatRuntimeView` / `ChatTurnNavigationRail`：直接复用既有 core 能力，不建立只为中转的消息区或导航包装层。
- Message Card：使用消息与既有渲染上下文；额外业务交互通过 RuntimeView 的 extensions/store 提供，不直接暴露页面 controller/runtime 给 Card。
- `ExtensionComposer`：内部维护 Tiptap、工具菜单、选中能力、预览和 invocation；对外只保留发送、引用展示/清除/定位等必要交互。
- 数据层：按 `sessionId` 查询历史；只保存可传输的数据，不保存 React 组件、controller 或 Runtime。接 BE 时替换数据操作，不重写页面组装方式。

上述名称描述当前落地位置，不要求未来沿用相同文件名或为每个组件新建文件。

## 本项目的约束

- 后续业务迭代以 `/extension-poc` 为入口；不主动扩展旧 demo 页面。
- 聊天页不要求接入方先组装 `history`、`repository`、`workspace`、`catalog`、`skills` 再传入。配置模块与输入框需要的共享配置，通过既有配置数据模块获取。
- 当前只挂载一个 Session 的聊天页，不维护 controller Map，也不把所有会话挂载后隐藏。切换配置页保留当前聊天；切换 Session 按数据查询恢复历史并释放旧 Runtime。
- 历史展示遵循第一 Agent 的主历史路径；当前 mock 为 A/B 都初始化上下文，不为 mock 扩展 core 的历史协议。
- 业务层可以完成的功能不要下沉 core。确需修改 core 时，先指出缺失的通用能力和影响范围，再做最小改动。
- 保留消息引用定位、导航轨、分支错误处理、A/B 开关与队列语义，不能以简化结构为由改变既有行为。

## 合并、删除与验证

- 新增模块或抽象前，说明它拥有的业务职责以及减少了什么理解成本；仅透传参数、改名转调或包装生命周期的层优先合并。
- 重构时同步清理被替代的组件、hooks、类型、导出和过时测试；先检查路由、公开导出、注册入口与实际调用，不能只凭单次搜索没有引用就删除。
- 不为旧设计保留未要求的兼容层；也不删除无关页面、用户改动或仍有使用方的公共能力。
- 验证最小入参可独立使用、异步结果不会串 Session、切换与卸载正确清理资源，以及本次涉及的业务交互。用行为测试验证边界，不靠文件数或代码行数证明设计合理。
- 设计发生实质变化时同步更新 `CHAT_TURN_NAVIGATION_DESIGN.md`，移除与实现矛盾的旧描述。

需要系统地设计或审查模块边界时，可使用项目内的 [$frontend-feature-boundaries](.agents/skills/frontend-feature-boundaries/SKILL.md) Skill。Skill 提供执行方法，本文件约束项目内的实际职责和行为。
