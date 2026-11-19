---
version: 2
slug: "fmworker-desktop"
primary_target: "src/App.tsx"
related_targets: ["src/styles/tokens.css", "src/styles/app.css", "src/components", "src/lib/status.ts", "src/lib/useBackend.ts", "src/api.ts", "index.html"]
---

# fmWorker desktop surface

记录日期：2026-11-10。模式：Operate。版本：0.2.0。产品事实归 `PRODUCT.md`，当前视觉 token 归 `DESIGN.md`；本记录只覆盖 fmWorker 桌面客户端。

## Scope and pinned direction

用户指定由 Antigravity Claude Opus 5.5 Medium 设计前端，参考 EasyColab。此轮按 Opus 已交付代码整合，不另选审美，不以旧版四页侧边导航作视觉基线。`index.html` 的方向契约为 `opus55-easycolab-20261110`：三项顶部页签、常驻账号与资源栏、一个资源详情主区，以及当前实例和下次启动设置的分离。

原始交付在父工作区的 [frontend](../../../work/fmworker-ui-opus55-20261110/design-workspace/frontend/) 与 [DESIGN-SPEC.md](../../../work/fmworker-ui-opus55-20261110/design-workspace/design/DESIGN-SPEC.md)。参考采用紧凑控制栏、卡片、状态点、蓝色主按钮、深浅外观和深色日志；没有搬入创作工具、模型中心或生成结果。没有生成效果图或生成栅格作为视觉权威。

最终规范从实际 `src/App.tsx`、`src/components/`、`src/styles/` 和状态逻辑提取。原始交付中的部分颜色与状态文案已在整合时修正，实际源码优先。`PRODUCT.md` 保留原产品约束；其中早期页面名称不再用于描述本轮的导航组成。本次不修改 PRODUCT 或父项目设计记录。

## Composition

| 区域 | 当前结构 |
| --- | --- |
| 未取得后台快照 | 只显示启动/重试画面，不填充虚构账号、资源或收益 |
| 未登录 | 居中登录卡、用户名和密码、前往弗淼入口；后台离线时禁止登录 |
| 顶栏 | 品牌；控制台、记录、设置；整体状态；全部暂停；外观切换 |
| 常驻左栏 | 首次使用清单入口（必要时）；Google 账号卡；Breeze、Flow、Colab 资源行及独立启停；积分摘要 |
| 控制台主区 | 首次清单、Google 账号详情或所选资源详情；状态卡优先，配置与限制随后 |
| 记录 | 两项积分摘要、原生贡献表格、深色运行日志；未知、未加载、已加载为空分别呈现 |
| 设置 | 外观分段选择、Colab 配置入口、诊断、网页入口和退出登录 |
| 状态栏 | 后台连接/处理中、最新事件、弗淼账号、系统与版本 |

原生默认窗口为 **1040 × 790**，最小为 **760 × 620**；CSS 外壳最低为 760 × 600。顶部 48px、底部 28px，左栏默认 264px。主区和左栏各自滚动。宽度 ≤900px 时左栏变为 232px，Colab 双卡纵排，运行日志移至记录表格下方；高度 ≤680px 时压缩卡片与区块留白。没有手机布局，也不将最小窗口下的纵向滚动误记为内容丢失。

## State and action contract

- 状态由后台快照和资源各自操作键决定，轮询间隔 2500ms。离线保留最后快照并明确说明“可能已过期”；从未读取成功时只显示连接重试画面。
- 资源行和详情共用 `resourceView`。启用资源的下一步是暂停或暂停接单；已暂停可恢复；准备操作和停止操作有独立忙碌状态。不因其他资源正在部署就禁用本资源的暂停。
- 有当前任务但资源已停接单时，显示“完成后暂停”；Colab 显示“完成后释放”。禁用再次启动，不将仍执行的任务伪装为闲置。
- Colab 存在旧实例且未启用时，显示“核对旧实例”或“等待释放”，主动作不可再次启动。非 Colab 视图可出现核对提示，只有“查看状态”和“释放”，不直接承诺旧实例可以恢复贡献。
- 当前实例以 `active_colab` 快照显示 GPU、启动时间、最晚结束与剩余时长、空闲释放、Drive 状态；存在用量数据时显示估算 CU。下次启动设置另列，不能改变当前实例摘要。
- 贡献限制使用可折叠表单和摘要。修改后显示还原，保存转为主按钮；CU 明示保守估算，不会自动购买额度。
- Google 的 Colab 授权与 Flow 会话分别显示。OAuth 等待中保留重开授权页与取消入口；Flow 通过独立浏览器会话连接，不等同于 Google 授权成功。
- Flow 有 `current_job` 或 `stage=busy` 时，详情、账号页和首次清单三个登录入口都不可用。后台直接调用也拒绝已有活动任务；浏览器登录请求期间若任务被领取，最终连接状态写入在共享锁内检查活动任务，不能覆盖 busy 状态。
- Google 断开入口在 Flow/Colab 启用、执行或相关操作未结束，以及仍存在 Colab 实例时禁用；允许时仍需确认。Colab 释放同样需要确认，范围为 fmWorker 创建的实例。
- 首次清单为连接 Google、登录 Flow、开始贡献三步；Windows 可只用 Breeze，因此 Google 为可选。隐藏偏好写入本地存储。重开后的已暂停资源不被等同为首次接入。
- 未知积分/余额显示“—”；`history_loaded=false` 且无记录时显示“记录尚未加载”，平台成功返回空记录后才显示“还没有贡献记录”。演示数字、测试任务和 GPU 名称不能作为真实贡献证据。
- 全部暂停、退出排空及完成后可退出有明确状态文案；前端显示后台状态，不自行推断资源已释放。

## Evidence and provenance

当前截图位于 [review/opus-integration](../review/opus-integration/)。[provenance.json](../review/opus-integration/provenance.json) 逐张记录尺寸、实际编码、SHA-256 和来源。文件名保留 `.png`，实际 CUA 输出为 **JPEG**；本记录不转换、不改动截图像素。

除 `native-login-macos.png` 外，下列图均为显式本地演示构建的浏览器截图，账号、任务、收益和 GPU 数据是模拟值。演示横幅是证据边界的一部分，生产构建排除演示入口、模拟客户端与控制面板。

| 证据文件 | 像素尺寸 | 能证明的范围 |
| --- | --- | --- |
| [desktop-light.png](../review/opus-integration/desktop-light.png)、[desktop-dark.png](../review/opus-integration/desktop-dark.png) | 1040 × 790 | 最终浅深色控制台、常驻栏、Colab 双卡结构 |
| [minimum-dark.png](../review/opus-integration/minimum-dark.png) | 760 × 620 | 最小窗口下 Colab 卡片纵排和独立滚动布局 |
| [settings-minimum-light.png](../review/opus-integration/settings-minimum-light.png) | 760 × 620 | 浅色设置布局 |
| [paused-minimum-light.png](../review/opus-integration/paused-minimum-light.png) | 760 × 620 | 暂停/旧实例状态的演示呈现 |
| [setup-windows-minimum.png](../review/opus-integration/setup-windows-minimum.png) | 760 × 620 | Windows 模拟平台下的首次清单；不是 Windows 原生运行验收 |
| [oauth-minimum.png](../review/opus-integration/oauth-minimum.png) | 760 × 620 | 等待授权、重新打开和取消入口；不是实际 Google 授权成功 |
| [records-dark.png](../review/opus-integration/records-dark.png) | 1040 × 790 | 深色记录和日志布局；数据仍为演示值 |
| [release-confirm-dark.png](../review/opus-integration/release-confirm-dark.png)、[fix-release-minimum.png](../review/opus-integration/fix-release-minimum.png) | 1040 × 790；760 × 620 | 修正后的深色危险确认按钮与弹窗布局 |
| [fix-flow-busy-desktop.png](../review/opus-integration/fix-flow-busy-desktop.png)、[fix-flow-busy-minimum.png](../review/opus-integration/fix-flow-busy-minimum.png) | 1040 × 790；760 × 620 | 任务执行中重新登录入口禁用；不代表真实 Flow 任务测试 |
| [native-login-macos.png](../review/opus-integration/native-login-macos.png) | 2080 × 1580 | 隔离状态的打包 Mac 生产应用，后台已加载的登录页面；包含原生窗口，非 CSS 视口尺寸 |

`oauth-windows-minimum.png` 保留为补充来源，但 provenance 将其标为未计入本轮 review。上一级 `review/` 的旧截图保留作历史记录，不是当前 Opus 界面的最终证据。原始交付包中的 prototype 截图也不替代本轮整合截图。

## Bounded verdict and verification limits

[最终独立复核结论](../../../work/fmworker-ui-opus55-20261110/finish-verdict.md) 为 **ship，仅限本次 Opus 前端整合与已复核的状态/交互修复**。原始三项发现均 resolved：

| 原发现 | 解决依据 |
| --- | --- |
| 深色危险按钮对比度 | 使用独立 `on-danger`；复核记录深色 6.50:1、浅色 5.11:1，并查看桌面/最小窗口确认框截图 |
| 轮询导致确认框焦点重置 | 焦点初始化与恢复仅依赖打开状态；[多轮询焦点记录](../review/opus-integration/focus-after-polls.json) 及 [Esc 恢复记录](../review/opus-integration/focus-restore.json) 支持该路径 |
| Flow 重新登录覆盖运行中任务 | 三个前端入口与后台调用保护，加上浏览器请求返回后共享锁内的条件写入；专门回归覆盖请求期间领取任务的竞争情况 |

第二轮仅修正最后一项后台状态保护及回归，不再改变前端视觉，因此继承前一轮截图。项目验证记录为 **18 项前端测试、37 项 Python 测试通过**；[Python 报告](../../../work/fmworker-ui-opus55-20261110/python-tests.xml) 为 37 tests、0 failures、0 errors。文档整理没有重跑测试，也没有扩大独立 reviewer 的验证范围。

已有 Mac 原生检查确认：生产登录页面加载、关闭窗口隐藏并保留后台进程、Cmd+Q 退出。后续可选登录尝试受 macOS 截图故障中断；**没有完成原生已登录界面或真实 provider 流程验收**。托盘重新打开、Windows 原生运行、真实 Google 登录/续期、Flow 生成、GPU 执行、正式签名与完整产品发布条件均不在此次 ship 范围内。登录态下带任务的退出排空与真实资源释放，也不能从无任务原生退出检查推出。

本轮是原生桌面目标，未运行设计 detector。旧世界的单次 detector 报告不用于评估此次实现，且不会被“无阻断项”等旧结论替代本轮 review。

## Accessibility and reuse boundary

源码具备具名导航和控件、当前项标记、方向键资源选择、Ctrl/⌘ 页签快捷键、原生记录表格、开关/单选组语义、错误和状态播报、确定/不确定进度语义、可见焦点及减弱动态效果。确认框初始聚焦取消、Tab 循环、Esc 取消并恢复触发焦点；轮询稳定性已在本轮限定路径检查。

这不构成全局无障碍通过。屏幕阅读器、文字放大、跨平台字体、全部键盘路径与小尺寸控件目标面积仍需独立检验。页面切换没有标题自动聚焦；开关与部分图标按钮仍保持紧凑桌面尺寸。

可复用的是 DESIGN.md 的颜色、字体、尺度、按钮、卡片、状态与焦点语言。三页结构、资源顺序、首次清单、后台状态字段和截图 fixture 属于本 surface。`.impeccable/design.json` 的片段用于设计面板预览，不能替代 React 状态逻辑，也不能扩展成父项目的全局版式要求。
