# Workbench Design Tokens

`tokens.css` 是中性灰白工作台主题的唯一基础值入口，不在每个功能页面维护配色副本。

- 原始值：`--color-neutral-*` 调色板。
- 语义值：`--ui-surface`、`--ui-text`、`--ui-border`、`--ui-primary` 等。
- 基础尺度：`--ui-space-*`、`--ui-text-*`、`--ui-weight-*`、`--ui-leading-*`、`--ui-radius-*`、字体、阴影、焦点与禁用状态。

页面、Skill 编辑器、输入框、两级菜单、工具弹窗只引用语义 tokens。组件 CSS 保留布局、尺寸限制与断点，不为每个几何尺寸额外创建一个 token。

```css
.panel {
  background: var(--ui-surface);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  padding: var(--ui-space-4);
}
```

纯色/阴影调整集中修改 tokens；业务布局只改对应模块。输入框中的能力引用使用蓝色语义 tokens，不与主按钮颜色绑定。

`core/tools/index.ts` 引入基础 tokens；独立使用时也可在应用入口显式导入 `src/theme/tokens.css`。未来主题覆盖可在宿主根节点重定义语义 tokens，不改组件。

旧 demo 复用的消息卡片只在新工作台 `.page` 范围内覆盖；原 demo 的全局配色不改。

回归测试 `test/theme/tokens.test.ts` 检查业务模块不散落颜色值，并检查所有引用 tokens 均有定义。

2026-10-03 收尾：原页面零散的间距统一归并到 2/4/8/12/16/20/24/32 px 尺度，较大的空状态间距使用 64 px；字重和行高也集中维护。保留视口高度、内容最大宽度等布局约束，不将每个业务尺寸变成主题 token。
