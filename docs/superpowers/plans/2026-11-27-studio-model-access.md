# Studio 内置模型接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全站管理员在 Studio 内填写地址和密钥、勾选模型、定价上架。成员从原有对话、创作台和画布使用模型，并按实际交付的用量支付积分。

**Architecture:** 复用 Studio 公开目录、工作区权限、钱包、对话回合及媒体任务。连接保存凭据，模型保存公开售价，线路绑定上游模型和内置协议版本。受理事务冻结有效线路、凭据、价格和扣费上限，Worker 依据该单快照执行与结算。

**Tech Stack:** Node 24、pnpm 10.32.1、TypeScript、PostgreSQL 18、NestJS、BullMQ / Redis 8、Next.js / React、私有媒体存储、FFmpeg、node:test 与 Playwright。

**Spec:** [已确认的模型接入设计](../specs/2026-11-27-studio-model-access-design.md)

## Global Constraints

- 正式入口为 `/studio`。仅全站管理员可管理线路。普通成员按工作区授权使用公开模型，只看到一份售价。新接入由宿主内置实现。
- 对话有普通输入、缓存命中、缓存写入、输出四个「积分 / 百万 Token」单价。每项缓存价独立支持留空继承和显式零价。图片按实际交付张数，视频按交付成片实测时长，精确至毫秒。
- 单价最多 6 位小数，钱包及流水精确到 12 位。每轮都有账单，实扣以发送前的授权上限为限。人民币金额继续用分。
- 受理后换线、调价、停接新单或进程重启时，按原快照完成并只结算一次。接管旧兼容对话连接需由管理员填新价格并明确切换，保留已有模型 ID、权限和历史金额。
- 列目录、存草稿和发布可产生只读上游请求。真实试用须由管理员从有生成权限的工作区主动发起。凭据留在服务端，继承密钥遵守原目的地与用途。
- 工作目录沿用 T3 分配的 worktree。依赖、包边界、固定验收实例和 PR 流程遵循 [项目开发指南](../../../AGENTS.md)。实现开始时执行 `pnpm install --frozen-lockfile`，媒体用例需要 `pnpm images:prepare`。

## Review Focus

1. 大余额只扣一个最低价 Token，充值或退款随后到达，余额、历史快照与导出仍精确到最后一位。见任务 1。
2. 带路径前缀的自建网关使用非 `sk-` 开头的密钥，目录只给 ID 或漏项，同一地址同时承载两种视频格式。上架过程的上游生成次数为零。见任务 2、7。
3. 历史连接借用受限密钥，某团队已禁用其中一个模型。只迁入选中的模型，不能扩张授权，也不能让旧包升级重新占用已经接管的公开 ID。见任务 3。
4. 工具往返的流尾重复报用量，另一次调用缺用量。只核算每次可信的最终明细，中断、重复提交和重试各能找到原账单。并行媒体与对话预留不能突破钱包或预算。见任务 4、5。
5. 视频提交后换线、涨价、停用旧线并重启 Worker。仍按旧任务号取片，重复回执不能再建单，旧画布保留当初填写的时长。见任务 6、8。

---

## 文件与依赖顺序

| 交付 | 主要落点 | 后续调用方 |
| --- | --- | --- |
| 精确积分 | `packages/platform/src/credit-amount.ts`、钱包、预算与财务读模型 | 对话、媒体、账单 |
| 连接与发布 | `packages/platform/src/model-access/`、`packages/original-api/src/model-access.ts`、`apps/api/src/original-model-access.ts` | 管理设置、受理、目录 |
| 执行与计费 | `packages/original-api/src/chats.ts`、`packages/platform/src/executor.ts`、`packages/platform/src/platform.ts` | 原有对话及媒体 Worker |
| Studio 界面 | `apps/web/studio/`、`apps/web/canvas-editor/`；共享 HTTP 类型放在 `packages/web-compat/src/model-access.ts` | 管理员、创作者 |
| 回归验收 | `tests/advanced/`、`tests/integration/`、`docs/MIGRATION.md` | 同一提交的迁移、恢复与正式入口验收 |

任务 1–3 提供共同契约。对话和图片分别接入该契约；视频复用图片任务已接通的队列、私有存储与结算。所有任务构成一次可验收的产品交付。下面的代码片段是目标断言，测试数据放在相应任务的 fixture 中。

### Task 1 · 让现有钱包精确到小数积分

**文件**　新增 `migrations/056_credit_precision.sql`、`packages/platform/src/credit-amount.ts`。修改 `packages/platform/src/platform.ts`、`packages/platform/src/budgets.ts`、`packages/platform/src/agent-policy.ts`、`packages/original-api/src/budgets-api.ts`、`packages/original-api/src/credits.ts`、`packages/original-api/src/billing-extras.ts`、`packages/original-api/src/admin-observability.ts`。测试放在 `tests/advanced/original-credits.test.ts`、`tests/advanced/original-integrated-migrations.test.ts`。

**接口**　`creditUnits(value: string): bigint` 和 `formatCredits(units: bigint): string` 在十进制文本和万亿分之一积分之间转换。`tokenCost(tokens: bigint, perMillion: string): bigint` 返回同一单位。价格入口先校验非负且至多 6 位小数。接口金额用十进制字符串，SQL 用 `numeric` 绑定值。

- [ ] 增加用例“最低单价扣一个 Token 后充值仍能对账”。用 `databaseFixture("055_workspace_script_documents.sql")` 建老库，放入整数账户、未结冻结和旧流水，运行 `migrate`。验证扣 1 个 Token 后再充值 1 积分、退款和导出，另测旧固定价任务结算。核心断言如下。

  ```ts
  assert.equal(tokenCost(1n, "0.000001"), 1n);
  assert.equal(formatCredits(creditUnits("100000000000") - 1n), "99999999999.999999999999");
  assert.equal(afterRecharge.exact.balance, "100000000000.999999999999");
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/original-credits.test.ts tests/advanced/original-integrated-migrations.test.ts`，确认当前整数列或现有浮点投影无法满足上述断言。
- [ ] 把 `wallets.balance/held`、`ledger.amount/balance_snapshot/held_snapshot`、`jobs.price`、`chat_charges.amount` 及实际存储小数预算、批量报价和提案金额的列迁为 `numeric(31,12)`。包括 `budget_alerts.projected_spend`、`canvas_precheck_tickets.total_credits`、`agent_proposal_executions.amount` 和 `canvas_proposals.estimated_credits`。保留原值、正负号、约束及已撤销服务的写保护。旧的整数套餐和固定积分发放可按原面额入账。
- [ ] 在 SQL 或定点整数中做余额比较、预留、退款、预算统计和导出。给新版 Studio 钱包和流水返回 `exact`，保留既有数值字段及类型；旧字段只在响应边界转换。收入报表从最终 `spend` 流水读取实扣，跨表汇总避免重复计数，货币分与积分分别统计。检查原有充值、订阅、管理员调整和历史导入途径。
- [ ] 重跑以上两组用例及 `pnpm exec tsx --test tests/advanced/wave6-observability-budgets-moderation-billing.test.ts`，确认最小金额和旧账均通过。提交 `feat: 支持精确的小数积分记账`。

### Task 2 · 原生连接、只读目录与可续编的草稿

**文件**　新增 `migrations/057_model_access_connections.sql`、`packages/platform/src/model-access/connections.ts`、`packages/platform/src/model-access/discovery.ts`、`packages/web-compat/src/model-access.ts`、`packages/original-api/src/model-access.ts`、`apps/api/src/original-model-access.ts`、`tests/advanced/model-access-connections.test.ts`。复用 `packages/platform/src/plugin-host.ts`、`packages/platform/src/connection-address.ts` 和 `packages/platform/src/security.ts`。在 `apps/api/src/original.ts` 注册控制器及管理员会话校验。

**接口**　`GET /api/admin/model-access` 读取管理视图。`POST /api/admin/model-access/connections` 添加连接，`PATCH /api/admin/model-access/connections/:id` 按预期修订编辑。`POST /api/admin/model-access/connections/:id/discover` 只向上游发 GET。`PUT /api/admin/model-access/drafts/:id` 按修订保存草稿。目录候选至少包含 `upstream_id`、输出用途及其来源、已声明的参数、当前资料状态。

- [ ] 用可记录请求的模拟传输测试带路径前缀的地址、普通 Bearer 密钥、重复 ID、目录缺项和无目录调用权限。对 OpenRouter 模拟通用、图片、视频三个目录，包含只能看图的对话模型。再测成员越权和密钥脱敏。

  ```ts
  assert.deepEqual(requests.map(r => [r.method, r.path]), [["GET", "/team/v1/models"]]);
  assert.equal(adminView.credentials_configured, true);
  assert.equal(JSON.stringify(adminView).includes(testKey), false);
  assert.equal(refreshed.draft.price, "0.25");
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/model-access-connections.test.ts`，确认新增接口或目录合并用例先失败。
- [ ] 给 `connections` 增加可判别的 `source_kind`，旧行默认 `plugin`，`builtin` 行由数据库约束其插件字段为空。新增 `model_access_connection_revisions` 保存不可变的加密地址/密钥配置及授权范围，`model_access_drafts` 保存所选模型、用途、价格、覆盖项和修订号。修改地址或换密钥生成新修订；更换目的地须显式提供该目的地的凭据。复用既有公网 HTTPS 和实际连接校验，给宿主请求传输增加二进制 body 支持，保留 JSON 和流式读取的既有接口。新连接接受合法的非空 Bearer 密钥，自定义密钥无需特定前缀。
- [ ] 在 `discovery.ts` 按连接及原始上游 ID 去重，保留显式路径前缀。可信输出类型可预填；同名、裸 ID 和无秒数枚举的条目可批量确认，漏列可手工添加。某个专用目录失败时保留其他成功结果。区别显示无效凭据、目录权限不足、空目录、超时。刷新只更新发现记录。已知网关使用正式契约，自建视频按“单条覆盖 → 已确认的连接默认值 → 待确认”取有效格式。
- [ ] 重跑该文件，检查发布候选中有准备完毕项和草稿项、日志与响应无凭据、生成请求计数为零。提交 `feat: 支持原生模型连接与只读发现`。

### Task 3 · 按公开模型上架、选线和接管旧连接

**文件**　新增 `migrations/058_model_access_publications.sql`、`packages/platform/src/model-access/publication.ts`、`tests/advanced/model-access-publication.test.ts`。修改任务 2 的管理接口，以及 `packages/platform/src/catalog.ts`、`packages/platform/src/studio-plugin-profile.ts`、`packages/platform/src/chat-providers.ts`、`packages/platform/src/studio-packages.ts`、`packages/original-api/src/settings.ts`。

**接口**　`POST /api/admin/model-access/publications` 接收 `uid`、草稿版本、勾选项和动作（新上架、关联备用、切为当前），成功或同请求重放返回 200。`resolvePublishedRoute(sql: Sql, catalogId: string): Promise<FrozenModelRoute | null>` 读取公开模型的当前配置。`FrozenModelRoute` 定义在 `publication.ts`，含 `catalogId`、`routeRevisionId`、`connectionRevisionId`、`upstreamId`、`protocol`、`executorVersion`、`capabilities`、`priceRevisionId` 和价格快照。首批协议标识为 `openai-chat`、`openai-images`、`openrouter-images`、`new-api-videos`、`openrouter-videos`，各自从执行器版本 1 起。服务端凭据按加密修订引用解析。

- [ ] 在没有安装提供方插件的空库上发布第一个内置模型，再把第二个连接关联到同一公开 ID。测试同名不自动合并、别名可明确关联、仅存备用、并发切换、重复操作和失败回滚。另用存量库验证旧连接准备新价时仍按原价接单，切换后团队禁用策略仍有效。

  ```ts
  assert.equal(afterAddingBackup.routeRevisionId, original.routeRevisionId);
  assert.deepEqual(switchStatuses.sort(), [200, 409]); // 两次不同修改基于同一修订
  assert.equal(await teamCanUseExistingModel(), false);
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/model-access-publication.test.ts tests/advanced/chat-install-locks.test.ts`，确认现有目录的插件约束或旧连接全量归属检查触发失败。
- [ ] 公开模型沿用 `studio_catalog.id`，新建时分配与上游名称独立的稳定 ID；`models.id` 标识连接上的上游模型。新增 `model_access_route_revisions`、`model_access_price_revisions`、`model_access_publications`，最后一表以公开 ID 为主键，只指向一条生效线路修订和一套价目。单价列使用 `numeric(25,6)`，空缓存价单独保留。用外键和同模型校验关联修订，内置公开模型可以独立于插件存在。内置单价只写该公开模型的价格修订。兼容“生成定价”的既有整表保存契约，旧表单只校验并更新它原有的价格键；两处设置展示同一已发布售价。
- [ ] 在一个事务内校验管理员身份、类型、具体可用协议、连接/草稿及公开模型修订、价格和有界报价所需能力。按公开 ID 固定顺序锁定，切换同时递增既有 `studio_policy.price_revision`，使旧报价和画布预检失效。`uid` 重放原结果，换内容复用同一编号返回冲突。只发布明确选中且完备的项，其余草稿留存。
- [ ] 接管时将旧公开模型标为内置所有，保留原工作区开关及历史记录。在旧包加载、注册和移除路径跳过已明确接管的模型，其他未接管模型正常运行。下游按来源读取目录，避免内连接插件版本时漏掉内置模型；旧库导入沿用仓库对未迁移表的检测。复用自有密钥走独立凭据修订。借用密钥保留原服务、模型、端点及撤销检查，新增用途或改地址须填独立密钥。普通的“停止接新单”仍允许已有授权快照完成。
- [ ] 重跑本任务和 `pnpm exec tsx --test tests/advanced/studio-catalog.test.ts tests/advanced/installed-packages.test.ts tests/advanced/chat-provider.test.ts`。检查限定到原址 `gpt-4.1` 的借用凭据不能用来生图，旧包升级后仍只看到一个模型。提交 `feat: 按公开模型发布价格与生效线路`。

### Task 4 · 对话报价、工具往返与每轮账单

**文件**　新增 `migrations/059_model_access_chat.sql`、`packages/platform/src/model-access/chat.ts`、`packages/original-api/src/chat-billing.ts`、`tests/advanced/model-access-chat.test.ts`。修改 `packages/original-api/src/chat-draft.ts`、`packages/original-api/src/chat-settings.ts`、`packages/original-api/src/chats.ts`、`packages/original-api/src/chat-runtime.ts`、`packages/original-api/src/chat-tool-stream.ts`、`packages/original-api/src/chat-execution.ts`、`apps/api/src/original-chat.ts`、`apps/web/canvas-editor/chat/ChatWorkspace.tsx`。

**接口**　`POST /api/chat/quote` 接受可空的会话 ID、模型、本次消息或重试目标及画布上下文，返回 `max_charge`、`max_output_tokens`、`price_revision` 和 `route_revision`。发送时原样带回授权上限与修订。`GET /api/chats/:cid/bills` 按现有会话权限批量返回各轮账单，包括被重试替换的轮次。`chat.ts` 的 `normalizeChatUsage(raw: unknown): NormalizedUsage | null` 输出四个 `bigint` 计数 `input`、`cacheRead`、`cacheWrite`、`output`，进入 JSON 时转成整数字符串。`null` 表示该次推理缺可信计量。

- [ ] 增加用例“总输入 10000、命中 7000、写入 1000、输出 500”，每百万单价为 100、20、继承、400。另测显式零价、DeepSeek 字段、别名重复、明细矛盾、工具多跳、缺用量、标题调用和停止。固定价老回合与新 Token 回合放在同一个会话。

  ```ts
  assert.deepEqual(bill.lines.map(x => x.subtotal), ["0.2", "0.14", "0.1", "0.2"]);
  assert.equal(bill.charged, "0.64");
  assert.equal(missingUsageBill.charged, "0");
  assert.equal(zeroPricedWrite.lines[2].subtotal, "0");
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/model-access-chat.test.ts tests/advanced/chat-tools.test.ts`，在现有“每条回复固定价”路径上确认新增账单断言失败。
- [ ] 扩展 `chat_turns` 的运行中约束以容纳带内置线路及价格修订的回合，保留原来缺插件标识的已导入历史终态。`chat_charges.amount` 保存预留额，以 `turn_id` 唯一保存最终账单、四项用量/单价/继承来源/小计、缺失原因和减免。报价与受理共用 `chatContext` 的实际上下文（含技能、工具和历史）。本地估算输入用于报价，默认最多 4,096 输出 Token，按线路能力与可用余额下调；零输出单价按模型上限处理。报价和发送共用经授权的上下文构造逻辑。受理时冻结影响报价的技能、工具和消息范围，Worker 按该快照组装请求。实际发送重新校验修订、上下文和钱包，过期返回 409 并保留草稿。按可同时生效的最高输入价估算，实扣只采用回执。
- [ ] 使用冻结的上游模型 ID 发送 `chat/completions`。兼容 SSE 的终条用量和整段 JSON 回复。每次工具往返只取该次最后一份有效累计值，工具调用结果及工具定义计入后续请求预算。下次推理必须能放进同一轮剩余的授权额度，自动标题由平台承担。工作区预算统计同时计入尚处于 `held` 的对话预留；画布发起的对话按受理时的项目归属核算。与媒体受理共用钱包锁，在登记本笔预留前校验已有占用加本笔报价。
- [ ] 在 `OriginalChats.finishOn` 的同一事务按租约终结回合、结清实扣、释放整笔预留并写账单。停止、失败和中断实扣零；成功交付只对计量完整的推理收费，其余逐次标明；仅缺缓存细分时依已知总量计。旧回合按原固定价格/账本展示，旧用量缺失显示“未记录”。发送按钮使用新模型的 `max_charge` 判断可用余额，同一界面继续支持旧模型的 `|reply` 价格。成员在输入区看到最高扣费，点击发送即确认该报价。每个回复下展示实扣与可展开的明细，重开和重试后仍可查看。
- [ ] 重跑该文件及 `pnpm exec tsx --test tests/advanced/chats.test.ts tests/advanced/chat-runtime.test.ts tests/advanced/chat-tools.test.ts`。验证全模型零价零余额可发送、同一 `uid` 重发只有一笔、失效租约不能再扣款、其他工作区无法读取账单。提交 `feat: 支持对话按 Token 结算与逐轮账单`。

### Task 5 · 媒体受理、图片生成与按交付张数结算

**文件**　新增 `migrations/060_model_access_jobs.sql`、`packages/platform/src/model-access/images.ts`、`packages/platform/src/model-access/media-billing.ts`、`tests/advanced/model-access-images.test.ts`。修改 `packages/platform/src/accept.ts`、`packages/platform/src/executor.ts`、`packages/platform/src/platform.ts`、`packages/platform/src/prepare-input.ts`、`packages/platform/src/queue-snapshot.ts`、`packages/original-api/src/estimate.ts`、`packages/original-api/src/generation.ts`、`packages/original-api/src/state.ts`、`packages/original-api/src/jobs.ts`。复用 `packages/platform/src/provider-output.ts` 与私有素材写入。

**接口**　`mediaCharge(rate: string, delivered: { images: number } | { milliseconds: number }, held: string): { charged: string; waived: string }` 依据已验收产物计费。`jobs.price` 继续表示下单预留，以最终流水为实扣依据。`jobs` 另存内置线路、价格修订、计量方式和受理参数；旧单仍可凭原有插件、配置和价格字段完成。

- [ ] 在事务 fixture 中模拟请求两张、成功验收一张、另一张损坏。重复投递同一份回执，并让一个聊天请求与图片任务同时争用剩余额度。

  ```ts
  assert.equal(deliveredImages.length, 1);
  assert.equal(settlements[0].exact.amount, "0.25"); // 预留 0.5，单价 0.25
  assert.equal(settlements.length, 1);
  assert.equal(wallet.exact.reserved, "0");
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/model-access-images.test.ts tests/advanced/original-generation.test.ts`，确认当前成功时扣整笔 `job.price` 的实现不能通过。
- [ ] 在估价和受理处使用当前的 `FrozenModelRoute`，校验权限、参考素材归属、参数和报价修订后冻结。更新 `jobs` 的来源约束，并使 `queueReady`、`claim`、`execute`、`recoverOn` 能按内置来源选择宿主执行器。旧插件分支继续按原快照解析；已受理内置单可在切换或停止接新单后继续执行。沿用并发限制、租约、outbox 和清理流程。
- [ ] 实现 OpenAI `images/generations`、支持编辑时的 `images/edits`，以及 OpenRouter 图片目录的 `POST images`。只传该线路支持的参数。参考图取自本工作区授权素材；结果接受 Base64 或合法成品链接。复用图片解码、大小校验及私有存储。按 `(job_id, outputIndex)` 去重，先将合格对象暂存到私有存储，在同一库事务发布交付素材、终结任务并结算。暂时性下载失败可重取已有回执，崩溃后清理无引用对象。确定无效的单张不影响其他已交付图片，全部无效则实扣零。
- [ ] 在 `Platform.settle` 释放整笔预留，按最终结果只扣已验收数量对应金额。预算、历史、观测和对账读取实际扣款。图文同抢余额时只受理付得起的请求。重跑以上命令及 `pnpm exec tsx --test tests/advanced/provider-media.test.ts tests/advanced/original-estimate.test.ts tests/advanced/original-jobs.test.ts`。提交 `feat: 支持原生图片生成与按张结算`。

### Task 6 · 两种异步视频协议、取片和断点恢复

**文件**　新增 `packages/platform/src/model-access/videos.ts`、`tests/advanced/model-access-videos.test.ts`。修改 `packages/platform/src/executor.ts`、`packages/platform/src/operations.ts`；使用任务 5 的计量接口及已有 `remote_id`、`receipt`、租约和私有媒体验收。持久化查询位置与成品定位信息，敏感签名链接仅供服务端取片。

**接口**　`videos.ts` 提供按冻结版本区分的 New API 和 OpenRouter 创建、查询、取片操作。创建结果给出上游 ID 和受约束的查询位置；查询完成给出成品定位。实例化协议时传入已授权连接修订，普通轮询和重启恢复走同一实现。

- [ ] 分别拦截两条线路的真实请求编码，断言秒数、首帧字节或引用、内容类型、任务 ID、查询路径和下载鉴权。用 FFmpeg 测试素材验证 7.8 秒成片。任务 A 下单后，把当前线路切到只支持 4 秒的 B 并涨价、停用 A 接新单，重启执行器。另模拟提交响应丢失、取片暂时失败和超出预留上限。

  ```ts
  assert.equal(gatewayA.createCount, 1);
  assert.equal(gatewayB.createCount, 0);
  assert.deepEqual(mediaCharge("3", { milliseconds: 7800 }, "24"), { charged: "23.4", waived: "0" });
  assert.deepEqual(mediaCharge("3", { milliseconds: 8040 }, "24"), { charged: "24", waived: "0.12" });
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/model-access-videos.test.ts`，确认两种请求编码和跨换线恢复的新用例先失败。
- [ ] New API 使用 multipart，时长为 `seconds`，首帧为 `input_reference`；按原任务查询并经授权内容端点取片。OpenRouter 使用 JSON 的 `duration` 和 `frame_images`，保存并校验 `polling_url`；`unsigned_urls` 仅对原站授权的内容路径带密钥，签名 `urls` 用链接本身下载。渲染参数取宿主协议和该模型声明的交集。
- [ ] 对上游发出创建请求前持久化调度状态，收到任务号即在租约内保存回执。`running` 恢复只查同一上游任务，`finalizing` 只恢复下载和私有素材验收。结果不确定且未取得任务号时进入现有 `uncertain`，由已有核对入口按原线路恢复指定任务或退款。重复轮询结果按任务、来源、租约和终态去重。仅以验收端实测毫秒数调用 `mediaCharge`。零成片或失败释放预留。
- [ ] 重跑本任务及 `pnpm exec tsx --test tests/advanced/original-media.test.ts tests/advanced/platform.test.ts`，检查跨源请求不附 API 密钥，重启后上游创建次数和最终结算次数均为一。提交 `feat: 支持兼容视频任务的查询取片与恢复`。

### Task 7 · 一页上架、备用线路试用与价格管理

**文件**　新增 `apps/web/studio/SettingsModelAccess.tsx`、`tests/advanced/model-access-settings.test.ts`。修改 `apps/web/studio/Settings.tsx`、`apps/web/studio/settings-tabs.ts`、`apps/web/studio/SettingsModels.tsx`、`apps/web/studio/SettingsPrices.tsx`、`apps/web/studio/SettingsServices.tsx`、`apps/web/studio/state.ts`、`packages/original-api/src/model-access.ts`、`apps/api/src/original-model-access.ts`。

**接口**　设置标签 `modelAccess` 对应“模型接入”。`POST /api/admin/model-access/routes/:id/trial` 接受试用 UID、冻结的线路/售价修订、工作区、样例输入和已确认上限，返回常规生成任务或对话回合标识。指定备用线路的能力仅在管理员试用入口提供。

- [ ] 增加用例“选十个视频，一次指定默认格式，只改一个例外”。覆盖草稿价格为空与显式零价、普通输入/输出常显、展开缓存价、手动补 ID、继承现有售价、显示实际目录地址和目录错误。切备用线路前的试用由管理员确认并计入选定工作区。

  ```ts
  assert.equal(selected.filter(row => row.protocol === "new-api-videos").length, 9);
  assert.equal(generationRequestsBeforeTrial.length, 0);
  assert.equal(memberTrialResponse.status, 403);
  ```

- [ ] 运行 `pnpm exec tsx --test tests/advanced/model-access-settings.test.ts tests/advanced/settings-tabs.test.ts`，确认现有设置缺少该路径。
- [ ] 默认展示公开模型、当前线路和“接入服务”。复用现有表单、载入、错误及键盘操作样式。同行完成勾选、按用途批量定价及修改例外，列出待补资料的草稿。“关联为备用”沿用售价，切换前显示能力变化。旧连接提供接管入口，旧定价页展示同一份内置售价并定位到这一编辑器。
- [ ] 实现“试用此线路”。校验全站管理角色、该工作区的生成权限、凭据范围和报价，在正常受理事务中指定待试线路；同 UID 重试只创建一单。分别显示“目录已读取”和该线路本修订最近一次生成结果，对话缺用量显示次数和最近时间。
- [ ] 重跑本任务及 `pnpm exec tsx --test tests/advanced/settings-prices.test.ts tests/advanced/settings-plugins-drawer.test.ts`，并运行 `pnpm typecheck:web`。提交 `feat: 在 Studio 设置中完成模型上架与线路试用`。

### Task 8 · 创作台与画布接入、老库恢复及整体验收

**文件**　修改 `apps/web/studio/Composer.tsx`、`apps/web/studio/ParameterFields.tsx`、`apps/web/studio/state.ts`、`apps/web/canvas-editor/CanvasWorkspace.tsx`、`packages/platform/src/canvas-models.ts`、`packages/original-api/src/canvas-runs.ts`、`packages/original-api/src/canvas-validation.ts`、`packages/original-api/src/batch-precheck.ts`、`tests/integration/smoke-studio-nest.ts`、`tests/integration/studio-nest-restore.ts` 和 `docs/MIGRATION.md`。新增 `tests/integration/studio-model-access.ts`，由正式 Studio 套件调用。

**接口**　`/studio` 的模型列表、表单、报价、提交与画布预检消费同一发布修订。沿用 `@fumiao/plugin-sdk/model-form.js` 的能力约束，在只读展示/保存历史草稿和提交新请求时分别处理。工作区钱包与历史界面优先显示精确金额。

- [ ] 写正式入口用例，管理员一次接入三个模型，普通成员逐一使用。生成一张有效图片、一段 7.8 秒视频、一个 0.64 积分回复。保存旧画布的 8 秒节点，管理员换到 4 秒线路后重新打开。用成员和无权工作区分别请求账单与成片。

  ```ts
  assert.equal(reopenedNode.params.seconds, 8);
  assert.equal(newVideoOrdersAfterInvalidSubmit, 0);
  assert.equal(afterRestore.bill.charged, "0.64");
  assert.equal(afterRestore.videoSettlements, 1);
  ```

- [ ] 将用例挂到 `tests/integration/smoke-studio-nest.ts` 默认路径。运行 `pnpm build`、`pnpm exec playwright install chromium`、`pnpm test:studio:nest`，确认原画布能力读取或正式入口用例先失败。使用受控模拟提供方，在测试传输边界注入地址和回执，生产的公网限制继续生效。
- [ ] 在 Studio 报价与提交中传递线路/售价修订，换线后刷新有效选项和报价。画布保存不因线路收窄而改写旧参数；生成与批量预检在具体节点提示新时长。批量报价、钱包和导出用精确金额，覆盖旧余额、已有回执及在途老任务。按工作区验证私有下载与 Range。
- [ ] 在隔离库验证从 `055_workspace_script_documents.sql` 升级及一致备份恢复，包含 PG、私有素材、密钥和旧任务快照。发布顺序为先迁移、使所有接单 Worker 能解析新旧来源，再启用内置模型上架。真实上游验收分别记录成功生成、首帧传递和取片，仅在已有授权测试凭据和额度时执行；记录实际覆盖的网关。
- [ ] 运行 `pnpm lint`、`pnpm typecheck`、`pnpm typecheck:web`、`pnpm test`、`pnpm build`、`pnpm test:studio`、`pnpm test:studio:replicas` 和 `pnpm test:studio:restore`。真实并发用例使用隔离的 `TEST_DATABASE_URL` 和 `TEST_REDIS_URL`。在 worktree 的 Docker 环境从管理员和成员路径复测，然后执行 `python3 scripts/worktree.py down` 与 `python3 scripts/worktree.py status` 核对清理结果。提交 `feat: 接入创作台画布并验证模型切换恢复`。
- [ ] 用最终 SHA 的干净 checkout 更新固定 `fumiao-acceptance`，复用该实例原配置及卷。在 `http://localhost:3000/studio` 复测并交付验收地址、SHA、实扣明细与恢复结果。负责人验收通过后按仓库流程提 PR，生产发布由负责人决定。
