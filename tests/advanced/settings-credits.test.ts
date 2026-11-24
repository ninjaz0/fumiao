import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCreditAdjustment,
  evaluateRechargeYuan,
  formatRechargeRangeHint,
  MAX_CREDIT_ADJUSTMENT,
  MAX_WALLET_BALANCE,
} from "../../apps/web/studio/settings-credits-helpers.js";

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
