# 原协议 Nest 工作台验收

`pnpm dev:web`、`pnpm start:studio` 和 Docker Compose 默认将 `/studio` 接到原协议 NestJS、PostgreSQL、Redis/BullMQ 和私有存储。固定清单的 120 个 HTTP 方法与路径中，Next 提供 11 项，Nest 经 Next 提供 95 项，另有 14 项贡献路由在网关返回 410。普通 `/studio` 默认渲染 React。显式 `/studio?studio_ui=legacy` 加载固定页面并继续连接所选后端。

| 实际归属 | 方法 / 路径范围 | 数量 |
|---|---|---:|
| Next | 首页 `/`、`/studio` 和尾斜杠跳转，各含 GET、HEAD | 6 |
| Next | 画布列表 `/canvas`、编辑器 `/canvas/{project_id}` | 2 |
| Next | `/static/{file}` 的 GET、HEAD，内置头像 `/avatars/{filename}` 的 GET | 3 |
| Nest | 原协议业务 `/api/*` | 81 |
| Nest | 普通配对节点 `/agent/*` | 8 |
| 退役 | 资源、奖励和验证的 API 8 项，贡献客户端方法 6 项 | 14 |
| Nest | `/health` 的 GET、HEAD；安装包 `/connect/{file}`、上传头像、私有媒体和支付回跳各一项 | 6 |

## 持久预览

先准备专用于这套工作台的 PostgreSQL 数据库和持久 Redis 实例，Redis 启用持久化并使用 `noeviction`。使用 Node 24 和项目的 pnpm。创建本机专用配置 `.env.studio-nest`，权限设为 0600。以下为配置格式，连接地址和密钥按自己的实例填写。

```dotenv
DATABASE_URL=postgresql://studio:替换为专用数据库密码@127.0.0.1:55432/studio
REDIS_URL=redis://127.0.0.1:56379
ENCRYPTION_KEY=替换为固定的32字节Base64密钥
MEDIA_DIRECTORY=.runtime-advanced/studio-nest/objects
STUDIO_RUNTIME_DIRECTORY=.runtime-advanced/studio-nest
# 迁移已有工作区时必须设置，值与导出时的 --source 一致。
# STUDIO_LEGACY_SOURCE=旧实例标识
```

可用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` 为新库生成密钥，重启和恢复时继续使用同一密钥。磁盘目录需提前创建并由运行用户访问，权限设为 0700。使用 S3 时设置私有 `S3_BUCKET`，按需配置 `S3_ENDPOINT`、`S3_REGION`、`S3_PATH_STYLE` 和凭据，签名 URL 的主机须可被浏览器访问，并将 `STUDIO_MEDIA_ORIGIN` 设为对应的源地址。生产配置保存在版本库和镜像之外。多副本和对象存储验收见 [运维说明](OPERATIONS.md)。

```sh
mkdir -m 700 -p .runtime-advanced/studio-nest/objects
STUDIO_ENV_FILE=.env.studio-nest pnpm dev:web
# 生产构建预览，先停止开发预览
pnpm build
STUDIO_ENV_FILE=.env.studio-nest pnpm start:studio
```

启动器读取 `STUDIO_ENV_FILE` 或仓库根目录的 `.env`，当前进程变量优先。它应用 PostgreSQL 迁移并安装内置的版本化插件清单，确认存在活跃管理员、指定导入已完成、私有磁盘目录可用且 Redis 可连接后，再启动工作台。通过 `http://localhost:3000/studio` 访问；可配置 `STUDIO_PORT`、`LEGACY_API_PORT` 和浏览器 origin `STUDIO_PUBLIC_URL`（也可使用 `PUBLIC_URL`）。配置或服务错误会退出并提示检查项。网关遇到后端连接错误返回 502，写请求只有一个固定上游。

已有工作区按 [备份和导入步骤](MIGRATION.md#迁移前) 操作。全新安装才运行以下命令，先将自己的 `ADMIN_PASSWORD` 注入当前进程。积分和提供方连接随后由管理员配置。

```sh
API_PROTOCOL=original node --env-file=.env.studio-nest --import tsx scripts/migrate.ts
API_PROTOCOL=original node --env-file=.env.studio-nest --import tsx scripts/bootstrap.ts
```

停止预览后，显式执行 `STUDIO_BACKEND=python pnpm dev:web` 或 `STUDIO_BACKEND=python pnpm start:studio` 切换到兼容回退。两套后端各自管理账号、会话、任务和媒体。切回 Nest 时，使用原有的 PostgreSQL、Redis、密钥和存储配置即可继续使用已有记录。已经产生写入后的业务回退须先按 [迁移验收和切换步骤](MIGRATION.md#验收和切换) 对账。

### HTTPS 入口

将 TLS 反向代理的上游指向 Next 的 HTTP 监听地址。保留公开的 `Host` 和浏览器发来的 `Origin`，由反向代理覆盖转发头，将 `X-Forwarded-Proto` 设为 `https`，并逐段转发 SSE 响应。Nest 的 `PUBLIC_URL` 必须与浏览器 origin 完全一致，包括 `https://` 和非默认端口。直接访问 HTTP 时使用相应的 HTTP origin。启动器会自动为 Next 设置 `LEGACY_API_INTERNAL_URL`。分开启动时，将该变量指向内网的原协议 Nest，Compose 默认使用 `http://api:4000`。

回环复跑使用 `pnpm exec playwright install firefox`、`pnpm build` 和 `pnpm test:studio:https`。需要 `openssl`、NSS `certutil`、PostgreSQL 和 Redis，可用 `STUDIO_CERTUTIL`、`PG_BINDIR`、`REDIS_SERVER` 指定路径。脚本创建临时 Firefox profile，只在该 profile 中导入本次生成的 CA，使用临时私有磁盘和模拟聊天 provider。

## 隔离验收

使用 Node 24、pnpm、Chromium、OpenSSL、已准备的固定版 Python 环境，以及可以直接运行的 PostgreSQL 和 Redis 服务端二进制。通过 `pnpm exec playwright install chromium` 准备浏览器。若 `initdb` 和 `postgres` 不在 PATH，通过 `PG_BINDIR` 指定所在目录。可以通过 `REDIS_SERVER` 指定 `redis-server` 的路径，通过 `STUDIO_PYTHON` 指定准备好的 Python 可执行文件。

```sh
python3 scripts/list-original-routes.py --check
pnpm build
pnpm test:studio:nest --routes
pnpm test:studio:upgrade
pnpm test:studio:nest --serve
```

`--routes` 输出每组方法和固定路径模板、归属及 HTTP 探测状态。省略该参数时输出汇总。使用 `--serve` 时，脚本完成启动、路由和首轮业务检查后保留实例，并打印 `/studio` 地址和临时账号。按 Ctrl+C 会清理实例。

验收在随机回环端口启动独立 PostgreSQL、Redis 和 0700 私有对象目录。默认生产启动拒绝缺少配置、空库和不可用 Redis。显式建立临时管理员和回环模拟提供方后，启动器在未设置 `STUDIO_BACKEND` 时运行原协议 Nest 和 BullMQ worker。验收使用显式 Python 回退，再重启 PostgreSQL、Redis 和 Nest 默认预览，核对会话隔离及持久数据。

`test:studio:upgrade` 从固定 Python 应用生成合成账户、钱包和实际私有素材，保存 SQLite 一致性备份，用正式 CLI 导出并导入。它验证并发导入和重复导入、拒绝变化的媒体、旧会话失效和原密码登录，以及开发预览和生产预览重启后恢复同一 Nest 会话、旧浏览器草稿、画布、对话、历史任务、权限、钱包/账本和版本化插件目录。备份字节和修改时间会在验收结束时重新核对。测试使用临时目标，所有真实上游均不参与。

路由探测同时核对 Nest 启动后的精确 Express 方法及路径、直连 Nest 和经 Next 的状态与响应。鉴权或校验错误仍要求对应方法在精确控制器路径上注册。Nest 停机后，95 项转发方法从 Next 返回 502，14 项贡献方法继续返回 410，其余 11 项仍由 Next 提供。因此 Next 的 catch-all、通用 404 和兼容后端不会被计为实现。实测还包括登录、状态聚合、画布创建、私有素材上传和 Range、BullMQ 对话 SSE、同一请求只结算一次及登出。路由核对覆盖方法和分派，独立差分测试覆盖各业务的详细输入和输出。

同一次正常启动验收在 Chromium 中从默认 `/studio` 表单登录并进入 React 工作台，同时检查显式回退返回固定 HTML。以回环 ZPay 模拟收银台走完建单、回跳、查单和重复通知，验证一笔到账流水。随后由 BullMQ worker 通过版本化内置图片插件调用回环服务，完成提交、结算、私有结果读取和资产回填。对话回复写入画布并打开编辑器，返回后访问模型管理、生成定价、积分管理、OpenAI、对话服务和存储空间。关闭、切换及重启服务后，原浏览器恢复会话、创作和对话草稿、回复、画布、媒体、任务及账本。单独的差分验收覆盖视频、图片和语音创作，以及两种后端的定价与权限写入。

私有 S3 验收需要本机 SeaweedFS `weed`（已验证 4.54）。`weed` 在 PATH 中时直接运行以下命令，也可以用 `STUDIO_WEED=/path/to/weed` 指定可执行文件。每次执行都会启动回环 SeaweedFS、生成临时凭据并创建私有桶，退出时清理实例及数据。

```sh
pnpm test:studio:nest --s3 --routes
pnpm test:studio:upgrade --s3
```

两种模式均在随机回环端口上通过日常启动器运行 Next 生产预览、原协议 Nest 和 BullMQ worker，并使用独立的 PostgreSQL 和 Redis。默认验收使用 0700 临时私有对象目录，并检查对象文件权限。`--s3` 通过启动器的 `STUDIO_ENV_FILE` 传入临时 S3 配置及媒体源地址。验收检查 Next 返回 307 签名跳转、S3 匿名请求返回 403、签名 Range 返回 206，以及 Chromium 实际显示生成的图片。两种模式均按字节核对上传内容，并检查 Next 拒绝未登录和跨工作区的媒体请求。SeaweedFS 重启后继续校验同一私有对象和签名 Range。整合候选的完整命令和实测结果见 [整合验收](STUDIO_STACK_ACCEPTANCE.md)。

### PR41 / PR42 历史验收

启动前核对远端 PR38 head 为 `d38b750fe07551c84ed016eafa07404e0cc24bab`，PR39 head 为 `73f1b922abc310efc666b211c0671db91c127c5d`。使用 Node 24.22.3、pnpm 10.32.1、PostgreSQL 18.7、Redis 8.10.3、SeaweedFS 4.54、Playwright 1.65.1 的 Chromium 以及固定版 Python 虚拟环境。两个存储模式分别创建临时运行时、数据库和 Redis，图片和对话均使用回环模拟提供方。

| 命令 | 实测结果 |
|---|---|
| `python3 scripts/preview-original.py --check` | 65 个固定生产运行时文件通过摘要校验。 |
| `python3 scripts/list-original-routes.py --check` | 120 个原方法和路径通过清单校验。 |
| `pnpm build` | TypeScript 检查和 Next 生产构建通过。 |
| `pnpm test`，设置 `TEST_DATABASE_URL`、`TEST_REDIS_URL` 指向独立回环实例，并将 Python 虚拟环境的 `bin` 加入 `PATH` | 246 项全通过，无跳过。 |
| `pnpm test:studio:nest --routes` | 私有磁盘通过。文件权限为 0600，Next 匿名请求返回 401，已登录 Range 返回 206，完整对象与 Range 字节一致。Chromium 跨页与重启验收通过，120 项路由均符合归属和停机响应。 |
| `pnpm test:studio:nest --s3 --routes` | 私有 SeaweedFS 通过。Next 匿名请求返回 401，桶内对象拒绝匿名 GET 并返回 403。Next 返回签名 307，签名 Range 返回 206，完整对象与 Range 字节一致。Chromium 实际加载图片，跨页与重启验收及 120 项路由均通过。 |
| `pnpm test:studio`、`pnpm test:web` | 原 API / Next 集成和隔离 Advanced API 集成通过。 |
| `pnpm test:auth`、`pnpm test:home` | 登录和注册的 20 个状态、首页的 8 个状态均为相同 DOM、零像素差异。 |

PR38 和 PR41 曾在 PGlite 上复现三项 fmWorker 断言失败。PGlite 将 `bytea` 读为 `Uint8Array`，node-postgres 将相同字节读为 `Buffer`。用量键的测试和验证结果的 User-Agent 回退现在均显式按 UTF-8 解码，保留用量键里的 NUL 字节。GPU 用例失败的字段是任务公开编号 `jobs.public_id`（`bigint`）。PGlite 将小值读为数字，node-postgres 返回十进制字符串，测试现在用 `public_id::text` 核对同一个公开编号。积分与结算断言保持原有覆盖。

修复后，`pnpm exec tsx --test tests/advanced/fmworker*.test.ts` 在 PGlite 上通过 11 项，在临时 PostgreSQL 18.7 / Redis 8.10.3 上通过 12 项。全量 `pnpm test` 分别通过 232 项和 246 项，均无失败。PGlite 的 14 项跳过仍由原有 PostgreSQL / Redis 环境条件控制，真实服务运行无跳过。`pnpm build` 通过。

## 本次修复

- 默认启动会把早期目录的种子插件版本映射到支持原协议的同目录版本，保留公开模型、价格金额、价格与策略修订、显式选择的其他版本、现有连接和历史任务快照。导入后的历史连接保留为禁用归档，真实连接按部署现场配置。

- 原工作台管理员的 `DELETE /api/users/{uid}` 沿用 PR32 的单一实现。删除撤销会话与配对码、移除名下节点并中断其运行任务。普通配对节点按 `attempts < 2` 重排并保留冻结，第二次中断失败并退款一次。公开编号、历史关系和账本保留，上传头像在最后一次引用消失后清理。
- `HEAD /health` 原被校验中间件拒成 405；现在与 GET 一样有原协议契约，GET 恢复原版 `service: "fumiao"`。Next 本地内置头像的未找到响应恢复原版错误文案。
- `pnpm test:nodes` 和 `pnpm test:studio-member-lifecycle` 对照固定版 Python 和 Nest 的成员删除、会话、失效凭据、头像清理、两次任务尝试及账本。

## 切换前仍待验证

切换前须在目标环境验收实际数据迁移、私有对象存储和容量、真实模型与支付商户。贡献节点专用的 Flow 验证接口随资源池退役。
