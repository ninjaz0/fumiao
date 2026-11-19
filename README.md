# Fumiao Advanced · 弗淼

本机默认用 Docker Compose 运行，入口为 `http://localhost:3000/studio`。Next.js、原协议 NestJS、Advanced API、BullMQ worker、PostgreSQL 和 Redis 均在容器内。已有 Pure 工作区先备份并导入，全新安装单独初始化。见[容器启动](#docker-compose-启动)和[历史数据迁移](docs/MIGRATION.md)。

面向团队的 AIGC 创作平台。新平台使用 TypeScript / NestJS / Next.js / PostgreSQL / Redis + BullMQ，模型提供方通过版本化插件接入。

这是从 `ninjaz0/fumiao-aigc-pure` 迁出的独立开发仓库。原应用源码保存在 `legacy/pure/`，当前原样预览所需的线上差异与哈希固定在 `baseline/production/`。Advanced 服务独立实现，后续逐项兼容原站接口。

## Advanced 开发版能力

- 账号、邀请码、个人/团队工作区、团队成员、模型权限、管理员与普通用户隔离。
- 图片、视频、语音、对话任务；积分冻结、成功结算、失败退款、提交幂等与异常核对。
- React 创作工作台、React Flow 画布、多轮对话、素材库、素材包、收藏、充值与插件管理。
- Muse、Flow、GPU H3/Breeze、兼容图片/对话提供方、分镜 MP4 合成插件。
- 独立 HTTP 插件安装、JSON Schema 配置、版本固定、连接启停、并发设置、模型定价。新增远程提供方不需要改核心代码。
- GPU 单次接入码、节点凭据、租约心跳、结果校验与重复回传保护。
- ZPay / EPusdt 支付适配器：签名验证后再次查询网关，订单和积分在同一事务中结算。
- 私有磁盘或 S3 对象存储、工作区容量限制、媒体权限和范围读取。
- Pure SQLite 导出/导入工具，保留账号、余额、媒体、历史任务和文档。

**迁移状态**。默认业务后端为原协议 NestJS，可通过 `STUDIO_BACKEND=python` 显式启动 Python 兼容服务。首页、登录/注册、已登录的 `/studio`、画布列表及 `/canvas/:id` 默认使用 React / TypeScript。工作台可用 `/studio?studio_ui=legacy` 显式回退，已有 `?studio_ui=react` 链接仍可访问。画布项目 URL 加上 `canvas_ui=legacy` 可在同一服务回退到固定生产页面。也可用 `STUDIO_CANVAS_EDITOR=legacy` 全局回退。普通 GPU 节点、充值和画布由原协议 Nest 提供。fmWorker 贡献客户端、资源池和奖励已退役。生产数据、实际提供方和支付商户仍需部署验收。[迁移说明](docs/MIGRATION.md) · [画布编辑器一致性](docs/CANVAS_EDITOR_PARITY.md)

### 分阶段验收记录

日常预览从 `.env`、`STUDIO_ENV_FILE` 或当前进程读取配置。运行 `pnpm build && pnpm test:studio:nest --routes && pnpm test:studio:upgrade` 可重跑固定 120 项路由覆盖、后端切换、合成历史数据导入和重启验收。两条验收命令均支持 `--s3`。[整合候选实测](docs/STUDIO_STACK_ACCEPTANCE.md) · [持久配置和隔离验收](docs/ORIGINAL_NEST_STUDIO.md)

登录后直接进入 `/studio` 使用 React 工作台。运行 `pnpm test:studio-react` 对照 Python 兼容路径的创作表单、任务队列和资产库。运行 `pnpm test:studio-composer-nest` 在 Python 兼容和 Nest 原协议下对照同一会话的创作、结果回填、对话、画布、设置和积分结算。`pnpm test:studio-chat` 验收对话和跨视图草稿，`pnpm test:studio-services` 验收 OpenAI、对话服务和存储设置。[默认入口与验收](docs/UI_PARITY_MIGRATION.md#已登录工作台一致性验收)

身份、团队、邀请码、积分历史/调整及模型/价格设置的原协议 NestJS 实现已通过隔离验证，运行 `pnpm test:identity` 可与固定的原 Python 服务做真实 HTTP 对比。旧邀请码、兑换记录、账本、模型权限与分档价格已支持可用数据迁移。Muse、Flow、GPU、图片、对话插件的 1.1.0 版本提供原目录元数据（111 个模型、124 个价格档位），任务保存版本和计费快照；1.0.0 仍保留供已接受任务使用。相关边界及未迁移项目见 [原协议迁移进度](docs/UI_PARITY_MIGRATION.md#原协议身份契约的-postgresql-实现隔离验证中)。

原素材 URL、私有读取、Range、头像文件迁移、收藏、参考素材/批量删除、打包下载和素材包 CRUD 已支持 NestJS/PostgreSQL。原排队任务撤回、单条任务删除也已适配，保留权限、状态限制、引用保护与一次退款。`pnpm test:media` 覆盖 175 项原服务对照。图片转换在独立 Node 工作线程运行，`pnpm test:images` 的 116 项格式、错误和像素对照已通过，详见 [图片验收与构建](docs/IMAGE_IMPORT.md)。后续原状态、画布和分镜链路见 [功能迁移清单](docs/MIGRATION.md#功能迁移清单)。

任务耗时估算、执行记录与历史计时已迁入 TypeScript/PostgreSQL，并作为 Muse、Flow、GPU、图片插件的 `1.2.0` 可选能力提供。156 个估算场景、123 组特征和 41 个执行状态与原实现严格一致。`1.3.0` 新增队列预测、GPU 领取资格和请求提供方容量探测，100 个队列场景、984 个任务预测通过原版对照。下文记录了后续版本的原任务和状态契约。详见 [计时迁移](docs/TIMING_MIGRATION.md) 和 [队列迁移边界与验收](docs/QUEUE_MIGRATION.md)。

Muse `1.4.0` 补充上游排队、开始及阶段时间同步，141 个场景、145 个状态快照与原实现对照一致；本地假提供方验证轮询不重发生成请求、私有产物保存与重复结算保护。完整原生成/状态契约和 UI 迁移仍需继续。

GPU `1.4.0` 增加版本化音视频参考上传能力，转码在 FFmpeg 子进程完成，参考信息进入 PostgreSQL 并保存到私有存储。32 个原版转码场景的字节、元数据和错误完全一致，历史导出/导入也保留时长、帧率和声音信息。GPU `1.5.0` 进一步增加首尾帧、9 张图片 / 12 个混合参考输入冻结、worker 消费及成片验收，已通过原版差分和本地模拟渲染器的完整回传验证。后续状态接口和 React 编辑器已通过隔离验收。详见 [参考素材迁移](docs/REFERENCE_MEDIA.md) 与 [原生 GPU 迁移](docs/NATIVE_GPU.md)。

原视频、图片、音频生成提交已增加 NestJS/PostgreSQL 实现，由 GPU `1.6.0`、Muse `1.5.0`、Flow / 图片 `1.4.0` 的版本化插件适配。原公开编号、UID 重试、父任务继承、素材包与参考冻结、提交估时及积分变化通过 `pnpm test:generation` 的 91 项真实原服务对照。并发请求共用原子计费/入队事务；状态聚合和路由归属的后续验收见下文。详见 [原生成提交契约](docs/ORIGINAL_GENERATION.md)。

原 `/api/estimate` 已进一步接入 GPU `1.7.0`、Muse `1.6.0`、Flow / 图片 `1.5.0`。`pnpm test:estimate` 的 197 项 HTTP 对照与 148 组特征向量通过；只读查询保留节点状态、隐藏模型与排队原因，不创建任务或计费。详见 [原估时查询](docs/ORIGINAL_ESTIMATES.md)。React 工作台仍在候选阶段。

独立 Nest 应用已挂载完整 `/api/state`，GPU `1.8.0`、Muse `1.7.0`、Flow / 图片 `1.6.0` 提供版本化公开配置、任务投影、队列分组及恢复规则。`pnpm test:state` 通过 7 项历史数据检查和 27 项完整 HTTP 快照/契约；另验证 GPU 中断重试与一次退款、旧插件行为和图片参考角色。详见 [原状态聚合接口](docs/ORIGINAL_STATE.md) 与 [原状态数据迁移](docs/ORIGINAL_STATE_DATA.md)。上文较早阶段的状态接口缺口已在此范围补齐。原协议路由归属、可复跑的整套本地启动及当前切换边界见 [原协议 Nest 工作台验收](docs/ORIGINAL_NEST_STUDIO.md)。

Nest 原协议支持普通 GPU 节点的配对、安装包、注册回执、管理员控制、心跳、领取和结果回传，包含视频与语音并发通道。`pnpm test:nodes` 使用固定 Python 基线、临时 PostgreSQL 和本地模拟节点进行 HTTP 对照。配对节点执行任务时按工作区消费账本扣费或退款。详见 [原节点管理](docs/ORIGINAL_STATE.md#原节点管理) 和 [旧贡献系统退役说明](docs/FMWORKER_RESOURCES.md)。

Muse `1.8.0`、Flow `1.7.0` 已进一步将原成品地址转换、鉴权下载、大小限制和下载失败处理移入插件。609 项原函数对照及本地 HTTP 执行测试通过，Muse 下载恢复不重新生成或重复计费。完整产物格式验收和其余异常路径仍待迁移，详见 [提供方成品下载](docs/PROVIDER_DOWNLOADS.md)。

Muse `1.9.0`、Flow `1.8.0` 进一步补齐插件成品验收：保留 EXIF 尺寸、原文件字节、首帧检查和视频方向/时长限制。74 个合成文件的 296 项原函数对照及完整保存/退款/繁忙重试测试通过；原图片上传 116 项对照仍通过。详见 [提供方成品验收](docs/PROVIDER_MEDIA.md)。

Muse `1.10.0` 继续补齐原提交/轮询错误、60 秒持久化退避、未知提交不重发、原提示文案和账户/图片准入维护。`pnpm test:muse-lifecycle` 的 82 个原队列场景、126 个状态/积分/计时快照在隔离 PostgreSQL 和 PGlite 通过，另覆盖并发恢复及一次结算。见 [Muse 请求生命周期](docs/MUSE_LIFECYCLE.md)。

Flow `1.9.0` 增加原 SSE 解析、安全错误、串行领取、进度健康和中断保存行为。`pnpm test:flow-lifecycle` 对照 76 个原队列场景、210 个错误映射及 2400 个 HTML 解码结果，PostgreSQL / PGlite 与并发恢复测试通过；保留旧版本及原 UI。Flow 通过已配置的提供方连接执行，详见 [Flow 流式生成与恢复](docs/FLOW_LIFECYCLE.md)。

图片 `1.7.0` 补齐原 HTTP / multipart、严格 Base64 和 PNG 检查、串行准入、失败退款及重启不重发规则。`pnpm test:images-lifecycle` 的 214 个执行场景和 55 个格式文件与原 Python 对照；输出与扣费原子提交，保留请求编号和 usage。见 [图片生成执行与恢复](docs/IMAGES_LIFECYCLE.md)。图片管理端配置与测试连接的后续支持见下文。

图片 `1.8.0` 进一步接入原设置和测试连接接口。84 个 HTTP 场景核对校验顺序、权限、模型开关联动、修订号、只读探测和错误说明，另验证并发保存与事务回滚。详见 [原图片设置与连接探测](docs/IMAGE_SETTINGS.md)。对话会话、充值和画布的后续进展见 [功能迁移清单](docs/MIGRATION.md#功能迁移清单)。

对话 `1.2.0` 新增原流式/标题/探测插件及 Nest 对话配置接口。181 个提供方场景、30 个上下文场景和 81 个 HTTP 设置场景通过原服务对照；另验证加密凭据、并发配置和版本升级。详见 [原对话提供方与配置](docs/CHAT_PROVIDERS.md)。独立 PostgreSQL 会话存储、一次计费与 BullMQ 执行已通过 86 个存储场景、26 个运行场景及跨实例/Redis 测试，见 [原对话存储与执行](docs/CHAT_CONVERSATIONS.md)。完整会话历史导入又通过 30 个原服务操作对照及回滚/幂等测试。后续发送、SSE 和画布采用的 Nest 路由见 [原对话 HTTP](docs/chat-http.md)。

画布输入及图结构校验已迁为 TypeScript；Muse `1.11.0`、Flow `1.10.0`、GPU / 图片 `1.9.0` 通过插件声明原模型规则与模板选型。324 个输入、6,247 个规则和 55 个模板场景已对照。原画布的独立 UTF-8 存储、基本 CRUD、复制和引用关系又通过 61 个原服务操作快照及 5,041 组旁白顺序对照，包含并发修订、容量和事务回滚。完整画布历史现已支持无损导入，并通过 36 个导入后原服务操作对照、回滚和幂等测试。单次生成、候选批次、旁白和运行列表的内部事务服务已通过 95 个原版场景对照；后续的原协议 Nest HTTP、导出和 React 编辑器验收见 [画布迁移边界](docs/UI_PARITY_MIGRATION.md#原画布-rest-与运行-http显式启用)。

## 目录

```text
apps/api/             NestJS HTTP API
apps/web/             Next.js / React 工作台
apps/worker/          BullMQ 独立任务进程
packages/plugin-sdk/  版本化提供方契约
packages/platform/    业务、权限、账本、调度与存储
packages/web-compat/  原版页面指纹校验、HTTP/SSE 兼容网关
packages/original-api/ 原请求契约的 PostgreSQL 实现
plugins/              提供方适配器和 GPU v2 执行端
migrations/           PostgreSQL SQL 迁移
scripts/              初始化与旧数据迁移
legacy/pure/          原平台、伴生服务、推理运行时与客户端归档
```

## Docker Compose 启动

安装 Docker 并启动引擎。在部署目录执行。已有配置的实例保留原 `.env` 和 `ENCRYPTION_KEY`。

```sh
# 仅首次创建配置时运行，生成权限为 0600 的 .env 和随机密钥
sh scripts/init-compose-env.sh
docker compose build
docker compose run --rm migrate
```

全新空库在 Bash 或 Zsh 中输入自选管理员密码。此命令将密码仅传给一次性初始化容器。

```sh
(read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD && docker compose run --rm --no-deps -e ADMIN_PASSWORD api pnpm bootstrap)
```

已有 Pure 数据的实例在新库设置 `STUDIO_LEGACY_SOURCE` 后执行[备份与导入](docs/MIGRATION.md#导出与导入)。核对工作区、余额和对象后启动应用。日常启停在同一部署目录执行。

```sh
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 web api worker
docker compose stop
```

默认仅在宿主机回环地址开放 3000。备用端口验证时同时设置 `WEB_PORT` 与 `PUBLIC_URL`，例如 `3300` 和 `http://localhost:3300`。常规停机使用 `stop`，再次执行 `up -d --wait` 即可。PostgreSQL、Redis 和私有媒体分别使用命名卷。`down -v` 会删除卷中的业务数据。固定部署目录或 `COMPOSE_PROJECT_NAME`，并将 `.env` 与数据一并备份。

打开 `http://localhost:3000/studio`，全新安装的默认管理员用户名是 `admin`。正式站点由 HTTPS 反向代理连接 `127.0.0.1:3000`。`PUBLIC_URL` 指定主入口的来源，并用于生成公开链接和回调地址。多个入口并存时，在 `.env` 的 `ADDITIONAL_BROWSER_ORIGINS` 中以逗号分隔填写其他受信任的浏览器来源，例如 `https://studio.example.com:7443`。每个来源包含协议、主机名及非默认端口。PostgreSQL、Redis 和 API 均在 Compose 私有网络内。Next 将工作台请求发给原协议服务 `api`，将 `/agent/v2/*` 发给 `api-v2`。已初始化的部署可设置 `STUDIO_MODE=advanced` 并重新创建 web 服务以打开开发原型。若沿用旧版 Compose 磁盘卷，先确认 `node` 拥有 `/app/media` 并将目录权限设为 0700。配置文件、密钥和持久卷须单独保管与备份。

## 配置提供方

1. 管理员进入普通 `/studio` 的「设置 → 插件」。全新安装从空目录启动。在「模型提供方」选择 Muse2API、Flow2API 或本地实例接入等内置包，点击「安装此插件」。导入或升级的实例保留原有模型目录和定价。
2. 第三方工作台插件通过「安装远程插件」填写服务地址与清单 JSON。选中已安装的提供方，点击「添加连接」填写配置，再编辑连接、勾选「启用连接」并保存。用「测试连接」检查就绪状态；通过「管理模型权限」和「设置生成定价」配置全站或团队权限与各档积分。
3. 给用户或团队分配积分，或配置支付通道后充值。
4. 在创作页选择工作区和模型，提交任务。

HTTP 提供方的 `baseUrl` 填服务根地址，例如 `https://provider.example`，**不要附带 `/v1`**。媒体产物若在另一个域名，填写 `artifactOrigins`，例如 `https://cdn.example`；这是精确 origin 列表，不支持通配符。Muse / Flow 服务可沿用现有独立实例，归档代码分别位于 `legacy/pure/services/muse2api` 和 `legacy/pure/services/flow2api`。

图片插件保留旧仓库的模型 ID `gpt-image-2.6-sunburst`，可用性取决于实际提供方账号；这里不宣称该别名对所有兼容接口可用。新模型通过新的插件版本或远程插件 manifest 发布。

GPU 接入参见 [GPU 执行端](plugins/gpu/README.md)。远程插件协议及可运行示例见 [插件开发](docs/PLUGINS.md)。

## 宿主机开发与兼容性测试

Node.js 24、pnpm 10、PostgreSQL 18、Redis 8、FFmpeg/FFprobe。图片解码构建另需 CMake 3.20+、Ninja 和 C++ 编译器；原生库版本及源码校验值固定在 `packages/image-import/native/sources.json`。Docker 镜像自动完成此构建。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm images:prepare       # 本机编译固定版本图片解码库，无 Python 运行依赖
# .env 中配置本机 PostgreSQL / Redis、固定加密密钥和私有存储
mkdir -m 700 -p .runtime-advanced/objects  # 目录须与 MEDIA_DIRECTORY 一致
API_PROTOCOL=original pnpm db:migrate
API_PROTOCOL=original pnpm bootstrap      # 仅全新安装，环境需 ADMIN_PASSWORD
pnpm dev:web                              # http://localhost:3000/studio
```

```sh
pnpm test
pnpm build && pnpm start:studio             # 先停止开发预览
```

旧实例按 [迁移步骤](docs/MIGRATION.md) 导入。Advanced UUID 原型可在独立开发环境用 `pnpm dev:api`、`pnpm worker` 和 `pnpm dev:web:advanced` 运行。

本地测试默认使用 PGlite 的 PostgreSQL 引擎。设置 `TEST_DATABASE_URL` 和 `TEST_REDIS_URL` 后会执行真实 PostgreSQL / BullMQ 链路，测试为每个案例建立并删除独立 schema。只能传入测试数据库账号。CI 自动配置两项服务，并验证 Docker 镜像。

## 扩容边界

API 不保存进程内会话，任务状态和积分以 PostgreSQL 为准；Redis 负责唤醒执行器，丢失队列内容后可从数据库重新调度。多个 worker 通过数据库租约和连接级并发限制协作。对外提交结果不确定时停止自动重发，保留积分供管理员核对。

生产多副本应使用 S3 对象存储，共享同一 PostgreSQL、Redis 和加密密钥。按提供方额度设置并发，按队列等待时间增加 worker。GPU 推理和浏览器自动化服务独立扩容。当前没有真实生产容量测量，不承诺具体并发量；负载验证与切换要求见 [运维说明](docs/OPERATIONS.md)。
