import type { Fields } from "./validation.js";

export const budgetUpsertFields: Fields = {
  scope_type: {
    kind: "literal",
    values: ["workspace", "project"],
    default: "workspace",
  },
  scope_id: { kind: "string", max: 120, optional: true },
  period: { kind: "literal", values: ["daily", "monthly", "total"] },
  warn_limit: { kind: "integer", min: 0, max: 100_000_000 },
  cap_limit: { kind: "integer", min: 0, max: 100_000_000 },
  mode: {
    kind: "literal",
    values: ["observe", "warn", "cap"],
    default: "warn",
  },
  enabled: { kind: "boolean", strict: false, default: true },
};

export const moderationSettingsFields: Fields = {
  auto_rewrite: { kind: "boolean", strict: false },
  max_attempts: { kind: "integer", min: 0, max: 2, default: 2 },
};

export const reconcileJobFields: Fields = {
  action: { kind: "literal", values: ["refund", "resume"] },
  reason: { kind: "string", min: 5, max: 500 },
  remoteId: { kind: "string", min: 1, max: 500, optional: true },
};

export const redeemBatchCreateFields: Fields = {
  name: { kind: "string", min: 1, max: 80 },
  credits: { kind: "integer", min: 1, max: 10_000_000 },
  count: { kind: "integer", min: 1, max: 100, default: 10 },
  max_uses: { kind: "integer", min: 1, max: 10000, default: 1 },
  expires_in_days: {
    kind: "integer",
    min: 1,
    max: 3650,
    nullable: true,
    optional: true,
  },
};

export const redeemApplyFields: Fields = {
  code: { kind: "string", min: 4, max: 64 },
};

export const subscriptionPlanCreateFields: Fields = {
  code: { kind: "string", min: 2, max: 64 },
  name: { kind: "string", min: 1, max: 80 },
  price_fen: { kind: "integer", min: 0, max: 100_000_000 },
  period_days: { kind: "integer", min: 1, max: 366, default: 30 },
  period_credits: { kind: "integer", min: 1, max: 100_000_000 },
  quotas: { kind: "dictionary", optional: true },
  enabled: { kind: "boolean", strict: false, default: true },
};

export const subscriptionSubscribeFields: Fields = {
  plan_code: { kind: "string", min: 2, max: 64 },
  order_id: { kind: "string", max: 120, optional: true },
  uid: { kind: "string", max: 120, optional: true },
  payment_mode: {
    kind: "literal",
    values: ["wallet", "order", "admin"],
    optional: true,
  },
};
