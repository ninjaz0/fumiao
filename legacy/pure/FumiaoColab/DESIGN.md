---
name: FumiaoColab
description: 沿用 EasyColab 外观的原生 macOS 算力控制台
colors:
  background: "rgb(90.6% 92.5% 95.4%)"
  card: "rgb(98.5% 99% 100%)"
  border: "rgb(81% 84.6% 89.8%)"
  text: "rgb(16% 17% 18%)"
  secondary: "rgb(38% 40% 43%)"
  control: "rgb(91% 91.5% 92.5%)"
  blue: "rgb(0% 42% 98%)"
  field: "#FFFFFF"
typography:
  sheet-title:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  headline:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "19px"
    fontWeight: 600
  title:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  button:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  label:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  caption:
    fontFamily: "system-ui, -apple-system, PingFang SC, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  log:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "9px"
  card: "17px"
spacing:
  icon-gap: "8px"
  title-gap: "10px"
  form-gap: "13px"
  control-x: "15px"
  stack: "17px"
  card-gap: "20px"
  card-inset: "22px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.field}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0px 15px"
  button-secondary:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "0px 15px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0px 11px"
    height: "39px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "22px"
  status-chip:
    backgroundColor: "rgb(91% 91.5% 92.5% / 0.6)"
    textColor: "{colors.text}"
    padding: "5px 10px"
---

# Design System: FumiaoColab

## Overview

**Creative North Star: "EasyColab 原生算力控制台"**

以用户指定的 EasyColab 截图为视觉基准：浅蓝灰底、近白色卡片、细描边、蓝色线性图标和系统中文字体。整体紧凑、安静，以账号、实例与额度信息为中心。

这是已实现的 macOS SwiftUI 界面记录。界面使用浅色模式和系统控件；新增同类界面应延续现有层级与间距。

**Key Characteristics:**

- 两张纵向功能卡，账号身份置于卡片上方。
- 正文深灰、辅助文字中灰，蓝色承载主要动作与图标。
- 状态由文字解释；未知额度保留占位，预览始终明确标注。

依据：`Sources/Main.swift` 的方向约定、`Sources/Store.swift` 的状态逻辑，以及 `PRODUCT.md`。视觉参考为用户提供的 `Screenshot 2026-11-10 at 1.43.30.png`；最终截图见 `.impeccable/review/login.png` 与 `.impeccable/review/dashboard.png`。后者为 `--preview` 示例界面，未连接真实实例；这些截图不证明真实 Google 授权、Colab 分配或 H3 部署已经通过联调。

## Colors

### Primary

- **动作蓝**（`blue`）：卡片图标、可用的主要按钮与系统强调色。

### Neutral

- **浅蓝灰底**（`background`）与**近白卡面**（`card`）：提供窗口与内容的两层结构。
- **蓝灰细边**（`border`）：卡片外框、输入框和弱分隔。
- **深灰正文**（`text`）与**中灰辅助文字**（`secondary`）：分别用于标题、数值及说明、标签。
- **浅灰控件**（`control`）：次要按钮、不可用按钮与状态胶囊；输入区域使用纯白（`field`）。

就绪或运行中使用系统绿色状态点，其他实例状态使用系统橙色；错误用系统红色并附文字。系统语义色由 macOS 决定，不另造固定色值。

## Typography

使用 SwiftUI 系统字体，中文由系统回退字体呈现；不引入品牌字体。前置 token 的 `px` 对应原生逻辑点（pt），截图为 2× 像素密度，不能按截图像素直接改大字号。

卡片标题和额度数字使用 `headline`；额度数字启用等宽数字。应用名使用 `title`，登录分标题同尺寸、medium 字重。操作行与输入框使用 `body`，按钮使用 `button`；Google 账号和授权说明使用系统 13 pt。状态说明与胶囊为 12 pt medium／semibold，底部辅助入口为 `caption`。日志使用 `log`。行高由系统字体决定。

## Layout

窗口内容固定宽度 556 pt，不可手动缩放，按内容自动确定高度。左右外边距 22 pt，上边距 15 pt，下边距 20 pt；主纵向间距 17 pt。卡片内边距 22 pt、主要分组间距 20 pt。

身份栏在上方；第一卡容纳登录或 Google 账号、模型、GPU、部署动作与状态；第二卡容纳三等分指标、闲置自动释放与释放按钮。登录表单行距 13 pt，部署行距 17 pt。指标数值单行显示，必要时最多缩小到 80%。长账号中间省略。

Google 授权弹层内容宽 460 pt、内边距 25 pt；日志弹层内容宽 490 pt、内边距 24 pt，日志区域高 260 pt。当前实现没有窄屏断点或移动端布局。

## Elevation & Depth

以卡面与背景的色差、单点细描边建立层级；卡片仅有低强度环境阴影。原生参数为蓝灰色（RGB 0.29／0.36／0.46）、不透明度 0.055、模糊半径 8 pt、向下偏移 4 pt。按钮不使用投影或浮起效果。阴影及原生预览换算说明保存在 `.impeccable/design.json`。

## Shapes

卡片使用 `card` 圆角，按钮与输入框使用 `control` 圆角；状态标签使用胶囊形。卡片描边 1 pt，输入框描边取 `border` 的 65% 不透明度。状态点为直径 8 pt 的圆。沿用系统 SF Symbols 线性图标，不加入插画或装饰图片。

## Components

- **主要按钮**：通栏显示当前可执行动作，最小高度 34 pt；可用时蓝底白字。按下时整体不透明度降为 0.72；不可用时转浅灰底，文字为正文色的 38% 不透明度。处理中显示小型系统进度指示。
- **次要按钮**：绑定／更换、释放与弹层取消使用浅灰控件样式。刷新、隐私开关和底部入口使用轻量原生按钮，图标按钮有辅助标签。没有自定义悬停动画；键盘与选择状态沿用原生行为。
- **输入框**：纯白、单行、高 39 pt、水平内边距 11 pt；占位文字使用辅助文字色。初始聚焦用户名，回车依次进入密码和提交。
- **状态与部署标签**：仅 `ready`／`busy` 显示“已部署并接入弗淼”；`preparing` 显示“正在部署 MiniMax H3”，异常与失联使用对应文案。上方胶囊、下方状态说明和主动作标签同时反映状态。
- **额度指标**：剩余额度、扣费速率、本次运行三列等宽，细分隔线高 39 pt。未知额度与扣费速率显示“—”，未运行显示 `00:00:00`。
- **账号与选择控件**：顶部账号菜单确认弗淼身份；Google 邮箱默认隐藏，可用眼睛按钮切换。GPU 与闲置时限采用系统 Picker。释放操作通过原生确认弹窗完成。

侧车中的 HTML/CSS 仅用于设计面板展示这些原生样式，不替代 SwiftUI 实现；系统菜单、Picker、焦点和字体细节仍以运行中的 macOS 应用为准。

## Do's and Don'ts

### Do:

- Do 沿用系统中文字体、SF Symbols 和现有圆角尺度。
- Do 保留“先登录弗淼，再绑定 Google，最后部署”的操作顺序。
- Do 用真实状态控制标签与可用性；额度未知时显示“—”。
- Do 保留“界面预览”及“示例账号”标识，默认隐藏 Google 邮箱。

### Don’t:

- Don’t 增加聊天、视频创作、作品库或其他模型卡片。
- Don’t 将实例已分配、部署中或失联显示为“已部署并接入弗淼”。
- Don’t 把截图中的示例 Google 绑定状态当成真实授权完成。
- Don’t 用低对比辅助文字承载主要状态或错误信息。
