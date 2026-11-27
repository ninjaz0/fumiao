import {
  creditUnits,
  formatCredits,
} from "@fumiao/plugin-sdk/credit-amount.js";

const legacyDecimal = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 12,
});

export function creditDecimal(value: string | number): string {
  return typeof value === "string" ? value : legacyDecimal.format(value);
}

export function displayCredits(value: string | number): string {
  const [whole, fraction] = creditDecimal(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? grouped + "." + fraction : grouped;
}

export const MAX_CREDIT_ADJUSTMENT = 1_000_000_000;
export const MAX_WALLET_BALANCE = 1_000_000_000_000;

export type CreditAdjustmentAccount = {
  available: number;
  reserved?: number;
  balance?: number;
  exact?: { available: string; reserved: string; balance: string };
};

export type CreditAdjustmentDirection = 1 | -1;

export type CreditAdjustmentEvaluation = {
  valid: boolean;
  amount: number | null;
  projected: number | string | null;
  overdrawn: boolean;
  error: string;
};

export type CreditAdjustmentPayload = {
  workspace: number;
  amount: number;
  note: string;
  uid: string;
};

/**
 * Keeps a single idempotency UID for one adjustment dialog so an already
 * committed request whose HTTP response was lost cannot settle twice after
 * intermediate edits (A -> B -> A) within the same dialog.
 */
export function createCreditAdjustmentSession(
  workspace: number,
  uid = crypto.randomUUID(),
) {
  return {
    uid,
    prepare(input: {
      direction: CreditAdjustmentDirection;
      rawAmount: string;
      account: CreditAdjustmentAccount;
      rawNote: string;
      badInput?: boolean;
    }):
      | { ok: true; payload: CreditAdjustmentPayload }
      | { ok: false; error: string } {
      const evaluation = evaluateCreditAdjustment(
        input.rawAmount,
        input.direction,
        input.account,
        input.badInput ?? false,
      );
      if (evaluation.error || !evaluation.valid || evaluation.amount === null) {
        return {
          ok: false,
          error: evaluation.error || "积分数量需为至少 1 的正整数",
        };
      }
      const note = input.rawNote.trim();
      if (!note) {
        return { ok: false, error: "请填写调整原因" };
      }
      return {
        ok: true,
        payload: {
          workspace,
          amount: evaluation.amount * input.direction,
          note,
          uid,
        },
      };
    },
  };
}

export function evaluateCreditAdjustment(
  rawAmount: string,
  direction: CreditAdjustmentDirection,
  account: CreditAdjustmentAccount,
  badInput = false,
): CreditAdjustmentEvaluation {
  const trimmed = rawAmount.trim();
  const current = account.exact?.available ?? account.available;
  const available = creditUnits(creditDecimal(current));
  const availableLabel = displayCredits(current);
  function project(delta: number) {
    const result = formatCredits(available + creditUnits(String(delta)));
    return account.exact ? result : Number(result);
  }
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
    if (direction === -1 && available <= 0n) {
      return {
        valid: false,
        amount: null,
        projected: current,
        overdrawn: false,
        error: `当前账户可用 ${availableLabel} 积分，余额不足无法扣减`,
      };
    }
    return {
      valid: false,
      amount: null,
      projected: current,
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
    if (
      direction === -1 &&
      available <= creditUnits(String(MAX_CREDIT_ADJUSTMENT))
    ) {
      return {
        valid: false,
        amount: null,
        projected: null,
        overdrawn: true,
        error:
          available <= 0n
            ? "当前账户可用 0 积分，余额不足无法扣减"
            : `可用积分不足，当前最多可扣减 ${availableLabel} 积分`,
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
  if (direction === -1 && available <= 0n) {
    return {
      valid: false,
      amount: null,
      projected: parsed <= MAX_CREDIT_ADJUSTMENT ? project(-parsed) : null,
      overdrawn: true,
      error: `当前账户可用 ${availableLabel} 积分，余额不足无法扣减`,
    };
  }
  if (direction === -1 && creditUnits(String(parsed)) > available) {
    return {
      valid: false,
      amount: null,
      projected: parsed <= MAX_CREDIT_ADJUSTMENT ? project(-parsed) : null,
      overdrawn: true,
      error: `可用积分不足，当前最多可扣减 ${availableLabel} 积分`,
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
  const balance = account.exact?.balance ?? account.balance;
  const totalBalance =
    balance !== undefined
      ? creditUnits(creditDecimal(balance))
      : available + creditUnits(creditDecimal(account.reserved ?? 0));
  if (
    direction === 1 &&
    totalBalance + creditUnits(String(parsed)) >
      creditUnits(String(MAX_WALLET_BALANCE))
  ) {
    return {
      valid: false,
      amount: null,
      projected: project(parsed),
      overdrawn: false,
      error: "调整后账户总余额超出上限",
    };
  }
  return {
    valid: true,
    amount: parsed,
    projected: project(direction * parsed),
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
