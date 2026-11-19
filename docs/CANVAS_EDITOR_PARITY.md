# 画布编辑器 React 迁移

原站兼容模式下，`/canvas/:id` 默认使用 Next App Router 从 `apps/web/canvas-editor` 编译的 React / TypeScript 编辑器。编辑器的节点、React Flow、候选、素材包、镜头、旁白、合成和内嵌对话移植自 `legacy/pure/canvas/src`。页面沿用原版的版本化 CSS、图标和私有媒体，主题由 Next 画布页面共用的首屏脚本初始化。

页面沿用 `fm_session`，先读取 `GET /api/canvases/:id`，再按所属空间请求 `/api/state`。修订检查、幂等编号、浏览器草稿和私有媒体沿用原协议。默认网关连接原协议 Nest，也可显式启动 Python 兼容服务。在项目 URL 加上 `canvas_ui=legacy` 即可用同一会话和 API 加载固定生产 HTML 和 bundle。部署时也可设置 `STUDIO_CANVAS_EDITOR=legacy` 全局回退。

## 生产源码核对

按 `legacy/pure/canvas/package-lock.json` 在临时目录安装并重建。Vite 7.3.7 产出的五个资源与 `baseline/production/manifest.json` 同大小、同 SHA-256。

| 资源 | 字节数 | SHA-256 前缀 |
| --- | ---: | --- |
| `canvas.js` | 946144 | `f8d0f6c0ee07526093c0b` |
| `canvas.css` | 70955 | `b214272d782c8c43380dd` |
| `chat.js` | 339460 | `560be0e8f951a768501a` |
| `chat.css` | 22071 | `c3cb02b085dd7262b13b` |
| `flowpicker.js` | 4188 | `fcb91545ee58062220e1` |

```sh
canvas_audit="$(mktemp -d)"
cp -R legacy/pure/canvas "$canvas_audit/canvas"
(cd "$canvas_audit/canvas" && npm ci && npm run build)
python3 - "$canvas_audit/static" <<'PY'
import hashlib, json, sys
from pathlib import Path

manifest = json.loads(Path("baseline/production/manifest.json").read_text())["files"]
for name in ("canvas.js", "canvas.css", "chat.js", "chat.css", "flowpicker.js"):
    data = (Path(sys.argv[1]) / name).read_bytes()
    assert {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()} == manifest["static/" + name], name
PY
```

## 运行和验收

准备 [基线 Python 环境](../baseline/README.md#本机运行)、FFmpeg（含 `libx264` 和 `ffprobe`）和 Chromium。

```sh
pnpm exec playwright install chromium
pnpm build
pnpm test:canvas-editor
```

测试启动原站参考服务和真实 Next 生产服务，两侧各用独立临时 SQLite、文件存储和会话，以相同画布、工作区、视口和主题比较。浏览器从无编辑器开关的真实项目 URL 加载 Next 编译的脚本，并拦截原 `canvas.js`、`chat.js` 和 `flowpicker.js`。测试运行真实的原站保存、扣费与取消、HTTP 下载、FFmpeg 合成、字幕和对话 SSE。GPU 结果由本机样本文件结算，Flow 队列与对话后端通过回环地址调用可控提供方。

测试比较桌面 1440×900 和手机 390×844 的浅色、深色画布与搜索画面，以及加载、项目不存在、保存、撤销、素材包、生成排队、候选确认和采用、旁白、成片预览、对话写回和冲突。原有 58 态加上跨空间无权限和真实 API 中断，共 60 态通过 UI DOM 一致和截图零像素差异验收。UI 树对照跳过 Next 框架脚本与占位元素。测试还验证了游客和过期会话跳回 `/studio`、直链的查询参数和锚点、私有媒体 Range 与权限，以及显式回退的 HTML 和 CSP。画布列表进入编辑器、创建画布后打开及返回列表由 `pnpm test:canvas-list` 验证。`pnpm test:studio-react` 从默认 React 工作台和显式原版入口出发，在同一 Next 服务中打开画布列表、默认编辑器和显式旧版编辑器，再返回 React 工作台并检查原工作区草稿。

两侧服务独立分配的成片、媒体和素材包编号按对应的持久化记录映射，对话请求路径映射会话编号。测试比较 54 个浏览器写请求的方法、路径、工作区头、修订号与 JSON 正文，以及上传正文的 SHA-256、媒体类型和取帧来源头。成功报告在 `.runtime-advanced/canvas-editor-parity/report.json`，UI 对照失败会另外输出两侧 DOM 和截图。

| 桌面浅色交互 | 持久化核对 |
| --- | --- |
| 拖动文本节点、撤销与重做、删除再拖动把手连线 | 对照保存后的坐标、边和修订号。在浏览器用抓手平移到指定偏移并缩放到 50%，刷新后核对本地存储和实际画布变换。 |
| AI 分镜生成、编辑和采用 | 断开首次 SSE，再连接真实事件流。编辑标题和时长后采用，核对节点、文案边、旁白与镜头顺序，刷新后复查。只有一次文字生成扣费。 |
| 图片上传、独立提帧、从视频建立下一镜头 | 回读私有媒体的 MIME 和完整字节，核对 0.25 秒、0.50 秒的存储像素、来源视频与取帧时间，以及新镜头首帧引用。 |
| 新建和更新素材包 | 验证名称、说明、用途与图片顺序，核对画布将素材包引用从修订 1 更新到修订 2。 |
| 模型变种与高级输入 | 验证 Muse 时长、Flow Omni/Veo 的具体变种、MiniMax H3 采样步数、种子、快速模式和首尾帧切换。H3 的无效时长视频返回 400，随后上传有效视频，并保存声音引用和提示词令牌。 |
| 失败重试和断线恢复 | 保存请求断开时核对本地草稿与服务端旧修订，恢复后重试。Flow 拒绝后的失败任务仅退款一次，随后把成功受理的提交响应丢弃，再用原 UID 确认同一任务，最终仅扣费一次。 |

设置 `TEST_DATABASE_URL` 和 `TEST_REDIS_URL` 指向隔离的 PostgreSQL 和 Redis，再运行 `pnpm test:canvas-editor-nest`。该测试将临时原站 SQLite 的画布历史导入 PostgreSQL，在 Chromium 中通过 Next 访问 Nest，并使用 BullMQ、本地版本化 provider 和私有测试媒体验证自动保存、素材、候选、旁白、成片、下载、聊天 SSE 写回、工作区权限、重放幂等和积分结算。

手工验收可另启独立数据目录。启动参考 API 后在另一个终端运行 Next，用临时目录中的登录信息登录 `http://localhost:3010/studio`，创建画布并打开 `/canvas/:id`。

```sh
.runtime-advanced/original/.venv/bin/python scripts/preview-original.py \
  --runtime-directory "$(mktemp -d)" --no-reuse-local-credentials \
  --port 4110 --public-url http://localhost:3010
```

```sh
STUDIO_MODE=original LEGACY_API_INTERNAL_URL=http://127.0.0.1:4110 \
  pnpm exec next start apps/web -H 127.0.0.1 -p 3010
```

在隔离的 Nest 环境中先迁移数据库，再导入历史。以 `API_PROTOCOL=original` 启动 Nest，令 `PUBLIC_URL` 等于浏览器访问 Next 的地址，并将上例 `LEGACY_API_INTERNAL_URL` 指向该 Nest 实例。使用该实例签发的会话和导入后的原公开编号。集成验收已覆盖上述画布链路，默认 `/studio` 使用原协议 Nest。
