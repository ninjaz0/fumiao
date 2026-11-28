# 从 Pure 备份导入已有工作区

## 迁移前

1. 在独立目标上完成 `pnpm db:migrate`，Docker 使用 `docker compose up --build migrate`。使用空 PostgreSQL 及专用私有对象目录或桶。设置 `STUDIO_LEGACY_SOURCE` 为该实例的稳定标识，并与 `--source` 一致。已有工作区需直接导入，`bootstrap` 会拒绝配置了来源标识的目标库。
2. 原站暂停写入，等待生成、对话和合成完成，核对未确认任务及充值订单。积分（含贡献合格积分）冻结须为零，过期但未核对的订单也须处理。
3. 使用 SQLite 备份 API 或停止写入后的等价一致性快照，和同一时间点的对象及头像备份一起留存。SQLite 使用 WAL 时仅拷贝运行中的主文件无法保证完整。工具读取备份，导出另存为新文件。
4. 记录旧库和对象恢复点，限制目标的业务流量。保留同步的媒体备份、旧导出及目标配置供复跑和对账。

## 导出与导入

```sh
python3 scripts/export-legacy.py \
  --database /backup/pure/studio.sqlite \
  --source nvmes-production \
  --include-registration-codes \
  --objects /backup/pure-objects \
  --avatars /backup/pure/avatars \
  --output /backup/pure-export.json
```

导出文件含密码哈希、可用邀请码等敏感信息，创建权限为 0600，禁止提交 Git。导出器拒绝仍有活动任务、冻结积分和未关闭充值订单的数据库。完整迁移须指定 `--include-registration-codes`；未包含邀请码的导入会在写入前报错。

媒体应以旧媒体 ID 为文件名，放在一个目录下。旧磁盘模式对应 `.data/objects/`；旧 COS 模式应从 `studio/` 前缀下载对应对象到本地目录，不能将公开 URL 当作完成的媒体迁移。

磁盘备份需保留修改时间（例如用保留时间的复制命令），导入据此保留原 `Last-Modified` / `ETag`。`--objects` 校验每个旧媒体文件的大小并将 SHA-256 和纳秒修改时间纳入导出指纹。头像的大小、哈希及时间也保存在导出清单中。对已成功导入的旧版清单复跑时继续使用同一份导出文件；带新增校验字段的清单会生成另一指纹。

```sh
export LEGACY_EXPORT=/backup/pure-export.json
export LEGACY_OBJECTS=/backup/pure-objects
export LEGACY_AVATARS=/backup/pure/avatars
pnpm import:legacy
```

本机可用 `node --env-file=.env.studio-nest --import tsx scripts/import-legacy.ts` 为独立目标选择配置。Docker 可在迁移完成后使用一次性容器，只读挂载包含导出、媒体和头像的目录。

```sh
docker compose run --rm --no-deps -v /绝对路径/pure-backup:/backup:ro \
  -e LEGACY_EXPORT=/backup/export.json -e LEGACY_OBJECTS=/backup/objects \
  -e LEGACY_AVATARS=/backup/avatars api pnpm import:legacy
```

导入按来源和旧 ID 生成稳定内部 UUID，保留公开数字编号和 32 位媒体编号。它校验清单、复制媒体与已上传头像、恢复默认空间和修订号，并推进新编号序列。同一导出可重复执行；已成功导入的相同指纹返回 `alreadyImported: true`。已导入的同一 `source` 若指纹变化，程序在写入对象前拒绝运行。一次性容器的 `node` 用户须能读取挂载的备份文件。

数据库事务先串行锁定导入和初始化，再校验目标、复制对象并写入记录。导入中断时可能留下未引用对象，在同一专用目标中重复导入可复用对象键。数据库不会保留半批账号或账本。导入是一次完整快照，也可重复演练；上线前需暂停旧端写入以防数据分叉。

## 验收和切换

- 核对用户、工作区、素材、历史任务计数；逐个比较工作区余额，冻结应为零。
- 用普通用户验证个人/团队隔离、历史媒体、画布、素材包及旧密码登录。
- 核对已恢复的模型目录、全局/团队开关、用户隐藏模型、分档价格及修订号。插件连接和商户凭据仍需重新配置；导入不会启用真实提供方连接。
- 对每种真实提供方各做一次受控生成，对 GPU 检查断线恢复和结果回传，对支付做网关测试订单。仓库的协议测试使用模拟上游，不代替这些验证。
- 完成预期负载下的排队、连接额度、数据库连接数、存储吞吐测试，再将反向代理切到新站。

已有贡献设备或收益数据的实例还需核对历史账本。[贡献数据退役和对账](FMWORKER_RETIREMENT_UPGRADE.md)

## 已有 PostgreSQL 实例启用内置模型

1. 在切换前停写，记录宿主和插件版本，备份 PostgreSQL、私有媒体及对应的 `ENCRYPTION_KEY`。保存各工作区的余额、冻结额，在途任务和对话回合的编号、来源、原价及已收回执。
2. 先执行全部迁移。从 `055_workspace_script_documents.sql` 升级时，原整数积分按相同数值进入十二位小数的钱包和账本。用 `TEST_DATABASE_URL` 指向隔离的 PostgreSQL，运行 `pnpm exec tsx --test --test-name-pattern="055 integer wallet" tests/advanced/original-integrated-migrations.test.ts`，核对旧冻结、原固定价和结算后的余额快照。
3. 更新所有接单 Worker，确认每个实例都能按快照执行旧插件和内置协议，再开放管理员的「设置 → 模型接入」上架操作。旧连接可逐个模型接管。用原公开模型 ID 核对团队权限、历史账单和正在执行的旧订单。
4. 用普通成员验收原画布和工作区的私有成片。换线前保存的参数应能原样打开，超出新线路范围的节点必须先调整才能重新生成。按同一任务编号核对原线路、预留与最终实扣。恢复旧程序时使用切换前同一恢复点的数据库、素材、密钥和宿主版本，并在恢复派发前核对备份点之后的真实上游订单与付款。

在隔离环境运行 `pnpm build`、`pnpm exec playwright install chromium`、`pnpm test:studio:nest` 和 `pnpm test:studio:restore`。正式入口演练使用合成凭据、图像和视频。真实网关的调用权限、首帧传递和取片需用已授权的测试额度分别验收。
