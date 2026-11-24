export const MAX_CREDIT_ADJUSTMENT = 1_000_000_000;
export const MAX_WALLET_BALANCE = 1_000_000_000_000;

export type CreditAdjustmentAccount = {
  available: number;
  reserved?: number;
  balance?: number;
};

export type CreditAdjustmentDirection = 1 | -1;

export type CreditAdjustmentEvaluation = {
  valid: boolean;
  amount: number | null;
  projected: number | null;
  overdrawn: boolean;
  error: string;
};

export function evaluateCreditAdjustment(
  rawAmount: string,
  direction: CreditAdjustmentDirection,
  account: CreditAdjustmentAccount,
  badInput = false,
): CreditAdjustmentEvaluation {
  const trimmed = rawAmount.trim();
  if (badInput) {
    return {
      valid: false,
      amount: null,
      projected: null,
      overdrawn: false,
      error: "积分数量仅支持正整数",
    };
  }
  if (trimmed === "") {
    if (direction === -1 && account.available <= 0) {
      return {
        valid: false,
        amount: null,
        projected: account.available,
        overdrawn: false,
        error:
          account.available === 0
            ? "当前账户可用 0 积分，余额不足无法扣减"
            : `当前账户可用 ${account.available.toLocaleString("en-US")} 积分，余额不足无法扣减`,
      };
    }
    return {
      valid: false,
      amount: null,
      projected: account.available,
      overdrawn: false,
      error: "",
    };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      valid: false,
      amount: null,
      projected: null,
      overdrawn: false,
      error: "积分数量仅支持正整数",
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    if (trimmed.startsWith("-")) {
      return {
        valid: false,
        amount: null,
        projected: null,
        overdrawn: false,
        error: "积分数量需为至少 1 的正整数",
      };
    }
    if (direction === -1 && account.available <= MAX_CREDIT_ADJUSTMENT) {
      return {
        valid: false,
        amount: null,
        projected: null,
        overdrawn: true,
        error:
          account.available <= 0
            ? "当前账户可用 0 积分，余额不足无法扣减"
            : `可用积分不足，当前最多可扣减 ${account.available.toLocaleString("en-US")} 积分`,
      };
    }
    return {
      valid: false,
      amount: null,
      projected: null,
      overdrawn: false,
      error: "单次调整不能超过 1,000,000,000 积分",
    };
  }
  if (parsed <= 0) {
    return {
      valid: false,
      amount: null,
      projected: null,
      overdrawn: false,
      error: "积分数量需为至少 1 的正整数",
    };
  }
  if (direction === -1 && account.available <= 0) {
    return {
      valid: false,
      amount: null,
      projected:
        parsed <= MAX_CREDIT_ADJUSTMENT ? account.available - parsed : null,
      overdrawn: true,
      error:
        account.available === 0
          ? "当前账户可用 0 积分，余额不足无法扣减"
          : `当前账户可用 ${account.available.toLocaleString("en-US")} 积分，余额不足无法扣减`,
    };
  }
  if (direction === -1 && parsed > account.available) {
    return {
      valid: false,
      amount: null,
      projected:
        parsed <= MAX_CREDIT_ADJUSTMENT ? account.available - parsed : null,
      overdrawn: true,
      error: `可用积分不足，当前最多可扣减 ${account.available.toLocaleString("en-US")} 积分`,
    };
  }
  if (parsed > MAX_CREDIT_ADJUSTMENT) {
    return {
      valid: false,
      amount: null,
      projected: null,
      overdrawn: false,
      error: "单次调整不能超过 1,000,000,000 积分",
    };
  }
  const totalBalance =
    account.balance ?? account.available + (account.reserved ?? 0);
  if (direction === 1 && totalBalance + parsed > MAX_WALLET_BALANCE) {
    return {
      valid: false,
      amount: null,
      projected: account.available + parsed,
      overdrawn: false,
      error: "调整后账户总余额超出上限",
    };
  }
  return {
    valid: true,
    amount: parsed,
    projected: account.available + direction * parsed,
    overdrawn: false,
    error: "",
  };
}

export const RECHARGE_CREDITS_PER_YUAN = 10;

export type RechargeBounds = {
  min_yuan: number;
  max_yuan: number;
};

export type RechargeYuanEvaluation = {
  valid: boolean;
  amount: number | null;
  credits: number | null;
  error: string;
};

export function formatRechargeRangeHint(
  minYuan: number,
  maxYuan: number,
): string {
  return `单笔充值 ¥${minYuan.toLocaleString("en-US")}–¥${maxYuan.toLocaleString("en-US")}，仅支持整数元`;
}

export function evaluateRechargeYuan(
  raw: string,
  bounds: RechargeBounds,
  badInput = false,
): RechargeYuanEvaluation {
  const trimmed = raw.trim();
  if (badInput) {
    return {
      valid: false,
      amount: null,
      credits: null,
      error: "充值金额仅支持整数元",
    };
  }
  if (trimmed === "") {
    return {
      valid: false,
      amount: null,
      credits: null,
      error: "请输入充值金额",
    };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      valid: false,
      amount: null,
      credits: null,
      error: "充值金额仅支持整数元",
    };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return {
      valid: false,
      amount: null,
      credits: null,
      error: trimmed.startsWith("-")
        ? `单笔最低充值 ¥${bounds.min_yuan.toLocaleString("en-US")}`
        : `单笔最高充值 ¥${bounds.max_yuan.toLocaleString("en-US")}`,
    };
  }
  if (parsed < bounds.min_yuan) {
    return {
      valid: false,
      amount: null,
      credits: null,
      error: `单笔最低充值 ¥${bounds.min_yuan.toLocaleString("en-US")}`,
    };
  }
  if (parsed > bounds.max_yuan) {
    return {
      valid: false,
      amount: null,
      credits: null,
      error: `单笔最高充值 ¥${bounds.max_yuan.toLocaleString("en-US")}`,
    };
  }
  return {
    valid: true,
    amount: parsed,
    credits: parsed * RECHARGE_CREDITS_PER_YUAN,
    error: "",
  };
}
