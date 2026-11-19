---
name: "fmWorker"
description: "Opus 5.5 实现的 EasyColab 参考桌面资源控制台"
colors:
  bg-canvas: "#f6f8fb"
  bg-rail: "#edf1f7"
  surface: "#ffffff"
  surface-2: "#f8fafc"
  hover: "#eef2f7"
  border: "#d9e0ea"
  divider: "#cfd7e2"
  text: "#172033"
  text-2: "#5a6577"
  text-3: "#667286"
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-soft: "rgba(37,99,235,.10)"
  accent-line: "rgba(37,99,235,.45)"
  on-accent: "#fff"
  ok: "#08764c"
  work: "#2563eb"
  paused: "#8a5200"
  error: "#cc3434"
  on-danger: "#fff"
  off: "#98a2b3"
  ok-soft: "rgba(19,138,90,.11)"
  work-soft: "rgba(37,99,235,.10)"
  paused-soft: "rgba(178,107,0,.11)"
  error-soft: "rgba(204,52,52,.09)"
  off-soft: "rgba(120,130,150,.10)"
  terminal: "#12151b"
  terminal-text: "#cfd6e2"
  terminal-dim: "#7c8799"
  dark-bg-canvas: "#121418"
  dark-bg-rail: "#1b1e24"
  dark-surface: "#202229"
  dark-surface-2: "#17191e"
  dark-hover: "#2a2e37"
  dark-border: "#333843"
  dark-divider: "#2c313b"
  dark-text: "#eef2f7"
  dark-text-2: "#a3adbd"
  dark-text-3: "#9aa5b7"
  dark-accent: "#6b9cff"
  dark-accent-hover: "#8bb2ff"
  dark-accent-soft: "rgba(107,156,255,.14)"
  dark-accent-line: "rgba(107,156,255,.5)"
  dark-on-accent: "#0d1424"
  dark-ok: "#3cc98f"
  dark-work: "#6b9cff"
  dark-paused: "#e3a94b"
  dark-error: "#f17474"
  dark-on-danger: "#240f12"
  dark-off: "#6b7486"
  dark-ok-soft: "rgba(60,201,143,.13)"
  dark-work-soft: "rgba(107,156,255,.14)"
  dark-paused-soft: "rgba(227,169,75,.13)"
  dark-error-soft: "rgba(241,116,116,.12)"
  dark-off-soft: "rgba(140,150,170,.10)"
  dark-terminal: "#0f1217"
typography:
  body:
    fontFamily: "-apple-system,BlinkMacSystemFont,\"Segoe UI Variable Text\",\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  title:
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.01em"
  section:
    fontSize: "15px"
    fontWeight: 620
  group:
    fontSize: "13px"
    fontWeight: 650
  control:
    fontSize: "13px"
    fontWeight: 560
  small:
    fontSize: "12px"
  caption:
    fontSize: "11px"
  number:
    fontSize: "24px"
    fontWeight: 650
    letterSpacing: "-.01em"
  log:
    fontFamily: "ui-monospace,\"SF Mono\",Menlo,Consolas,monospace"
    fontSize: "12px"
    lineHeight: 1.55
  login-title:
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-danger}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "32px"
  button-danger-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.error}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 13px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  nav-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "30px"
  status-ready:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.s4}"
  resource-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
---

# Design System: fmWorker

## Overview

**Creative North Star: "常驻资源控制台"**

fmWorker 的当前视觉来自用户指定的 Antigravity Claude Opus 5.5 Medium 前端，参考 EasyColab 的冷灰蓝控制栏、紧凑状态卡、蓝色操作和深色运行日志。方向标识为 `opus55-easycolab-20261110`；以实际代码为准，不重新选择审美。

本文件记录 `src/App.tsx`、`src/styles/` 和 `src/components/` 的已实现视觉。系统字体、细描边和轻阴影服务于持续查看资源状态与直接启停；原生窗口装饰、系统授权页面和托盘不属于 React 视觉规范。来源、状态契约和验收边界见[桌面界面记录](.impeccable/surfaces/fmworker-desktop.md)。

**Key Characteristics:**

- 三项顶部页签与常驻账号、资源栏，主区承载所选详情。
- 浅色与深色共用语义 token，状态同时提供色点和文字。
- 主操作使用蓝色；释放与断开采用危险语义并要求确认。
- 配置、当前实例、任务状态与日志分区呈现；未知数据不伪装为零。

## Colors

### Primary

`accent` 是明确的交互蓝，用于主按钮、当前页签、焦点和进度。`accent-hover`、`accent-soft` 和 `accent-line` 分别处理悬停、弱底色及选中边界；`on-accent` 是主按钮前景。

### Neutral

`bg-canvas` 与 `bg-rail` 分开主区和常驻栏；`surface` 为卡片，`surface-2` 为输入和表头，`hover` 为交互反馈。`border` 与 `divider` 区分卡片描边和区域分界；`text`、`text-2`、`text-3` 构成文字层级。日志始终使用 `terminal` 与专属文字色，不随浅色外观变成白色日志面板。

`ok`、`work`、`paused`、`error`、`off` 及其弱底色表示状态，不扩展为品牌配色。危险按钮前景必须使用 `on-danger`，不能沿用主按钮前景或固定白字。`dark-*` 是 `[data-theme=dark]` 的实际覆盖；未列深色覆盖的值继承浅色声明。外观只提供浅色、深色两项，没有跟随系统。

**The State Pairing Rule.** 色点和胶囊必须带可读状态文字；不能仅靠颜色区分执行、暂停、故障与未接入。

品牌三段 SVG 保留原色，仅作既有标识。黄色斜纹横幅和演示面板只属于显式演示构建，不属于生产界面；侧车色阶仅供面板预览，不是新增运行时配色。

## Typography

正文与控件使用前置 token 的系统字体栈，含 Segoe UI Variable Text、Segoe UI、PingFang SC 和 Microsoft YaHei；不加载网络字体。正文为 `body`，标题为 `title`，卡片标题为 `group`，分区标题为 `section`。辅助文字为 `small`，状态栏、分组名和表头为 `caption`。积分使用 `number`，日志使用系统等宽 `log`。

数字通过 `tabular-nums` 对齐。品牌文字为（14px，700），登录标题使用 `login-title`。状态说明限制到（68ch），说明与提示限制到（72ch）；事件摘要和邮箱允许省略，完整内容在相应详情或标题提示中呈现。系统字体在不同操作系统上可能产生不同字宽。

## Layout

已登录界面采用顶部页签、常驻左栏、独立滚动主区和底部状态栏。顶栏（48px）、状态栏（28px）、左栏（264px）；左栏内部可独立滚动，积分摘要固定在底部。详情与普通页面最大宽（820px），内边距为（20px 24px 24px）。记录页不受这一最大宽度限制。

宽度不超过（900px）时，左栏变为（232px），主区内边距（16px 16px 20px），Colab 双卡纵排，日志由右侧（300px）移至表格下方并限制为（200–280px）高。高度不超过（680px）时，详情顶部留白和卡片内边距压缩。限制字段用 `auto-fill` 网格，每列最小（150px），不是固定双列。

原生窗口默认（1040 × 790）、最小（760 × 620）。CSS 外壳自身最小为（760 × 600）；两者不可混同。此布局面向桌面窗口，没有手机折叠导航。未登录时显示居中、可滚动登录区，卡片宽（340px）、内边距（28px），不保留已登录导航栏。

## Elevation & Depth

使用表面色、细描边和极轻卡片阴影区分层级。普通卡片用 `shadow`；确认框用 `shadow-pop` 与半透明遮罩。没有玻璃模糊或悬停位移。精确阴影、焦点环与动效在 `.impeccable/design.json` 扩展层记录。

选中资源用强调色边框与（1px）外环。通用键盘焦点用表面色间隔加蓝色环；输入改用蓝色边框与弱蓝外环。按钮状态过渡（.12s），开关（.16s），进度宽度（.4s）；加载旋转、工作色点和不确定进度分别有循环反馈。减弱动态效果规则将动画限制为一次，不确定进度改为静态半透明条；这不等于完整无障碍验收。

## Shapes

圆角按现有四档：`sm` 用于输入、小按钮和焦点；`md` 用于标准按钮、页签和小资源图标；`lg` 用于卡片和大资源图标；`pill` 用于状态胶囊、开关和进度。登录卡另用（14px），确认框另用（12px）。边框为（1px）。

Lucide 线性图标用于功能识别，常用（13–16px），详情资源图标（20px）。品牌 SVG 顶栏默认（22px），登录（40px）。不使用照片、生成插图或新标识。

## Components

### Buttons and fields

五种按钮为蓝色主按钮、描边次按钮、蓝色文字按钮、危险实底按钮和危险文字按钮。标准高度（32px），小按钮（26px）；禁用透明度 .5，忙碌且禁用时 .75。图标按钮为（30 × 30px）。状态改变主要通过颜色、文字、加载标记和禁用反馈表达。

输入和选择控件使用 `surface-2`、细描边与 `sm` 圆角，标准高度（32px）；Colab 行内下拉框为（112 × 26px）。标签与字段关联。Drive 开关为（36 × 20px），滑块（14px），使用 `role="switch"` 和具名状态；不将这一小命中面积宣称为完整目标尺寸合规。

### Navigation and resource rail

顶部为“控制台、记录、设置”，当前项使用弱蓝底色和 `aria-current="page"`；Ctrl/⌘ + 1/2/3 切换页面。账号与资源栏在三页间常驻。资源顺序为 Breeze、Flow、Colab，每项分开选择按钮与行内启停按钮；上下方向键移动并选择栏内项目。

账号卡分开显示 Colab 授权与 Flow 会话。资源行显示图标、状态文字、色点及必要的底部进度，不使用旧版整行列表加下方详情的布局。

### Resource detail and cards

详情包含标题、状态胶囊、状态卡、当前任务及主操作。错误状态出现红色边界与具名错误说明；恢复动作直接对应重试或导出诊断。Colab 的“当前实例”取活动实例快照，“下次启动设置”仅改变未来启动配置；两者不能随同一控件变化而混写。贡献限制使用可折叠摘要，修改后提供还原和主色保存按钮。

### Status, progress and records

状态胶囊高（24px），状态点（7px）；徽标高（18px）。进度条高（6px），已知进度显示百分比，未知进度显示处理中。记录用原生表格，日志为深色等宽列表，最多呈现最近 40 条。未知积分为“—”，未加载与真实空记录分别说明。后台断开时保留旧快照并明确标注可能过期。

### Setup, authorization and confirmation

首次设置采用非模态三步清单，可隐藏；Windows 可只使用 Breeze，Google 步骤可选。OAuth 等待状态保留重新打开与取消入口，Flow 会话单独连接。运行中的 Flow 任务禁用三个重新登录入口，后台也保留状态保护。

释放实例与断开账号使用确认框，初始焦点为取消，Tab 在框内循环，Esc 取消并归还触发焦点。轮询不重新初始化焦点。危险按钮的浅深色前景分别来自相应 token。

## Do's and Don'ts

### Do:

- **Do** 保留用户指定的 Opus 结构、系统字体、冷灰蓝控制栏和紧凑尺度。
- **Do** 让资源行与详情共享状态和主操作规则，使用明确的动作名称。
- **Do** 让颜色与状态文字配对，并保持浅深色语义一致。
- **Do** 区分当前实例与下次启动设置、未知数据与真实零值、旧快照与在线状态。
- **Do** 将演示呈现、原生行为和真实资源验收分别记录。

### Don't:

- **Don't** 恢复旧四页侧边导航、旧黑色主按钮或 `src/style.css` 的尺度。
- **Don't** 为此桌面控制台引入新的审美方向、创作表单或虚构运行指标。
- **Don't** 把副本中的原始设计说明当作高于当前代码的 token 或状态依据。
- **Don't** 把演示任务、部分原生检查或本轮有限 ship 结论扩大为整产品可发布。


## 0.3.0 Chrome 扩展安装向导

用户改为复用当前 Chrome 用户。Flow 详情中新增 `ChromeSetup`，沿用现有 Card、Button、StatusPill 和字体色彩，按准备、加载、检测三个真实顺序展示；没有额外欢迎页或全屏弹窗。安装前禁用扩展管理和文件夹入口，准备后启用；连接检测随后台轮询更新，连接后收起步骤并保留安装帮助。插件不连接时 Flow 行显示“待连接扩展”，点击指向 Flow 安装向导，不启动新的浏览器资料目录。

本次仅做 1040×790 浅色与 760×620 深色的向导检查，截图位于父目录 `work/fmworker-flow-fix-20261110/review/`，为明确标注的演示状态。0.2.0 的独立复核结论不扩大为这次浏览器连接器或真实 Google 生成的验收。
