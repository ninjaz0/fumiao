# fmWorker 数据退役和对账

## 旧 PostgreSQL

1. 在入口暂停提交和配对，同时关闭贡献入口。停止旧 API、所有 BullMQ worker、定时任务、旧节点请求和导入进程。保留 Redis 队列和私有对象。确认其它实例及读连接已退出，再备份 PostgreSQL 和私有对象。先用隔离副本演练。
2. 在旧库记录按工作区区分的 `wallets.balance`、`wallets.held`，对应 `ledger` 项和已结充值订单。按任务编号核对贡献分配、执行回执和消费冻结，另记收益账户、奖励和结转余数。确认无法确定结果的任务仍处于停派状态。避免旧进程因租约过期而重发。
3. 在所有旧进程停止的状态下，使用包含服务端退役和本迁移的同一版本运行 `pnpm db:migrate`。迁移使用 PostgreSQL 事务和立即返回的表锁。若提示仍有连接持锁，停止报错提示涉及的进程后重试。校验迁移记录后方可启动该版本的 API 和 worker。
4. 比较前后全部钱包、账本、已结订单和奖励历史。核对旧贡献节点已归档、旧配对码失效，普通节点和配对保持可用。贡献设备继续使用时，签发普通配对码，并让设备生成全新的节点密钥。退役节点的原密钥在有来源摘要时会被数据库拒绝，即使持有新配对码。

迁移保留已应用的 SQL。已入消费钱包的贡献收入保留原值。独立的收益账户、结转余数和资金资格快照用于对账，切换流程无兑换或补发步骤。贡献来源标记、任务编号、计时、已发收益和用量仍可查询。旧领取票据被清除，旧贡献基金、用量、分配以及奖励等表保留只读历史。正常的充值、冻结、扣费和退款继续走消费账本。

### 处理结果未明的任务

迁移把受旧贡献连接、节点或分配影响的未结任务置为 `uncertain`，也包括曾领取后又排回队列的任务。已确认绑定旧贡献账号的未结 Flow 续写也会隔离。迁移撤销租约并移除对应 outbox 记录，保留原任务、冻结积分和结果证据。即使 Redis 残留队列项，执行端也无法领取这些任务。运行中的计时记录标记为中断。已结任务可继续按原编号对账。

已应用旧版 `031_retire_fmworker.sql` 的库也按上述停写步骤运行迁移。新迁移按 Flow 续写实际保存的来源编号补查未结任务并记录漏掉的隔离项。此前已经隔离的任务继续待人工核对，上游结果和冻结仍按原记录处理。

从有权限的只读会话列出待办和冻结、结算分录。按 workspace 和任务编号连接历史上的 provider 回执、执行日志和私有成品。

```sql
SELECT j.public_id, j.id, j.workspace_id, j.provider_model, j.state, j.price,
       r.previous_state, r.previous_node, r.previous_remote_id, r.previous_lease_until,
       w.held AS workspace_held, h.amount AS hold_amount,
       s.action AS settlement, s.amount AS settlement_amount
FROM retired_fmworker_jobs r
JOIN jobs j ON j.id=r.job_id
JOIN wallets w ON w.workspace_id=j.workspace_id
LEFT JOIN ledger h ON h.key='hold:'||j.id
LEFT JOIN ledger s ON s.key='settle:'||j.id
ORDER BY j.workspace_id, j.public_id;
```

- 可从 `retired_fmworker_jobs.previous_receipt`、`fmworker_assignments`、`fmworker_verifications`、`job_runs` 和 `job_assets` 找回额外证据。回执及对象标识限授权人员访问。
- 确认失败或未受理后，在 API 容器内运行 `JOB_ID=<UUID> ACTION=refund REASON="记录核对证据，例如上游记录号及核对日期" pnpm jobs:reconcile`（Compose：`docker compose run --rm --no-deps -e JOB_ID -e ACTION -e REASON api pnpm jobs:reconcile`）。不带 `JOB_ID` 时列出全部待核对任务。操作记在 `ADMIN_NAME`（默认 `admin`）名下。它按平台正常事务释放冻结并保存审计。重复请求会被任务状态拦住。查询结果中的 `id` 是该命令使用的 UUID。
- 上游成功并有可核验成品时，交由值班管理员和账务负责人处理。先在隔离副本核对私有成品和原冻结，再通过经审批的只结算、不执行的维护流程保存原结果和消费记录。本迁移没有成功结果的补记工具；在该流程可用前保留证据及冻结。证据不足时继续待核对。旧任务的 `resume` 和重新入队均被拒绝。
- 需要回退其余功能时保持贡献路由关闭、只读归档及凭据撤销生效。若已产生新写入，先停写和对账，回退前保留这些记录。

## Pure SQLite 导出

暂停旧调度及 API 写入，导出一致性 SQLite 备份。优先按旧任务编号核对 `fm_assignments`、任务、上游及消费账本。新版导出遇到未结任务或冻结会拒绝写清单，并提示需核对的贡献任务编号。确认结果后完成有凭据的消费结算，再制作新备份并导出。独立收益余额始终按历史账户归档。

首次导入请用当前的 `scripts/export-legacy.py`。它保留 `fm_rewards`、`fm_funds`、`fm_reward_remainders`、`fm_assignments` 和 `fm_fund_holds` 等历史事实，以及可选的 `fm_accounts` 和 `fm_account_ledger`。旧节点密钥和配对码留在源备份中；若需要撤销旧密钥，清单只保留第二层哈希。新版导入把贡献元数据写入 `legacy_records`，通过消费账本及钱包原快照保留已入账金额。旧贡献 Flow 的账号专用续写 ID 仅保留在历史任务原始记录中。相同来源、相同清单安全重放；来源相同但内容有变化会拒绝，已经导入的库不需要重新导入或重建。

早期已导入的 Pure 清单可能未记录旧节点密钥的撤销摘要。目标库内的归档节点已失去访问，源密钥的值只有源备份掌握。如果该站允许已有贡献机器重新配对，由操作员在开放新配对前，从停写的旧备份生成当前清单，将非空撤销摘要一次性补进 `retired_fmworker_credentials`。只用同一源实例，先核对节点编号，操作后核对清单中所有非空摘要都已存在。以下示例需要 `jq` 和 `psql`，应在受控维护会话中运行。

```sh
jq -r '.tables.fm_retired_node_credentials[]? | .digest | select(. != null)' /secure/fresh-pure-export.json > /secure/fmworker-revocations.txt
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE fmworker_revocation_input (digest text) ON COMMIT DROP;
\copy fmworker_revocation_input(digest) FROM '/secure/fmworker-revocations.txt'
INSERT INTO retired_fmworker_credentials(digest)
SELECT digest FROM fmworker_revocation_input ON CONFLICT DO NOTHING;
SELECT count(*) AS missing FROM fmworker_revocation_input i
WHERE NOT EXISTS (SELECT 1 FROM retired_fmworker_credentials r WHERE r.digest=i.digest);
COMMIT;
SQL
```

若原备份也缺失，无法识别已经从归档中排除的旧密钥。保持这些设备的旧接入停用，由管理员验证设备替换了密钥后签发新配对码。
