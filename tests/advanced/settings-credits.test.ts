import assert from "node:assert/strict";
import test from "node:test";
import { OriginalCredits } from "@fumiao/original-api/credits.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
import {
  createCreditAdjustmentSession,
  evaluateCreditAdjustment,
  evaluateRechargeYuan,
  formatRechargeRangeHint,
  MAX_CREDIT_ADJUSTMENT,
  MAX_WALLET_BALANCE,
} from "../../apps/web/studio/settings-credits-helpers.js";
import { databaseFixture } from "../helpers/database.js";

test("evaluateCreditAdjustment blocks deductions on zero-credit accounts and previews negative projection", () => {
  const zeroAccount = { available: 0, balance: 20, reserved: 20 };

  assert.deepEqual(evaluateCreditAdjustment("", 1, zeroAccount), {
    valid: false,
    amount: null,
    projected: 0,
    overdrawn: false,
    error: "",
  });

  assert.deepEqual(evaluateCreditAdjustment("", -1, zeroAccount), {
    valid: false,
    amount: null,
    projected: 0,
    overdrawn: false,
    error: "当前账户可用 0 积分，余额不足无法扣减",
  });

  assert.deepEqual(evaluateCreditAdjustment("1", -1, zeroAccount), {
    valid: false,
    amount: null,
    projected: -1,
    overdrawn: true,
    error: "当前账户可用 0 积分，余额不足无法扣减",
  });

  assert.deepEqual(evaluateCreditAdjustment("25", 1, zeroAccount), {
    valid: true,
    amount: 25,
    projected: 25,
    overdrawn: false,
    error: "",
  });
});

test("evaluateCreditAdjustment previews projected balance and rejects deductions exceeding available credits", () => {
  const account = { available: 50, balance: 80, reserved: 30 };

  assert.deepEqual(evaluateCreditAdjustment("30", -1, account), {
    valid: true,
    amount: 30,
    projected: 20,
    overdrawn: false,
    error: "",
  });

  assert.deepEqual(evaluateCreditAdjustment("50", -1, account), {
    valid: true,
    amount: 50,
    projected: 0,
    overdrawn: false,
    error: "",
  });

  assert.deepEqual(evaluateCreditAdjustment("51", -1, account), {
    valid: false,
    amount: null,
    projected: -1,
    overdrawn: true,
    error: "可用积分不足，当前最多可扣减 50 积分",
  });

  assert.deepEqual(evaluateCreditAdjustment("100", 1, account), {
    valid: true,
    amount: 100,
    projected: 150,
    overdrawn: false,
    error: "",
  });
});

test("evaluateCreditAdjustment rejects non-positive, decimal, badInput and upper-bound overflows", () => {
  const account = { available: 1_500, balance: 1_500 };

  assert.equal(
    evaluateCreditAdjustment("1.5", 1, account).error,
    "积分数量仅支持正整数",
  );
  assert.equal(
    evaluateCreditAdjustment("", 1, account, true).error,
    "积分数量仅支持正整数",
  );
  assert.equal(
    evaluateCreditAdjustment("0", 1, account).error,
    "积分数量需为至少 1 的正整数",
  );
  assert.equal(
    evaluateCreditAdjustment("-5", 1, account).error,
    "积分数量需为至少 1 的正整数",
  );
  assert.equal(
    evaluateCreditAdjustment(
      String(MAX_CREDIT_ADJUSTMENT + 1),
      1,
      account,
    ).error,
    "单次调整不能超过 1,000,000,000 积分",
  );
  assert.equal(
    evaluateCreditAdjustment("10", 1, {
      available: MAX_WALLET_BALANCE - 5,
      balance: MAX_WALLET_BALANCE - 5,
    }).error,
    "调整后账户总余额超出上限",
  );
});

test("formatRechargeRangeHint and evaluateRechargeYuan enforce server bounds and integer yuan rules", () => {
  const bounds = { min_yuan: 1, max_yuan: 10_000 };

  assert.equal(
    formatRechargeRangeHint(bounds.min_yuan, bounds.max_yuan),
    "单笔充值 ¥1–¥10,000，仅支持整数元",
  );
  assert.equal(
    formatRechargeRangeHint(5, 2_000),
    "单笔充值 ¥5–¥2,000，仅支持整数元",
  );

  assert.deepEqual(evaluateRechargeYuan("1", bounds), {
    valid: true,
    amount: 1,
    credits: 10,
    error: "",
  });
  assert.deepEqual(evaluateRechargeYuan("10000", bounds), {
    valid: true,
    amount: 10_000,
    credits: 100_000,
    error: "",
  });

  assert.deepEqual(evaluateRechargeYuan("", bounds), {
    valid: false,
    amount: null,
    credits: null,
    error: "请输入充值金额",
  });
  assert.deepEqual(evaluateRechargeYuan("", bounds, true), {
    valid: false,
    amount: null,
    credits: null,
    error: "充值金额仅支持整数元",
  });
  assert.deepEqual(evaluateRechargeYuan("1.5", bounds), {
    valid: false,
    amount: null,
    credits: null,
    error: "充值金额仅支持整数元",
  });
  assert.deepEqual(evaluateRechargeYuan("10.0", bounds), {
    valid: false,
    amount: null,
    credits: null,
    error: "充值金额仅支持整数元",
  });
  assert.deepEqual(evaluateRechargeYuan("0", bounds), {
    valid: false,
    amount: null,
    credits: null,
    error: "单笔最低充值 ¥1",
  });
  assert.deepEqual(evaluateRechargeYuan("-5", bounds), {
    valid: false,
    amount: null,
    credits: null,
    error: "单笔最低充值 ¥1",
  });
  assert.deepEqual(evaluateRechargeYuan("10001", bounds), {
    valid: false,
    amount: null,
    credits: null,
    error: "单笔最高充值 ¥10,000",
  });
});

test("createCreditAdjustmentSession settles at most once when A's response is lost, edited to B, and retried as A", async () => {
  const f = await databaseFixture();
  try {
    const identity = new OriginalIdentity(f.p);
    await identity.bootstrap({
      name: "admin",
      nickname: "管理员",
      password: "credit-adjust-idempotency-password",
    });
    const admin = (await one(
      f.db,
      "SELECT * FROM users WHERE name='admin'",
    )) as OriginalActor;
    const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
    const publicWorkspace = Number(team.public_id);
    const credits = new OriginalCredits(f.p, identity);

    // UI opens one adjustment dialog seeing initial 0 available credits.
    const uiAccount = { available: 0, reserved: 0 };
    const dialogSession = createCreditAdjustmentSession(publicWorkspace);

    // 1. Admin submits A (+50, "活动补发"); server commits A, but HTTP response is lost in transit.
    const attemptA = dialogSession.prepare({
      direction: 1,
      rawAmount: "50",
      account: uiAccount,
      rawNote: "  活动补发  ",
    });
    assert.equal(attemptA.ok, true);
    if (!attemptA.ok) throw new Error("unreachable");
    const committedWallet = await credits.adjust(admin, attemptA.payload);
    assert.equal(committedWallet.available, 50);

    // 2a. In the same open dialog, admin tries deduction B1 (-1), rejected immediately by client validation.
    const attemptB1 = dialogSession.prepare({
      direction: -1,
      rawAmount: "1",
      account: uiAccount,
      rawNote: "误扣测试",
    });
    assert.deepEqual(attemptB1, {
      ok: false,
      error: "当前账户可用 0 积分，余额不足无法扣减",
    });

    // 2b. Admin edits to another grant B2 (+20, "改试其他金额") in the same dialog;
    // stable UID causes OriginalCredits.adjust to reject B2 without touching wallet/ledger.
    const attemptB2 = dialogSession.prepare({
      direction: 1,
      rawAmount: "20",
      account: uiAccount,
      rawNote: "改试其他金额",
    });
    assert.equal(attemptB2.ok, true);
    if (!attemptB2.ok) throw new Error("unreachable");
    assert.equal(attemptB2.payload.uid, dialogSession.uid);
    await assert.rejects(
      credits.adjust(admin, attemptB2.payload),
      (err: { status?: number; message?: string }) =>
        err.status === 409 && err.message === "该操作编号已使用",
    );

    // 3. Admin changes form back to A (+50, "活动补发") and retries;
    // stable UID matches the committed ledger entry and returns idempotently without double-crediting.
    const retryA = dialogSession.prepare({
      direction: 1,
      rawAmount: "50",
      account: uiAccount,
      rawNote: "活动补发",
    });
    assert.equal(retryA.ok, true);
    if (!retryA.ok) throw new Error("unreachable");
    assert.equal(retryA.payload.uid, dialogSession.uid);
    const replayedWallet = await credits.adjust(admin, retryA.payload);
    assert.deepEqual(replayedWallet, {
      exact: { balance: "50", reserved: "0", available: "50" },
      workspace: publicWorkspace,
      balance: 50,
      reserved: 0,
      available: 50,
    });

    const ledgerSummary = await one(
      f.db,
      "SELECT count(*)::int AS count, COALESCE(sum(amount), 0)::int AS total FROM ledger WHERE workspace_id=$1 AND action='adjust'",
      [team.id],
    );
    assert.deepEqual(ledgerSummary, { count: 1, total: 50 });

    // 4. Conversely, if an attempt fails BEFORE commit (e.g. concurrent hold lowered server available),
    // editing to a smaller valid amount in a new dialog still succeeds cleanly once with that dialog's UID.
    await f.db.query("UPDATE wallets SET held=40 WHERE workspace_id=$1", [
      team.id,
    ]);
    const staleUiAccount = { available: 50, reserved: 0 };
    const secondDialog = createCreditAdjustmentSession(publicWorkspace);
    const overServerAvailable = secondDialog.prepare({
      direction: -1,
      rawAmount: "30",
      account: staleUiAccount,
      rawNote: "并发冻结后扣减",
    });
    assert.equal(overServerAvailable.ok, true);
    if (!overServerAvailable.ok) throw new Error("unreachable");
    await assert.rejects(
      credits.adjust(admin, overServerAvailable.payload),
      (err: { status?: number }) => err.status === 409,
    );

    const adjustedDown = secondDialog.prepare({
      direction: -1,
      rawAmount: "10",
      account: staleUiAccount,
      rawNote: "并发冻结后扣减",
    });
    assert.equal(adjustedDown.ok, true);
    if (!adjustedDown.ok) throw new Error("unreachable");
    assert.equal(adjustedDown.payload.uid, secondDialog.uid);
    const afterDeduct = await credits.adjust(admin, adjustedDown.payload);
    assert.deepEqual(afterDeduct, {
      exact: { balance: "40", reserved: "40", available: "0" },
      workspace: publicWorkspace,
      balance: 40,
      reserved: 40,
      available: 0,
    });

    const finalSummary = await one(
      f.db,
      "SELECT count(*)::int AS count, COALESCE(sum(amount), 0)::int AS total FROM ledger WHERE workspace_id=$1 AND action='adjust'",
      [team.id],
    );
    assert.deepEqual(finalSummary, { count: 2, total: 40 });
  } finally {
    await f.cleanup();
  }
});
