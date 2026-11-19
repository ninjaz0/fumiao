# Studio 整合候选验收

2026-11-18 核对远端 PR45 `ce5f0189741a28c37570bb1b7b8ac8234c83b4b8`，确认其包含 PR43 `fc2ed1de39d97f1cfb41b24e92ecee31051d81f1`。在该提交上合并 PR44 `356c2c039cc4d8104516d51ff81c8425828a5ae7` 和 PR42 `7e91e98813f6f6424842b55790aae57e767a7296`。四个提交中定义的包脚本均保留原命令。固定生产清单、覆盖文件和归档静态资源的 Git 内容一致。

普通 `/studio` 对游客使用 React 登录/注册，对有效会话使用 React 工作台。日常启动器默认运行原协议 Nest 和 BullMQ worker。显式 `studio_ui=legacy` 可在当前会话中使用固定页面，显式 `STUDIO_BACKEND=python` 使用独立的 Python、SQLite、会话和媒体。Nest 不可用时，Next 保留固定工作台的加载和错误界面，代理 API 统一返回 502。验收同时检查默认文档的资源请求，确认原工作台、主题、模型选择和对话 JS 控制器均未加载。

## 隔离实测

使用 macOS arm64、Node 24.22.3、pnpm 10.32.1、固定依赖的 Python 3.12、Playwright 1.65.1 Chromium、PostgreSQL 18.7、Redis 8.10.3、SeaweedFS 4.54、FFmpeg 和 OpenSSL。真实服务绑定随机回环端口，数据库、队列、存储和账号为临时夹具。模型和支付请求均发往回环模拟服务。

| 已执行命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`、`pnpm exec playwright install chromium` | 依赖与 Chromium 就绪。 |
| `python3 scripts/preview-original.py --check`、`python3 scripts/list-original-routes.py --check` | 65 项固定运行文件摘要及 120 项原 HTTP 方法/路径通过。 |
| `pnpm build`、`pnpm typecheck` | TypeScript 检查和 Next 生产构建通过。 |
| `pnpm test`，未设置 `TEST_DATABASE_URL` 与 `TEST_REDIS_URL` | PGlite 232 项通过，14 项按既有条件跳过，0 失败。 |
| `pnpm test`，使用隔离的 `TEST_DATABASE_URL`、`TEST_REDIS_URL` 和固定 Python | 实际 PostgreSQL 与 Redis 上 246 项全部通过，0 跳过。 |
| `pnpm test:studio:nest --routes`、`pnpm test:studio:nest --s3 --routes` | 从默认生产启动器验证游客和登录、跨页、付款回跳及唯一到账、数字用户/工作区/任务编号、私有素材、成员隔离、BullMQ 图片生成和对话 SSE、画布写回、设置、账本、显式回退、重启和登出。120 项路由归属及停机响应符合清单，其中 11 项由 Next 提供，109 项由 Nest 提供。 |
| `node --import tsx scripts/smoke-studio-nest.ts --serve` | 验收后继续提供回环预览，访问 `/studio` 返回 React 游客入口，收到终止信号后正常退出。 |
| `pnpm test:studio:upgrade`、`pnpm test:studio:upgrade --s3` | 从固定 Python 生成旧数据并经正式 CLI 导出、并发导入及重放。验证旧会话失效、旧密码登录、历史公开编号、账本和任务重放、画布、对话、私有媒体及工作区访问。在默认开发预览验证导入，并在数据库、Redis 和 SeaweedFS 重启后由生产预览验证同一会话和数据。源备份指纹前后相同。 |
| `pnpm test:studio`、`pnpm test:web`、`pnpm test:canvas-editor-nest`、`pnpm test:studio-member-lifecycle` | 原协议和 v2 网关、画布生成/导出、SSE 与权限、普通配对与贡献节点、成员删除、租约撤销、重排与退款均通过。 |
| `pnpm test:home`、`pnpm test:auth`、`pnpm test:canvas-list`、`pnpm test:canvas-editor` | 分别 8、20、25、60 个状态通过 UI DOM 和零像素差分。 |
| `pnpm test:studio-react`、`pnpm test:studio-composer-nest`、`pnpm test:studio-chat` | 分别 142、30、32 个浏览器差分通过，另验证创作提交、幂等重放、工作区和草稿恢复。 |
| `pnpm test:studio-settings`、`pnpm test:studio-admin-settings`、`pnpm test:studio-gpu-settings`、`pnpm test:studio-billing-settings`、`pnpm test:studio-services` | 分别 138、192、64、64、56 个设置画面对照通过。请求与写回覆盖个人资料、积分和支付、团队与成员、GPU、目录定价、OpenAI、对话和存储。 |
| `pnpm test:recharge`、`pnpm test:identity`、`pnpm test:media`、`pnpm test:generation`、`pnpm test:estimate`、`pnpm test:state-import`、`pnpm test:state`、`pnpm test:nodes`、`pnpm test:downloads` | 原协议专项通过，包括 ZPay 与 EPusdt 模拟商户、历史对账、访问控制与归档。 |
| `pnpm test:provider-media`、`pnpm test:muse-lifecycle`、`pnpm test:flow-lifecycle`、`pnpm test:images-lifecycle`、`pnpm test:image-settings`、`pnpm test:native`、`pnpm test:references`、`pnpm test:timing`、`pnpm test:queue`、`pnpm test:provider-clock` | 版本化插件、媒体合同、调度、时间估算和恢复专项通过。 |
| `pnpm test:chat-provider`、`pnpm test:chat-settings`、`pnpm test:chat-storage`、`pnpm test:chat-runtime`、`pnpm test:chat-http`、`pnpm test:chat-import`、`pnpm test:chat-applications` | 对话配置、协议、历史导入、流式执行和画布采用专项通过。 |
| `pnpm test:canvas-draft`、`pnpm test:canvas-validation`、`pnpm test:canvas-storage`、`pnpm test:canvas-rest`、`pnpm test:canvas-import`、`pnpm test:canvas-runs` | 画布解析、修订保存、历史导入、生成及分镜导出专项通过。 |
| `pnpm images:prepare`、`pnpm test:images` | 从固定源码编译解码器后，116 项通过，0 像素差异。 |
| `pnpm exec tsx --test tests/advanced/fmworker-jobs.test.ts tests/advanced/storyboard-exports.test.ts`、`pnpm test:canvas-rest`，额外配置两个临时私有 SeaweedFS 桶 | S3 专项 21 项平台测试和 146 个画布 REST 场景通过，覆盖贡献回传、对象写入确认丢失、分镜合成、ZIP 和授权 Range。 |

联合验收确认 Next 匿名取媒体返回 401，其他工作区成员无法读取私有对象，SeaweedFS 匿名 GET 返回 403。已授权请求经 Next 收到 307 签名跳转，Range 返回 206，与原始字节一致。Chromium 实际加载模拟生成的私有图片。重启后复核对象、任务插件版本、Redis 队列事件、会话、画布、对话以及生成扣费和充值流水。

## 线上公开资源复核

2026-11-18 通过匿名 HTTPS GET 比对了 `nvmes.com` 公开提供的 23 个静态资源。使用清单中的 SHA-256 核对响应字节，内置头像使用公开路径 `/avatars/{filename}`。22 个文件一致，包括全部 12 个头像。清单中的另外 3 个 HTML 模板在 `/static/` 下返回 404，页面运行时行为由上述浏览器差分覆盖。

| 画布脚本来源 | 字节数 | SHA-256 |
|---|---:|---|
| 2026-11-17 固定快照 | 946144 | `f8d0f6c0ee07526093c0b3ae7cc9d914988bddc9c558ea1b276fe67e1a3ce201` |
| 本次读取的 `/static/canvas.js` | 947749 | `94cbb5f6f0967c1d360c7aacdd4e1b699eb2ec63943b36d8779c177a5cdbba60` |

默认 `/canvas/:id` 的 React 编辑器已迁移 `portableReferences`。选中适用的非 H3 节点或从 H3 切换模型时，编辑器按保留的 H3 引用顺序转换图片，复用已解析到同一素材的图片节点和已有连线，清除已转换的 H3 图片引用及首尾帧槽位。文字连线和视频引用保留。转换单独进入撤销历史。撤销转换后，若模型仍为非 H3，后续素材刷新会再次触发转换，与公开脚本一致。

此项线上变化由独立专项验收。11 月 17 日固定清单、覆盖文件、归档静态资源和原 60 态画布套件均保留。专项用 [11 月 18 日的两个脚本增量](../scripts/fixtures/canvas-portable-references-2026-11-18.json) 和固定脚本重建公开包，并核对完整字节数及 SHA-256。Chromium 从普通画布直链比较重建包和生产编译的 React 编辑器。两侧通过真实 Next 和原协议 Nest 保存到隔离 PostgreSQL，通过私有存储读取相同素材。专项比较完整 UI DOM、截图、带修订号的保存正文和清空浏览器草稿后的重新打开。用实际素材刷新复核撤销和重做。验收范围为该公开脚本和隔离数据上的原协议行为。

离线重建和显式加载本机公开包均通过 8 个场景、37 个完全一致的 DOM 与零像素差状态，以及每侧 10 次写请求的精确对照。场景覆盖空模型和 H3、仅视频引用、单图、多图与去重、首尾帧、节点及已有连线复用、切换模型和撤销重做。所有持久化场景均再次打开并选中节点，验证没有再次写入。

准备固定 Python 环境、FFmpeg、Chromium 及隔离的 `TEST_DATABASE_URL` 和 `TEST_REDIS_URL` 后可离线复跑。报告位于 `.runtime-advanced/canvas-portable-references/report.json`。

```sh
pnpm build
pnpm test:canvas-editor
pnpm test:canvas-editor-nest
pnpm test:canvas-portable-references
# 可选：使用本机保存的公开包复跑同一专项，脚本校验相同 SHA-256。
CANVAS_PUBLIC_JS=/path/to/live.js pnpm test:canvas-portable-references
```

## 功能缺口与部署验收

- 上述数据记录兼容候选的历史实测。后续产品决定取消贡献系统，外部页面验证随其退役。新版保留普通配对、本地执行及独立 Flow 提供方。[退役范围](FMWORKER_RESOURCES.md)
- 在隔离 Linux ARM64 虚拟机上从整合提交 `5e36815` 重新构建 Compose 镜像，使用空 PostgreSQL 卷、Redis、临时管理员和私有磁盘。完成迁移与初始化后，Chromium 在普通 `/studio` 进入 React 创作页，打开画布列表和编辑器，并验证显式 legacy 入口。通过 Next 验证原协议和 v2 分派、数字工作区、画布写入、匿名媒体拒绝及登录后的 Range。真实 BullMQ worker 通过回环提供方返回对话 SSE，同 UID 重放仅调用一次提供方、只扣费一次。重复 bootstrap 保留目录修订，显式 Advanced 模式及切回正常模式均通过。
- 实际 Pure 数据备份、生产存储容量与恢复、HTTPS/Cookie/SSE、真实提供方与 GPU 结点、授权支付商户和生产负载须由部署方在目标预发环境验收。见 [运行与验收](OPERATIONS.md)。
