<img src="assets/icon.svg" width="64" height="64" alt="">

# 弗淼 · Fumiao

面向团队的 AI 创作工作台。用户在 `/studio` 生成图片、视频和语音，管理素材，通过画布编排镜头，并与团队共享工作区。模型通过版本化插件接入。默认应用使用 Next.js、React、TypeScript、NestJS、PostgreSQL、Redis/BullMQ 和私有存储。

## Docker Compose 启动

在仓库根目录运行 `cp .env.example .env` 和 `chmod 600 .env`。在配置中填写随机字母数字的 `POSTGRES_PASSWORD`、浏览器访问地址 `PUBLIC_URL` 和固定的 `ENCRYPTION_KEY`。加密密钥可用 `openssl rand -base64 32` 生成，应随数据库备份妥善保管。

```sh
docker compose build
docker compose up migrate
```

全新安装时先将自选的 `ADMIN_PASSWORD` 导出为环境变量，再初始化管理员。已有工作区请先在独立目标上完成[数据导入](docs/MIGRATION.md)。

```sh
docker compose run --rm --no-deps -e ADMIN_PASSWORD api pnpm bootstrap
docker compose up -d --wait
```

打开 `http://localhost:3000/studio`，新实例的默认管理员用户名为 `admin`。Compose 将 Web 绑定在本机 3000 端口。对外服务通过 HTTPS 反向代理接入，`PUBLIC_URL` 应与浏览器地址一致。[部署、备份与恢复](docs/OPERATIONS.md)

1. 在「设置 → 插件」点「导入插件」。全新安装的列表为空。仓库提供 [Flow2API](plugins/flow/flow.fmplugin.json)、[Muse2API](plugins/muse/muse.fmplugin.json)、[GPU 节点](plugins/gpu/gpu.fmplugin.json) 和 [兼容对话](plugins/compatible-chat/compatible-chat.fmplugin.json) 四个独立文件。
2. 确认插件及模型清单后，在卡片中打开「设置」，填写服务地址及密钥并测试连接。可以勾选模型，进入生成定价设置各档积分，或添加第二个服务。卡片开关对全平台生效。
3. GPU 插件安装后，平台管理员可在「设置 → GPU 节点」配对服务器。关闭插件仍可管理节点，并继续处理已受理的任务。
4. 在创作页选择模型并生成。管理员可在插件卡片检查更新、查看变更并确认安装。[插件包及更新源格式](docs/PLUGINS.md)

## 本地开发

每个任务可在独立 Git worktree 运行 `python3 scripts/worktree.py up`。脚本创建专属端口、测试账号、数据库、队列和媒体卷，输出本任务的 Studio 地址。开发者须在任务交付前运行 `python3 scripts/worktree.py down` 清理本任务的容器和网络，保留测试数据。修复并自测后，开发 Agent 将任务分支的提交部署到本机 3000 端口的固定 Docker 验收实例。负责人在 `/studio` 验收通过后再提 PR，CI 通过后合入 `main`。具体步骤见 [开发指南](AGENTS.md#从问题到合并)。

使用 Node.js 24、pnpm 10.32.1、PostgreSQL、Redis 和 FFmpeg。图片解码构建需要 CMake 3.20+、Ninja 和 C++ 编译器。先安装依赖，再按[本地工作台配置](docs/STUDIO.md)准备数据库、私有存储和管理员。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm images:prepare
pnpm dev:web
```

| 目录 | 用途 |
| --- | --- |
| `apps/web`、`apps/api`、`apps/worker` | 网页、HTTP 服务和后台任务 |
| `packages/` | 权限、账本、存储、工作台协议与插件 SDK |
| `plugins/` | 模型、GPU 执行端和支付适配器。[插件开发](docs/PLUGINS.md) |
| `migrations/`、`scripts/` | 数据库迁移、初始化、数据导入和构建 |
| `baseline/` | 随工作台发布的界面资源、文件指纹和 HTTP 路由清单 |
| `tests/` | 平台测试、测试工具和新版服务集成测试 |

## 验证

`pnpm test` 运行平台与插件测试。设置专用的 `TEST_DATABASE_URL` 和 `TEST_REDIS_URL` 可覆盖真实 PostgreSQL、Redis 与 BullMQ。集成测试使用临时数据和本地模拟提供方。

```sh
pnpm build
pnpm exec playwright install chromium
pnpm test:studio
```

`test:studio` 从正式版入口验证登录、生成、支付回跳、画布、私有媒体、任务结算、服务重启和路由响应。需要可执行的 `initdb`、`postgres` 和 `redis-server`，可通过 `PG_BINDIR` 和 `REDIS_SERVER` 指定路径。GPU 和数据导出工具使用 Python 3；工作台只运行新版服务。

向 `main` 提 PR 或推送到 `main` 时，[verify](.github/workflows/ci.yml) 使用 PG 18 和 Redis 8、构建生产前端、验证正式入口并构建 Docker 镜像。
