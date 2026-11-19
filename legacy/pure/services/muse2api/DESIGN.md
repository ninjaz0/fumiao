---
name: Muse2API 管理控制台
description: 继承 Flow2API 的浅色操作界面，适用于本目录的登录与管理页面。
colors:
  primary: "#171717"
  bg: "#ffffff"
  bg2: "#fafafa"
  text: "#0a0a0a"
  muted: "#737373"
  line: "#e3e3e3"
  line2: "#d4d4d4"
  ok: "#15803d"
  bad: "#dc2626"
  warn: "#a16207"
  purple: "#7e22ce"
typography:
  headline:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "28px"
  title:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
rounded:
  control: "6px"
  surface: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.bad}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  nav:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "12px 4px"
  badge:
    rounded: "{rounded.control}"
    padding: "3px 9px"
  card:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.surface}"
    padding: "16px"
---

# Design System: Muse2API 管理控制台

## Overview

**Creative North Star: "Flow 式管理控制台"**

这是供管理员日常操作的 Operate 界面。白色底面、细灰边线、黑色主操作和密集信息组织继承用户指定的 Flow2API。视觉层级靠字号、字重、留白与表格结构建立，状态颜色只辅助识别结果和风险。

本记录以 `login.html`、`admin.html` 最终生效的 CSS、`admin_auth.py` 和 `review/` 截图为依据，仅约束本交付目录。主项目 `PRODUCT.md` 描述的是 nvmes.com 创作工作台，其彩色 Logo、波纹与侧栏不属于本后台。界面没有随主题交付的栅格图片；媒体库里的用户生成结果属于内容，审阅截图属于证据。

**Key Characteristics:**
- 白底、细边线和黑色主按钮。
- 系统无衬线字体，紧凑但保留清楚的操作分组。
- 横向页签、状态统计与完整数据表格。
- 小屏调整列数并保留局部横向滚动。

## Colors

中性色负责结构，绿、红和琥珀色负责可用、异常及提醒；颜色始终配合文字。

### Primary
- **操作黑**（`primary`）：登录、导入及其他主动作；选中页签的底线也使用这一色。

### Neutral
- **页面白**（`bg`）：页面、卡片和输入框底面。
- **轻灰底**（`bg2`）：代码块、媒体容器与轻量悬停反馈。
- **正文墨色**（`text`）与**说明灰**（`muted`）：区分正文、标题及辅助说明。
- **结构灰线**（`line`）与**强调灰线**（`line2`）：表格、卡片、字段边界及次级悬停边线。

### Semantic
- **可用绿**（`ok`）、**异常红**（`bad`）、**提醒琥珀**（`warn`）：状态标签、提示和危险操作；标签有相应的浅色底及边线。
- **语法紫**（`purple`）：代码语法中的辅助区分。统计中的账号总数蓝和可用数量亮绿属于该组件的实色表达，不扩展为页面装饰色。

**The 状态伴随文字 Rule.** 状态通过文字或数值表达，颜色提供第二层识别线索。

## Typography

**Body Font:** 系统无衬线字体栈，具体字体随操作系统变化。代码、账号 ID、文件名使用系统等宽字体。

字级以正文、标签、卡片标题和数值构成，不引入独立装饰展示字体。登录页品牌标题单独放大（36px／40px、700）；它是登录构图中的特例。

- **Headline**：品牌名及统计数值；数值使用等宽数字对齐。
- **Title**：主要卡片标题。账号列表内嵌标题保留其实际紧凑排版，并非全部标题都采用同一选择器。
- **Body / Label**：普通操作与字段。表格正文更紧凑（13px），表头保持清楚的标签层级（14px）。
- 辅助说明以较小字号和说明灰呈现，登录页页脚（12px／16px）。

**The 操作优先 Rule.** 标题帮助分组，操作名称和数据保持直接、可扫描的系统字体。

## Layout

登录页垂直居中，标题与表单共用外层宽度上限（448px）；外层页面上下留白（48px）。表单内侧在宽屏为左右（40px），小屏为左右（16px）；字段与按钮等高（40px）。字段标签在输入框上方，字段组之间留白（24px）。语言选择固定在右上角。

管理页与顶栏共用居中容器（最大 1280px），桌面左右内边距（24px），顶栏高度（56px）。顶栏保持可见；横向页签位于内容顶部，选中项用底线标记。账号页以五列统计、账号列表和按需展开的导入区组织操作。

管理页在宽度不超过（640px）时改为两列统计，最后一项占满一行；页面左右边距（16px）、上下内边距（20px）。页签与表格各自横向滚动，字段行转为纵向排列。已有（390×844px）截图呈现这一行为；表格没有转换成移动端卡片。

**The 保留表格 Rule.** 窄屏保留账号和任务的列关系，通过表格容器横向滚动查看完整信息。

## Elevation & Depth

常态页面、卡片、统计框与表格均为平面，边线承担分组。顶栏无模糊玻璃效果。临时消息使用轻阴影（`0 4px 12px #0002`）；原生代理设置对话框通过半透明遮罩（`rgba(0,0,0,.65)`）与页面分离。

**The 平面主体 Rule.** 主要操作区域靠边界和间距分层，临时反馈才使用浮层。

## Shapes

控件、表格与状态标签采用较小圆角，卡片和媒体容器采用较大圆角，对应 frontmatter 中的两级圆角。边界以单像素细线为主。步骤编号和状态点保留圆形，因为它们表达顺序或状态，并非按钮外形。

## Components

### Buttons

主按钮实黑，次按钮白底灰边，轻操作透明底灰边，危险操作红字淡红边。普通按钮使用紧凑的内部留白；表格小按钮进一步收紧（4px 10px，12px）。悬停改变底色或边色，按下不位移。管理页禁用状态降低透明度（0.45），登录按钮禁用时使用等待光标及更低透明度（0.5）。

### Inputs / Fields

白底细边线，焦点边线加深；键盘焦点使用清晰外轮廓（2px，偏移 2px）。登录字段有关联的 `label`、必填约束及用户名／当前密码自动填充语义。登录失败在表单内显示红色文字，带 `role="alert"` 和 `aria-live="polite"`；认证失败后焦点回到密码框。

### Navigation

页签为一行文字按钮，选中项使用深色文字和底线；小屏保持横向滚动。语言选择、GitHub 链接有可访问名称，退出按钮保留文字与内联 SVG。当前页签实现是普通按钮切换面板，并未实现完整 ARIA tabs 键盘模式。

### Cards / Containers

白底细边线、固定内边距、无常态阴影。统计标签置于数值上方；账号列表将导入、保活动作与说明放在表格上方。媒体缩略图采用 `object-fit: contain`，选中通过边色表达，悬停不抬升。

### Chips / Tables

标签以短文字配合语义底色、边线和文字颜色显示状态。表格表头浅底、单元格横向分隔，悬停行使用轻灰；操作在同一行分组，空间不足时换行。任务状态保留文字，下载入口以文字按钮表达，未引入字符画功能图标。

### Feedback / Session

登录提交期间按钮显示“登录中…”并禁用，成功跳转管理页；已有会话访问登录页会跳转管理页。控制台先读取会话再刷新数据，未登录或收到 401 时返回登录页；退出撤销服务端会话。管理会话与生成 API 的密钥能力分开，页面不再用本地保存的 API Key 作为登录凭据。

列表、任务和媒体初始显示“加载中…”；生成操作显示文字进度与旋转指示，处理期间禁用提交按钮。新增账号展开导入区后滚动定位并聚焦标签字段。代理设置采用原生 `dialog`，有标题、说明与错误／结果语义。管理页减少动态效果偏好会关闭动画和过渡；登录页只保留短暂底色过渡（0.15s）。临时消息约四秒后消失，现有消息容器没有 live-region 语义，本记录不将其描述为已完整覆盖辅助技术通知。

## Do's and Don'ts

### Do:
- **Do** 继承白底、黑色主操作、细灰边线与系统字体的实际组合。
- **Do** 保留可见焦点、字段标签、状态文字和加载文字。
- **Do** 在窄屏维持页签及表格的局部横向滚动。
- **Do** 将新增后台功能纳入现有页签、卡片、表格和字段体系。

### Don't:
- **Don't** 把本文件的后台主题应用为 nvmes.com 创作工作台的全局设计规范。
- **Don't** 将被覆盖的旧深色渐变、发光状态点或悬停抬升恢复成默认样式。
- **Don't** 把截图中的浏览器自动填充底色、鼠标指针或临时数据当作设计令牌。
- **Don't** 用装饰图片、额外字形图标或颜色替换操作和状态的文字含义。
