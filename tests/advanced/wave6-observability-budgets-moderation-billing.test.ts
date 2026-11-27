import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { checkAndRecordBudget } from "@fumiao/platform/budgets.js";
import { tryModerationRewrite } from "@fumiao/platform/moderation-rewrite.js";
import { grantDueSubscriptions } from "@fumiao/platform/subscriptions.js";
import { OriginalObservability } from "@fumiao/original-api/admin-observability.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { OriginalBillingExtras } from "@fumiao/original-api/billing-extras.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { chatsFixture } from "../helpers/chats.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

test("F015: workspace 3-stage budget control records warn alerts and atomically rejects over-cap spend with 402", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const budgets = new OriginalBudgets(f.p);
  const wsPublicId = String(f.workspace.public_id);

  const saved = await budgets.upsertPolicy(
    f.admin,
    {
      scope_type: "workspace",
      period: "monthly",
      warn_limit: 10,
      cap_limit: 25,
      mode: "cap",
      enabled: true,
    },
    wsPublicId,
  );
  assert.equal(saved.policy.cap_limit, 25);

  // 1. Spend of 12 credits (>= warn 10, <= cap 25) succeeds and logs a warn alert
  await f.p.db.transaction(async (sql) => {
    await checkAndRecordBudget(sql, {
      workspaceId: f.workspace.id,
      amount: 12,
    });
    // Record a real spend ledger row representing settled usage
    await sql.query(
      `INSERT INTO ledger(id, workspace_id, key, action, amount, actor_id, balance_snapshot, held_snapshot)
       VALUES ($1, $2, $3, 'spend', 12, $4, 100, 0)`,
      [randomUUID(), f.workspace.id, `test-spend-${randomUUID()}`, f.admin.id],
    );
  });

  const listed = await budgets.list(f.admin, wsPublicId);
  assert.equal(listed.policies[0].spent, 12);
  assert.equal(listed.alerts.length, 1);
  assert.equal(listed.alerts[0].projected_spend, 12);

  // 2. Another 15 credits pushes projected spend to 27 > cap 25 -> atomic 402 rejection!
  await assert.rejects(
    f.p.db.transaction(async (sql) => {
      await checkAndRecordBudget(sql, {
        workspaceId: f.workspace.id,
        amount: 15,
      });
    }),
    (err: unknown) => (err as { status?: number })?.status === 402,
  );
});

test("F024: moderation-blocked rejected non-billable jobs neutralize prompt and retry (max 2) reusing single hold without double-billing", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const budgets = new OriginalBudgets(f.p);
  await budgets.updateModeration(
    f.admin,
    { auto_rewrite: true, max_attempts: 2 },
    String(f.workspace.public_id),
  );

  // Seed a queued job with exactly ONE hold ledger row
  const jobId = randomUUID();
  const modelRow = (
    await f.p.db.query(
      "SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, m.provider_model, m.kind FROM models m JOIN connections c ON c.id = m.connection_id LIMIT 1",
    )
  ).rows[0];
  const originalPrompt = "bloody sword fight with massive explosion in alleyway";
  await f.p.db.query(
    `INSERT INTO jobs(id, workspace_id, owner_id, model_id, connection_id, plugin_id, plugin_version, config_snapshot, provider_model, kind, input, idempotency_key, request_hash, price, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8, $9, $10::jsonb, $11, 'h1', 4, 'running')`,
    [
      jobId,
      f.workspace.id,
      f.admin.id,
      modelRow.id,
      modelRow.connection_id,
      modelRow.plugin_id,
      modelRow.plugin_version,
      modelRow.provider_model,
      modelRow.kind,
      JSON.stringify({ prompt: originalPrompt, params: {}, references: [] }),
      `idem-${jobId}`,
    ],
  );
  await f.p.db.query(
    `INSERT INTO ledger(id, workspace_id, job_id, key, action, amount, actor_id, balance_snapshot, held_snapshot)
     VALUES ($1, $2, $3, $4, 'hold', 4, $5, 100, 4)`,
    [randomUUID(), f.workspace.id, jobId, `hold:${jobId}`, f.admin.id],
  );

  // Guardrail check: billable=true MUST NOT rewrite
  const skippedBillable = await f.p.db.transaction(async (sql) => {
    const job = (await sql.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] as any;
    return tryModerationRewrite(sql, job, {
      action: "fail",
      note: "blocked",
      reason: "moderation_blocked",
      certainty: "rejected",
      billable: true,
    });
  });
  assert.equal(skippedBillable, false);

  // Guardrail check: certainty=uncertain MUST NOT rewrite
  const skippedUncertain = await f.p.db.transaction(async (sql) => {
    const job = (await sql.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] as any;
    return tryModerationRewrite(sql, job, {
      action: "fail",
      note: "blocked",
      reason: "moderation_blocked",
      certainty: "uncertain",
      billable: false,
    });
  });
  assert.equal(skippedUncertain, false);

  // Valid moderation rejection #1 -> rewrites & re-queues without second hold
  const retry1 = await f.p.db.transaction(async (sql) => {
    const job = (await sql.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] as any;
    return tryModerationRewrite(sql, job, {
      action: "fail",
      note: "safety filter triggered",
      reason: "moderation_blocked",
      certainty: "rejected",
      billable: false,
    });
  });
  assert.equal(retry1, true);

  const after1 = (await f.p.db.query("SELECT state, input FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(after1.state, "queued");
  assert.notEqual(after1.input.prompt, originalPrompt);
  assert.ok(!String(after1.input.prompt).toLowerCase().includes("bloody"));

  const meta1 = (await f.p.db.query("SELECT * FROM job_audit_meta WHERE job_id=$1", [jobId])).rows[0];
  assert.equal(meta1.original_prompt, originalPrompt);
  assert.equal(meta1.rewrite_attempts, 1);

  // Valid moderation rejection #2 -> reaches max_attempts=2
  const retry2 = await f.p.db.transaction(async (sql) => {
    const job = (await sql.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] as any;
    return tryModerationRewrite(sql, job, {
      action: "fail",
      note: "safety filter triggered again",
      reason: "moderation_blocked",
      certainty: "rejected",
      billable: false,
    });
  });
  assert.equal(retry2, true);

  // Rejection #3 -> exceeds max_attempts=2 -> MUST return false so job fails cleanly
  const retry3 = await f.p.db.transaction(async (sql) => {
    const job = (await sql.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0] as any;
    return tryModerationRewrite(sql, job, {
      action: "fail",
      note: "safety filter triggered 3rd time",
      reason: "moderation_blocked",
      certainty: "rejected",
      billable: false,
    });
  });
  assert.equal(retry3, false);

  // Single-settlement financial invariant: EXACTLY ONE hold row exists for this job!
  const holds = (
    await f.p.db.query("SELECT * FROM ledger WHERE job_id=$1 AND action='hold'", [jobId])
  ).rows;
  assert.equal(holds.length, 1);
  assert.equal(holds[0].key, `hold:${jobId}`);
});

test("F005: admin observability aggregates channel success rate, P50/P95, gross margin, and reconciles uncertain jobs via Operations.resolve", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const obs = new OriginalObservability(f.p);
  const modelRow = (
    await f.p.db.query(
      "SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, m.provider_model, m.kind FROM models m JOIN connections c ON c.id = m.connection_id LIMIT 1",
    )
  ).rows[0];

  // Each completed job reserved 10 and spent 9.75. Two costs of 30 fen leave 135 fen of margin.
  // plus 1 uncertain job with active wallet hold to reconcile!
  for (const [idx, durationSec] of [[1, 4], [2, 12]] as const) {
    const jid = randomUUID();
    await f.p.db.query(
      `INSERT INTO jobs(id, workspace_id, owner_id, model_id, connection_id, plugin_id, plugin_version, config_snapshot, provider_model, kind, input, idempotency_key, request_hash, price, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8, $9, '{}', $10, 'h', 10, 'completed')`,
      [
        jid,
        f.workspace.id,
        f.admin.id,
        modelRow.id,
        modelRow.connection_id,
        modelRow.plugin_id,
        modelRow.plugin_version,
        modelRow.provider_model,
        modelRow.kind,
        `obs-ok-${idx}-${jid}`,
      ],
    );
    await f.p.db.query(
      `INSERT INTO ledger(id,workspace_id,job_id,key,action,amount)
       VALUES(gen_random_uuid(),$1,$2,'settle:'||$2::uuid,'spend',9.75)`,
      [f.workspace.id, jid],
    );
    const nowSec = Date.now() / 1000;
    await f.p.db.query(
      `INSERT INTO job_runs(job, run_key, attempt, plugin_id, plugin_version, kind, model, features, created, started, finished, status, phase)
       VALUES ($1, $2, 1, $3, $4, $5, $6, '{}', $7, $8, $9, 'done', 'done')`,
      [
        jid,
        `run-${jid}`,
        modelRow.plugin_id,
        modelRow.plugin_version,
        modelRow.kind,
        modelRow.provider_model,
        nowSec - durationSec - 1,
        nowSec - durationSec,
        nowSec,
      ],
    );
    await f.p.db.query(
      "INSERT INTO job_audit_meta(job_id, upstream_cost_fen) VALUES ($1, 30)",
      [jid],
    );
  }

  // Uncertain job with real held balance so Operations.resolve('refund') settles cleanly
  const uncertainId = randomUUID();
  await f.p.db.query(
    "UPDATE wallets SET balance = balance + 50, held = held + 8 WHERE workspace_id = $1",
    [f.workspace.id],
  );
  await f.p.db.query(
    `INSERT INTO jobs(id, workspace_id, owner_id, model_id, connection_id, plugin_id, plugin_version, config_snapshot, provider_model, kind, input, idempotency_key, request_hash, price, state, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8, $9, '{}', $10, 'hu', 8, 'uncertain', 'network timeout')`,
    [
      uncertainId,
      f.workspace.id,
      f.admin.id,
      modelRow.id,
      modelRow.connection_id,
      modelRow.plugin_id,
      modelRow.plugin_version,
      modelRow.provider_model,
      modelRow.kind,
      `obs-unc-${uncertainId}`,
    ],
  );

  const summary = await obs.summary(f.admin, 7);
  assert.equal(summary.totals.total_jobs, 3);
  assert.equal(summary.totals.completed_jobs, 2);
  assert.equal(summary.totals.uncertain_jobs, 1);
  assert.equal(summary.totals.credits_revenue, 19.5);
  assert.equal(summary.totals.revenue_fen, 195);
  assert.equal(summary.totals.upstream_cost_fen, 60);
  assert.equal(summary.totals.gross_margin_fen, 135);
  assert.ok(summary.channels[0].p95_seconds >= summary.channels[0].p50_seconds);

  // The first job was accepted before the reporting window but settled twice
  // (legacy signed debit plus a positive spend). Count its cost once.
  await f.db.query("UPDATE jobs SET created_at=now()-interval '9 days' WHERE idempotency_key LIKE 'obs-ok-%'");
  await f.db.query(`UPDATE ledger l SET amount=-5 FROM jobs j WHERE l.job_id=j.id AND j.idempotency_key LIKE 'obs-ok-1-%'`);
  await f.db.query(`INSERT INTO ledger(id,workspace_id,job_id,key,action,amount)
    SELECT gen_random_uuid(),workspace_id,id,'extra:'||id,'spend',4.75 FROM jobs WHERE idempotency_key LIKE 'obs-ok-1-%'`);
  await f.db.query(`UPDATE ledger l SET created_at=now()-interval '8 days' FROM jobs j
    WHERE l.job_id=j.id AND j.idempotency_key LIKE 'obs-ok-2-%'`);
  const window = (await obs.summary(f.admin, 7)).totals;
  assert.equal(window.total_jobs, 1);
  assert.equal(window.completed_jobs, 0);
  assert.equal(window.exact.credits_revenue, "9.75");
  assert.equal(window.cost_known_jobs, 1);
  assert.equal(window.upstream_cost_fen, 30);
  assert.equal(window.gross_margin_fen, 68);

  const beforeUncertain = await obs.uncertainJobs(f.admin);
  assert.equal(beforeUncertain.jobs.length, 1);
  assert.equal(beforeUncertain.jobs[0].id, uncertainId);

  // Reconcile uncertain job via Operations.resolve()
  const rec = await obs.reconcileJob(f.admin, uncertainId, {
    action: "refund",
    reason: "上游确认未生图，管理员核对退款",
  });
  assert.equal(rec.ok, true);

  const afterUncertain = await obs.uncertainJobs(f.admin);
  assert.equal(afterUncertain.jobs.length, 0);
  const jobAfter = (
    await f.p.db.query("SELECT state FROM jobs WHERE id=$1", [uncertainId])
  ).rows[0];
  assert.equal(jobAfter.state, "failed");
});

test("a paid conversation with no media jobs appears in settled channel revenue", async (t) => {
  const f = await chatsFixture();
  t.after(() => f.cleanup());
  f.setTime(Date.now() / 1000);
  const view = await f.chats.create(f.admin, {});
  const sent = await f.chats.send(f.admin, view.conversation.id, await f.draft(view));
  const turn = await f.turn(sent.conversation.active_turn!);
  await f.chats.finish(turn.id, { state: "complete", text: "已完成" });

  const summary = await new OriginalObservability(f.p).summary(f.admin, 7);
  assert.equal(summary.totals.exact.credits_revenue, "1");
  assert.equal(summary.totals.revenue_fen, 10);
  assert.equal(summary.totals.total_jobs, 0);
  const channel = summary.channels.find((row) => row.model_key === turn.model);
  assert.equal(channel?.plugin_id, turn.plugin_id);
  assert.equal(channel?.kind, "chat");
  assert.equal(channel?.exact.credits_revenue, "1");
  assert.equal(channel?.cost_status, "unknown");
  assert.equal(channel?.gross_margin_fen, null);
});

test("F034 + Q5: batch redeem codes, invite rewards, idempotent period quota subscriptions, and CSV/PDF financial statements", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const billing = new OriginalBillingExtras(f.p);
  const identity = new OriginalIdentity(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // 1. Batch redeem code creation, atomic redemption, duplicate rejection (409), and disable (410)
  const batch = await billing.createRedeemBatch(f.admin, {
    name: "内测礼券",
    credits: 100,
    count: 2,
    max_uses: 2,
    expires_in_days: 30,
  });
  assert.equal(batch.codes.length, 2);
  const [c1, c2] = batch.codes;

  const redeemed = await billing.redeem(f.admin, { code: c1.code }, wsPublicId);
  assert.equal(redeemed.credits, 100);

  // Duplicate redeem by same user -> 409
  await assert.rejects(
    billing.redeem(f.admin, { code: c1.code }, wsPublicId),
    (err: unknown) => (err as { status?: number })?.status === 409,
  );

  // Disabled code -> 410
  await billing.disableRedeemCode(f.admin, c2.id);
  await assert.rejects(
    billing.redeem(f.admin, { code: c2.code }, wsPublicId),
    (err: unknown) => (err as { status?: number })?.status === 410,
  );

  // 2. Invite reward tracking + single-settlement claim
  const invite = await identity.createInvite(f.admin, {
    name: "裂变测试邀请",
    grant_credits: false,
    initial_credits: 0,
  });
  assert.ok(invite);
  await identity.register(
    {
      name: "invited_creator",
      nickname: "受邀导演",
      password: "StrongPassword123!",
      code: invite.code,
    },
    "127.0.0.1",
  );
  const rewardsBefore = await billing.inviteRewards(f.admin);
  assert.equal(rewardsBefore.total_invited, 1);
  assert.equal(rewardsBefore.pending_claim_count, 1);

  const claim1 = await billing.claimInviteRewards(f.admin, wsPublicId);
  assert.equal(claim1.claimed_count, 1);
  assert.equal(claim1.claimed_credits, 20);
  // Second claim is strictly idempotent -> 0
  const claim2 = await billing.claimInviteRewards(f.admin, wsPublicId);
  assert.equal(claim2.claimed_count, 0);
  assert.equal(claim2.claimed_credits, 0);

  // 3. Period quota pack subscription + idempotent periodic grant under repeated sweeps
  const plans = await billing.listPlans(f.admin, wsPublicId);
  assert.ok(plans.plans.some((p) => p.code === "starter-monthly"));

  const subRes = await billing.subscribe(
    f.admin,
    { plan_code: "starter-monthly" },
    wsPublicId,
  );
  assert.equal(subRes.ok, true);
  assert.equal(subRes.subscription.period_credits, 350);

  // Sweeping twice more MUST grant 0 additional times!
  assert.equal(await grantDueSubscriptions(f.p), 0);
  assert.equal(await grantDueSubscriptions(f.p), 0);
  const subLedgerRows = (
    await f.p.db.query("SELECT * FROM ledger WHERE key LIKE 'sub:%'")
  ).rows;
  assert.equal(subLedgerRows.length, 1);
  assert.equal(Number(subLedgerRows[0].amount), 350);

  // 4. CSV & PDF financial statements
  const csv = await billing.exportStatement(f.admin, "csv", wsPublicId);
  assert.ok(csv.mime.includes("text/csv"));
  const csvStr = csv.bytes.toString("utf8");
  assert.ok(csvStr.startsWith("\uFEFFID,时间,类型"));
  assert.ok(csvStr.includes("内测礼券"));
  assert.ok(csvStr.includes("周期配额包发放"));

  const pdf = await billing.exportStatement(f.admin, "pdf", wsPublicId);
  assert.equal(pdf.mime, "application/pdf");
  const pdfStr = pdf.bytes.toString("latin1");
  const toUtf16BeHex = (value: string) =>
    Array.from(value, (ch) =>
      ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
    ).join("");
  assert.ok(pdfStr.startsWith("%PDF-1.4\n"));
  assert.ok(pdfStr.includes("/BaseFont /STSong-Light"));
  assert.ok(pdfStr.includes("/Encoding /UniGB-UCS2-H"));
  assert.ok(pdfStr.includes(toUtf16BeHex("弗淼工作台 · 积分账户对账单")));
  assert.ok(pdfStr.includes(toUtf16BeHex("内测礼券")));
  assert.ok(pdfStr.includes(toUtf16BeHex("周期配额包发放")));
  assert.ok(pdfStr.includes("xref\n"));
  assert.ok(pdfStr.trimEnd().endsWith("%%EOF"));
});
