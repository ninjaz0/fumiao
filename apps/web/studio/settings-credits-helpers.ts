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
