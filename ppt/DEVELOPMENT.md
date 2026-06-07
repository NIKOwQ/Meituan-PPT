# 交互式产品型 PPT 开发文档

## 1. 项目目标

这份 PPT 不是对项目做静态截图介绍，而是把真实前端作为主要讲解载体：

- 完整产品体验复用 `frontend` 的 HTML、CSS 和 JavaScript。
- `ppt/data` 模拟后端数据源，页面不依赖真实后端和网络。
- PPT 负责组织叙事、组件解释、异常说明和交互引导。
- 完整产品页优先保证可操作、可滚动和信息完整，不用说明浮层遮挡产品。

## 2. 目录与职责

```text
ppt/
├─ index.html                 # PPT 页面结构
├─ style.css                 # PPT 编排与讲解层样式
├─ deck-app.js               # 产品视口适配、讲解交互、异常实验室
├─ demo-api.js               # 数据适配与模拟后端接口
├─ DEVELOPMENT.md            # 本文档
├─ data/
│  └─ scenario-bundles.js    # 支持 file:// 的静态数据包
└─ product/
   ├─ index.html             # 复用的真实前端页面
   ├─ styles.css             # 真实前端原样式
   ├─ app.js                 # 真实前端交互逻辑
   ├─ embed.css              # 仅用于 PPT 嵌入的适配层
   ├─ offline-api.js         # 将 DemoAPI 翻译为原前端 API
   └─ controller.js          # setup/workspace/report 等演示状态控制

data/
├─ rider/                    # 骑手场景完整中间产物
└─ merchant/                 # 商家场景完整中间产物

scripts/
└─ build_ppt_data_bundles.py # 将 data 生成静态数据包
```

## 3. 产品嵌入规则

### 固定设计视口

真实前端统一按 `1440 × 720` 设计视口渲染。`deck-app.js` 根据产品框尺寸计算等比缩放：

```js
scale = Math.min(frameWidth / 1440, frameHeight / 720);
```

不要直接改变 iframe 的响应式宽度来挤压产品。产品内部布局应保持真实桌面状态，PPT 只负责整体缩放。

如某个页面确实需要不同设计尺寸，可在产品框上声明：

```html
<div
  class="live-frame"
  data-product-viewport
  data-design-width="1440"
  data-design-height="900"
>
```

### 空余区域底色

等比缩放可能在产品框中产生少量未占满区域。`.live-frame` 必须使用产品底色 `#f6f2e8`，不得使用白色，以免形成错误的“页面缺失”观感。

### 滚动规则

- iframe 固定为设计视口高度，真实前端文档允许纵向溢出。
- `product/embed.css` 控制 `body { overflow-y: auto; }`。
- 鼠标位于产品框内时滚动真实前端；位于 PPT 空白处时不应误触产品。
- 不要再次把嵌入页 `body` 改成 `overflow:hidden`。
- 产品已有的指令平面、报告详情等局部滚动仍保留。

## 4. PPT 布局规则

### 完整产品页

完整产品页使用独立网格行：

1. 标题或场景说明。
2. 完整产品框。
3. 简短说明条。

说明条不得使用绝对定位覆盖产品。常用结构：

```html
<section class="slide product-slide path-slide">
  <div class="path-title">...</div>
  <div class="live-frame workspace-frame" data-product-viewport>
    <iframe src="product/index.html?view=workspace"></iframe>
  </div>
  <div class="path-overlay">...</div>
</section>
```

对应网格容器必须设置：

```css
justify-content: stretch;
```

产品框必须设置：

```css
width: 100%;
min-width: 0;
height: 100%;
```

否则 iframe 的固有尺寸可能导致网格内容收窄。

### 组件聚焦页

组件聚焦允许只展示抽屉、证据卡或报告局部，但必须满足：

- 页面标题明确说明正在查看组件或信息层级。
- 背景中保留工作区上下文。
- 不把局部裁切伪装为完整产品页。
- 组件解释可以使用内置演示状态，但报告数字仍来自数据文件。

### 演示回放状态

工作区页可由 `controller.js` 进入演示回放模式：

- `view=workspace` 会加载 `rider-report.json` 并调用 `startWorkspaceReportReplay()`。
- 回放只用于 PPT 讲解，不改变报告原始数据。
- 外呼工位按每批 5 组对话展示；同一批 5 组完成后再进入下一批。
- 批次标签只显示当前批次，例如 `第 4 批`，不要显示总批次数；演示时系统不应表现为预知最终会有多少批。
- 左右切换按钮用于查看已经出现过的历史批次和当前批次，不负责跳到未来批次。
- 回放内部区分后台游标和前台查看批次：后台可以继续推进和保存数据，前台停在历史批次时必须保持固定；只有查看最后一个正在推进的批次时，页面才跟随刷新。
- 点击工位查看对话组时，历史批次保持快照；当前最后一批可以继续刷新该对话的最新轮次。
- 默认运行日志 `runHistory` 在回放模式下隐藏，避免覆盖工位和批次摘要。

评估专区在回放模式下必须表现为实时流水线：

- 同一时刻只有一个 segment 是 `评测中`。
- `评测中` 左侧的 segment 才显示最终通过、失败或无效状态。
- `评测中` 右侧的 segment 保持灰色待评测。
- 横向定位只调整评估条容器的 `scrollLeft`，不要对 segment 卡片使用 `scrollIntoView()`，以免带动整个嵌入页横向位移。

报告页顶部的外部讲解 tab 通过 `product-report-tab` 消息控制真实前端：

- `overview` 保持总览位置。
- `heatmap` 滚动到覆盖率概览。
- `detail` 滚动到逐约束明细。
- `evidence` 展开首个风险证据。
- 这类滚动必须限制横向位移，避免 PPT 产品框出现左右抖动。

### 说明层

- 小型编号热点可以覆盖产品，用于点击展开说明。
- 大面积卡片、标签组和流程说明必须放在产品框之外。
- 说明层不拦截 iframe 的滚轮、输入、按钮和抽屉交互。

## 5. 数据架构

### DemoAPI

`demo-api.js` 对页面提供稳定接口：

- `listInstructions()`
- `getInstruction()`
- `listReports()`
- `getReport()`
- `startRun()`
- `streamProgress()`
- `getEvaluation()`

页面组件不得直接依赖 `data` 中具体文件路径。文件结构变化应只修改 DemoAPI 或构建脚本。

### 两种加载模式

通过本地 HTTP 打开时：

- 优先 `fetch` 根目录 `data/rider`、`data/merchant` 中的真实 JSON。

直接双击 `ppt/index.html` 时：

- 使用 `ppt/data/scenario-bundles.js`。
- 展示结果应与 HTTP 模式一致。

### 更新数据

替换或补充 `data` 后执行：

```powershell
python scripts/build_ppt_data_bundles.py
```

然后同时验证 HTTP 与直接打开模式。不要手工编辑生成的 `scenario-bundles.js`。

## 6. 真实前端复用边界

- `product/index.html`、`styles.css`、`app.js` 以真实 `frontend` 为基准。
- 离线数据通过 `offline-api.js` 注入，不在原组件中硬编码报告。
- 演示状态通过 `controller.js` 控制，不复制一套相似 UI。
- PPT 专用的滚动、尺寸和底色适配只写在 `embed.css`。
- 后续同步真实前端时，优先重新复制原文件，再检查适配层是否仍兼容。

## 7. 本地运行

HTTP 模式：

```powershell
python -m http.server 8765 --directory ppt
```

浏览：

```text
http://127.0.0.1:8765/index.html
```

直接打开模式：

```text
ppt/index.html
```

## 8. 验证清单

每次修改后至少检查：

- 1920×1080 和普通浏览器窗口中无 PPT 溢出。
- 产品框未出现白色空洞或被错误裁切。
- iframe 右侧滚动条可见，并能滚动到页面底部。
- 说明卡没有覆盖产品底部、按钮或报告内容。
- 输入框、下拉框、按钮和抽屉可以操作。
- 在 iframe 内滚动不会切换幻灯片。
- `setup`、`workspace`、`trace`、`evidence`、`report` 状态均可载入。
- HTTP 与直接打开模式的指标一致。
- Overview 中页面不发生错位。
- 控制台没有项目自身的 JavaScript 错误。

## 9. 维护约定

以下变化发生时同步更新本文档：

- 产品设计视口或缩放规则变化。
- 新增 DemoAPI 接口或中间产物。
- 新增完整产品页或组件聚焦模式。
- 数据目录、构建脚本或离线加载方式变化。
- 交互导航、滚动策略或异常降级逻辑变化。

实施顺序保持为：全局画布 → 页面骨架 → 功能区域 → 组件 → 数据交互 → 视觉细节。
