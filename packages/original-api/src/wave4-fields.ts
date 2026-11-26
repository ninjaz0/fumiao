import type { Fields } from "./validation.js";

export const WORKSPACE_TOKEN_SCOPES = [
  "canvas:read",
  "canvas:propose",
  "canvas:write",
  "job:submit",
  "job:read",
  "asset:read",
  "asset:write",
  "pack:read",
  "skill:read",
  "skill:write",
  "mcp:use",
] as const;

export type WorkspaceTokenScope = (typeof WORKSPACE_TOKEN_SCOPES)[number];

export const tokenCreateFields: Fields = {
  name: { kind: "string", min: 1, max: 80 },
  scopes: {
    kind: "list",
    item: { kind: "literal", values: [...WORKSPACE_TOKEN_SCOPES] },
    min: 1,
    max: WORKSPACE_TOKEN_SCOPES.length,
  },
  rate_limit_rpm: { kind: "integer", min: 1, max: 6000, default: 120 },
  expires_in_days: {
    kind: "integer",
    min: 1,
    max: 365,
    nullable: true,
    optional: true,
  },
};

export const skillCreateFields: Fields = {
  raw_md: { kind: "string", max: 65536, optional: true },
  slug: { kind: "string", max: 64, optional: true },
  name: { kind: "string", max: 80, optional: true },
  description: { kind: "string", max: 400, optional: true },
  body_md: { kind: "string", max: 65536, optional: true },
  enabled: { kind: "boolean", strict: false, default: true },
};

export const skillUpdateFields: Fields = {
  expected_revision: { kind: "integer", min: 1 },
  raw_md: { kind: "string", max: 65536, optional: true },
  name: { kind: "string", max: 80, optional: true },
  description: { kind: "string", max: 400, optional: true },
  body_md: { kind: "string", max: 65536, optional: true },
  enabled: { kind: "boolean", strict: false, optional: true },
};

export const agentPolicyFields: Fields = {
  execution_policy: {
    kind: "literal",
    values: ["plan_only", "propose_and_confirm", "auto_within_budget"],
  },
};

export const proposalCreateFields: Fields = {
  title: { kind: "string", max: 120, default: "画布变更提案" },
  summary: { kind: "string", max: 2000, default: "" },
  base_revision: { kind: "integer", min: 1, nullable: true, optional: true },
  operations: { kind: "list", item: { kind: "dictionary" }, min: 1, max: 120 },
};

export const proposalApplyFields: Fields = {
  expected_revision: { kind: "integer", min: 1, exactInteger: true },
};
