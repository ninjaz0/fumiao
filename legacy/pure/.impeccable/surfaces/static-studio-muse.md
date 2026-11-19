---
version: 1
slug: "static-studio-muse"
primary_target: "static/studio.js"
related_targets: ["static/studio.css", "canvas/src/main.tsx", "canvas/src/style.css", "canvas/src/types.ts", "muse_provider.py", "server.py", "canvas_api.py"]
---

# Muse 模型接入

Mode: Operate. 本记录限定于 2026-11-06 本地完成的 Muse 主创作区、结果详情及共享画布参数扩展；不替代既有工作区和画布 surface brief。

## Direction and boundary

延续现有即梦式操作工作台、彩色 Logo、系统中文字体、浅深中性外观与参数下拉控件。Muse 作为既有模型选择器中的一个选项，不增加新的视觉体系。图片和视频、主创作区和画布中的可见模型名称均为“Muse”；原有 gpt-image-2.6 和 MiniMax H3 选项保留。

视觉依据为 `static/studio.js`、`static/studio.css`、`canvas/src/main.tsx` 和 `canvas/src/style.css`；`canvas/src/types.ts`、`muse_provider.py`、`server.py`、`canvas_api.py` 用于核对实际输出与请求参数的分离。产品与后端验收事实见 `PRODUCT.md` 和 `交付/Muse接入与验收-20261106.md`。本轮只追加 Muse 设计记录，既有全局 token、叙述和旧组件样例不在刷新范围内。

## Implemented layout and appearance

- 主工作台复用 32px 高、8px 圆角的参数按钮，文字为 12px、图标为 14px、两者相隔 4px。模型菜单宽 284px、内边距 6px；选项最小高度 40px、内边距 9px 12px、圆角 9px，当前项有选中背景与对勾。
- 画布参数按钮沿用 12px 文字、13px 模型下拉图标和 5px 间距。模型菜单沿用白色／深色操作面、12px 圆角、6px 内边距及轻阴影；选项最小高度 36px，文字为 13px。当前项用对勾和 `aria-selected` 标记。
- 画布模型菜单从触发器左侧展开（`left: 0; right: auto`），最小宽度 130px。在 390px 宽验收视口中，菜单左右坐标为 22px 和 152px，完整处于视口内。此规则只作用于模型菜单；时长菜单仍靠其触发器右侧展开，位置未变。
- 结果详情保留既有作品预览与侧栏结构。Muse 的“详细信息”及其字段在浅色下使用局部 `#6b6b6b`；深色继续使用 `--secondary`。该修正不改变全局辅助文字颜色。

## Implemented parameters and interaction

| 类型 | Muse 面板选项 |
| --- | --- |
| 图片 | 1:1、16:9、9:16、4:3、3:4；原生分辨率 |
| 视频 | 16:9、9:16；5／6／8／10 秒，默认 6 秒；原生分辨率 |

- Muse 不显示固定像素、图片质量或随机种子控件。切回已有模型时恢复对应的比例、分辨率、质量、时长与种子选项；这不表示所有历史选值都会恢复。无效比例归一到受支持的值，切入 Muse 视频默认 6 秒。
- 主工作台与画布模型菜单打开后聚焦当前可用项；上下方向键、Home／End 在可用项间移动焦点，Escape 关闭并返回模型触发器，选择模型后也恢复触发器焦点。禁用项不会进入方向键导航。
- 参数栏显示“原生”。结果摘要使用实际尺寸，视频使用实际时长；详情将“尺寸”“期望比例”“期望时长”“实际时长”分别列出。图片不显示视频时长或随机种子。
- 图片和视频保留服务返回的原生结果；这些面板选项是本平台预设，不是输出尺寸／时长保证或 Muse 全部能力上限。状态继续使用可读文字，如“等待 Muse 就绪”“Muse 生成中”，不借用 GPU 进度假定实际运行情况。

## Finish record

本轮限定修正清单的 finish review 结论为 **ship**，仅覆盖以下三项：

| 发现 | 最终实现与复核 | 状态 |
| --- | --- | --- |
| 模型菜单键盘闭环不完整 | 当前项初始焦点、上下方向键、Home／End、Escape 及触发器焦点恢复均已复核 | 已解决 |
| Muse 浅色详情辅助文字对比度不足 | 仅 Muse 详细信息改用局部 `#6b6b6b`，深色保持原变量 | 已解决 |
| 窄屏画布模型菜单向左越界 | 模型菜单改为左锚点、最小宽度 130px；390px 视口内左右坐标为 22px／152px，时长菜单未改 | 已解决 |

证据位于 `.impeccable/review/`：`muse-video-desktop.png`、`muse-image-desktop.png`、`muse-models-desktop.png`、`muse-result-desktop.png`、`muse-video-mobile.png`、`muse-image-mobile.png`、`muse-canvas-desktop.png`、`muse-canvas-mobile.png`。桌面视口为 1280×720，移动视口为 390×844。主执行者已检查全部截图，复核者确认上述修正；文档整理时再次查看了结果桌面图和画布移动图。`work/muse-integration-20261105/design-findings.json` 是修正前 JS／TSX 目标的空检测结果，不能当作修正后的全应用审查。

真实服务验收得到原生 2048×1152 图片与 1248×704、6 秒、24fps 视频，并导入本地预览。该验收及后端回归与本设计复核分别记录；截图与本结论不证明线上发布。`nvmes.com` 主应用未部署本轮更新，工作区更新仍待发布，H3 噪点修复与 4 步加速长视频验收仍是独立待办。
