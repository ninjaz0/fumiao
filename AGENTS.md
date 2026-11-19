# 弗淼开发指南

正式产品入口是 `/studio`。从用户给出的账号角色、工作区和操作路径开始验证。项目负责人确定需求、体验和发布时机；开发 Agent 负责复现、实现、验证、准备 PR，并在受托跟进时处理失败的检查。发布流程和数据恢复见 [运维手册](docs/OPERATIONS.md)。

## 从哪里开始读

| 改动 | 入口 | 需要保留的行为 |
| --- | --- | --- |
| 首页、登录、工作台、设置 | `apps/web/proxy.ts`、`apps/web/auth/`、`apps/web/studio/` | 从公开路由验证匿名及登录状态。复用已有组件、布局、文案和交互。 |
| 画布和分镜 | `apps/web/canvas-editor/`、`packages/original-api/src/canvases.ts` | 保存携带预期版本；并发冲突要保留用户草稿，并告知哪个保存失败。 |
| 网关、会话、权限、媒体 | `packages/web-compat/`、`apps/api/src/original*.ts`、`packages/original-api/` | Studio 和 v2 有各自的会话和标识符。验证工作区隔离、私有媒体权限和 Range 读取。 |
| 模型、队列、积分、支付 | `apps/worker/`、`packages/platform/`、`packages/plugin-sdk/`、`plugins/` | 提供方逻辑放入版本化插件。已接单任务保留插件、价格、计费和配置快照；重试、重启和并发回调应只结算一次。 |
| 兼容资源、路由、旧数据 | `baseline/production/manifest.json`、`baseline/contracts/routes.json`、`migrations/` | 固定静态资源的字节和哈希属于兼容契约。数据库升级还要覆盖老库、在途任务和已有回执。[迁移说明](docs/MIGRATION.md) |

服务栈为 Next.js / React、NestJS、PostgreSQL 18、Redis 8 / BullMQ 和私有存储。Compose 的 `api` 使用 Studio 的 original 协议，`api-v2` 服务 advanced 协议，`worker` 消费队列。排查 `/studio` 时先确定网关实际转发到了哪个服务。

## 一项任务一个工作目录

T3 已分配独立 worktree 时直接使用。手动创建可以从仓库执行以下示例，按任务替换路径和分支名。

```sh
git fetch origin main
git worktree add -b fix/canvas-save ../fumiao-canvas-save origin/main
cd ../fumiao-canvas-save
git status --short --branch
```

功能使用 `feat/*`，修复使用 `fix/*`。以 `main` 为集成主干。一个分支交付一个可独立验收的结果。在自己的 worktree 里编辑、安装依赖、启动环境和提交；先读已有未提交改动并保留它们。

## 启动隔离的 Docker 快反环境

需要 Git、Python 3、运行中的 Docker 和 Compose v2+。在当前 worktree 根目录执行：

```sh
python3 scripts/worktree.py up
python3 scripts/worktree.py status
python3 scripts/worktree.py logs api
python3 scripts/worktree.py logs worker
python3 scripts/worktree.py down
```

- `up` 从当前 checkout 构建开发镜像、创建专属网络与 PG / Redis / 媒体卷、执行迁移。新库自动创建合成管理员 `admin`。末尾输出本任务的 `/studio` 地址和本机密码文件位置。再次运行会复用本任务的数据与密钥。
- 项目名由 checkout 的绝对路径生成。每个项目使用独立的回环端口及 `*.localhost` 主机名，浏览器会话也按主机隔离。使用脚本打印的完整地址。任务可以并行；`http://localhost:3000/studio` 专用于负责人验收选定版本。
- 测试配置及管理员口令按项目保存在 `${XDG_STATE_HOME:-$HOME/.local/state}/fumiao/` 下。用合成用户、私有测试媒体和模拟提供方复现。日志、截图与 PR 只保留诊断所需信息，隐去 Cookie、密钥、商户参数和用户内容。
- Next 开发服务加载 Web 改动；Studio API、v2 API 和 Worker 通过 Node watch 重载已导入的源码。修改依赖、原生解码器或 SQL 迁移后重新运行 `up`。Linux 容器使用镜像内的依赖，Next 缓存属于本任务。
- `logs [服务名]` 读取当前项目最近的日志，`status` 列出服务。需要查测试库时，在 status 输出中确认 PG 容器名，再用 `docker exec -it <本任务的postgres容器> psql -U fumiao -d fumiao`。检查任务 ID、账本、画布版本等最小数据。
- `down` 只停止并移除本项目容器和网络，保留数据。移除 worktree 前先执行 `down`。若需要永久丢弃环境，先核对项目名和卷清单，再按本次任务的明确授权清理；独立存储的密钥应与对应数据一起管理。

## 修改与验证

先在同一条用户路径上复现问题，记录预期与实际结果。界面任务使用对应角色、视口、测试数据；失败的后台任务记录请求或任务 ID，沿 Web、API、Worker 和账本追踪。修复后用相同输入复测，覆盖相关失败分支。

本机运行 Node 24、pnpm 10.32.1。在新 worktree 中先执行 `pnpm install --frozen-lockfile`。涉及原生图片格式时执行 `pnpm images:prepare`。编译器、FFmpeg、PG 和 Redis 准备方式见 [README](README.md) 与 [Studio 开发说明](docs/STUDIO.md)。

| 时机 | 执行 | 验证内容 |
| --- | --- | --- |
| 本地改动后 | 后端和共享库跑 `pnpm typecheck`；Web 跑 `pnpm typecheck:web`；按影响范围跑 `pnpm exec tsx --test tests/advanced/canvases.test.ts` 等对应文件 | 前端类型、后端类型和目标行为。未配置真实数据库时部分并发用例会跳过。 |
| 平台变更、提 PR 前 | `pnpm test`、`pnpm build` | 平台与插件测试、类型检查和生产前端构建。可用专属的 `TEST_DATABASE_URL`、`TEST_REDIS_URL` 运行真实并发测试。 |
| 浏览器、网关、Worker 或任务链路变更 | 构建后运行 `pnpm exec playwright install chromium`、`pnpm test:studio` | 正式入口登录、生成、支付回跳、媒体、画布、任务结算、进程重启、路由响应。套件自行启动临时 PG/Redis 和回环模拟服务，需要 `initdb`、`postgres`、`redis-server`、FFmpeg。 |
| 涉及 advanced、恢复、多副本或 HTTPS | 按改动选择 `pnpm test:web`、`pnpm test:studio:restore`、`pnpm test:studio:replicas` 或 `pnpm test:studio:https` | `test:web` 走 advanced 模式。专门套件的附加依赖与演练步骤在运维手册中。 |

## PR、CI 和本机验收

1. PR 面向 `main`，说明用户能看到的变化、复现或验收步骤、实际执行的检查以及尚未验证的部分。UI 改动给出任务预览的具体路由与视口，必要时附截图；本机地址只在运行该环境的电脑上有效。
2. GitHub Actions 的 **Studio PR checks** 运行 PG 18 / Redis 8 平台测试、生产构建、advanced 冒烟、Chromium 正式入口验收和 Docker 镜像构建。失败时先定位失败阶段，复现并修复后在同一 PR 复查。预期发生变化时说明对应产品决定。
3. 负责人验收的固定实例使用基础 `compose.yaml` 和指定提交构建，本机 3000 展示的版本应可追溯。切换该实例前，在独立端口用测试账号验证登录、工作区和目标操作。日常开发只启动当前任务的快反环境。
4. 生产发布由负责人单独批准。涉及数据库、任务格式、钱包或媒体存储的 PR 写明兼容性、在途任务影响及恢复方法。部署与恢复使用对应版本的运维手册。
