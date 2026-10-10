---
name: frontend-feature-boundaries
description: Design or refactor frontend modules around complete features, encapsulate feature-owned state and data access, simplify component APIs, and merge unnecessary wrappers. Use for requests about module boundaries, component over-splitting, prop drilling, or feature-based architecture; not for routine styling or isolated fixes that do not involve these boundaries.
---

# 按功能封装前端模块

把完整业务能力封装在模块内部，只暴露真正必要的交互。重点降低理解和接入成本，不以文件数、代码行数或层次数量作为质量指标。

遵守目标项目的 AGENTS.md、实际入口和用户指定的架构。以下是边界决策方法，不是要求所有项目采用固定目录、状态库或组件模板。

## 先确定职责，再决定文件

阅读当前任务涉及的入口、组件调用链和数据操作，判断谁拥有业务状态、谁只负责展示、谁负责模块间组合。只检查与请求相关的范围。

为需要调整的模块明确：

- 它完成哪个完整业务职责。
- 哪些数据、计算、校验和生命周期应由它内部维护。
- 哪些参数与回调确实来自其他模块，不能合理地放在内部。

不能说明独立职责的透传组件、改名转调方法或生命周期包装，优先考虑合并。不要把“模块一体化”理解成把所有页面逻辑塞进一个巨型组件。

## 按功能拥有状态和能力

- 布局/路由宿主选择展示哪个模块，不替各业务模块初始化控制器、查询详情或组装业务依赖。
- 会话目录、配置管理、聊天页、输入框等可以是不同模块；每个模块维护自己的业务状态和计算。
- 业务模块可以内部调用数据接口，也可以内部组合纯展示组件；纯展示组件仍可通过 props 接收数据，不要求所有组件自己发请求。
- UI、交互逻辑、数据访问保持职责分离。根据实际规模决定是否分文件，不强制创建 hook、controller、repository interface 和 DTO 四套结构。
- 共用机制只抽取已有的真实复用部分。特定功能的计算不因可抽取就变成全局公共服务。
- 应用级共享配置可以使用既有数据层共享；不要用新增全局变量或隐藏的 service locator 取代明确的依赖。会话实例和应用级数据不能混用生命周期。

## 收敛模块的公共接口

公共接口表达业务意图，优先采用必要的 ID、消息/表单提交数据及回调。不要要求接入者了解和组装模块全部内部对象。

例如，一个自行加载历史并初始化运行环境的聊天页，可以接收 `sessionId`；不应同时要求调用方传入历史、数据仓库、控制器、配置工作区和菜单目录。输入框可以输出结构化提交数据，不必知道聊天 Runtime 的实现。

但不要机械地禁止依赖注入：当宿主明确需要切换数据源、权限或运行环境时，使用项目已有的窄接口即可。不要只为未来可能替换实现而增加整套注入框架，也不要把多个无关依赖装进一个对象后宣称接口已简化。

异步加载、订阅和实例清理由实际拥有者负责。收拢代码时仍需保证过期请求不更新当前页面、数据不会串会话、资源能释放；不要用包装层数量代替生命周期正确性。

## 合并与删除

在用户授权的改动范围内实施，避免把结构整理扩展成技术栈或领域协议重写。

- 将仅在一个功能内使用的小计算、私有类型和辅助逻辑收回该功能内部。
- 保留承载完整业务职责或真实共享能力的组件；不要为减少文件数破坏有意义的边界。
- 替换旧实现后，检查调用、路由、导出、动态注册与文档，再删除无用组件、hooks、类型、样式和测试。
- 不保留用户未要求的兼容包装；不删除仍有使用方的公共能力或无关用户改动。
- 能在业务层完成的功能，不为便利或 mock 数据额外改动通用 core。

## 验证与交付

按改动风险选择验证，不强制每次执行全量测试。优先验证公共接口和业务行为：模块能否使用必要入参独立接入，切换/卸载是否正确，异步数据是否隔离，已有交互是否保持。

简要说明最终职责归属、收敛的入参、已删除的中转层和验证结果。若更新项目设计文档，修正矛盾的旧描述，不另建重复设计说明。

## 架构名称与参考

这类设计通常称为按功能组织的模块化架构（feature-based modular architecture）；高内聚、低耦合与信息隐藏是其边界原则。它不等同于微前端，也不要求采用完整的 Feature-Sliced Design 分层。

用户要求对照开源实现时再查阅这些一手材料；一般重构不需要联网：

- [VS Code Source Code Organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization)：Workbench 功能的内部实现与公开接口边界。
- [Bulletproof React Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)：按功能集中代码，按实际需要设置内部目录。
- [Theia Widgets](https://theia-ide.org/docs/widgets/)：布局宿主与功能视图的职责分离。

参考其边界原则，不把这些项目的 DI、贡献注册或插件框架自动引入用户项目。
