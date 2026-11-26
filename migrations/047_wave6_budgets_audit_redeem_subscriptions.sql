-- Wave 6: F015 Budget Policies & Alerts, F024 Moderation Audit Sidecar & Settings,
-- F005 Cost/Margin Sidecar, F034 Redeem Codes, Invite Rewards & Period Quota Subscriptions.
-- Note: Strictly additive sidecar tables; never ALTER core tables (jobs/documents/etc.).

CREATE TABLE IF NOT EXISTS budget_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'project')),
  scope_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily', 'monthly', 'total')),
  warn_limit BIGINT NOT NULL DEFAULT 0 CHECK (warn_limit >= 0),
  cap_limit BIGINT NOT NULL DEFAULT 0 CHECK (cap_limit >= 0),
  mode TEXT NOT NULL DEFAULT 'warn' CHECK (mode IN ('observe', 'warn', 'cap')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, period)
);

CREATE INDEX IF NOT EXISTS budget_policies_scope_idx
  ON budget_policies (scope_type, scope_id)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS budget_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES budget_policies(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  projected_spend BIGINT NOT NULL,
  warn_limit BIGINT NOT NULL,
  cap_limit BIGINT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('warn', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS budget_alerts_workspace_created_idx
  ON budget_alerts (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_audit_meta (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  original_prompt TEXT,
  rewritten_prompt TEXT,
  rewrite_attempts INTEGER NOT NULL DEFAULT 0 CHECK (rewrite_attempts >= 0),
  upstream_cost_fen INTEGER CHECK (upstream_cost_fen IS NULL OR upstream_cost_fen >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_moderation_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  auto_rewrite BOOLEAN NOT NULL DEFAULT FALSE,
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 0 AND 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  credits BIGINT NOT NULL CHECK (credits > 0),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS redeem_codes_created_idx
  ON redeem_codes (created_at DESC);

CREATE TABLE IF NOT EXISTS redeem_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id UUID NOT NULL REFERENCES redeem_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credits BIGINT NOT NULL CHECK (credits > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code_id, user_id)
);

CREATE TABLE IF NOT EXISTS invite_reward_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credits BIGINT NOT NULL CHECK (credits > 0),
  trigger_action TEXT NOT NULL DEFAULT 'register',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_reward_grants_inviter_idx
  ON invite_reward_grants (inviter_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_fen INTEGER NOT NULL CHECK (price_fen >= 0),
  period_days INTEGER NOT NULL DEFAULT 30 CHECK (period_days BETWEEN 1 AND 366),
  period_credits BIGINT NOT NULL CHECK (period_credits > 0),
  quotas JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled', 'expired')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  order_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_subscriptions_ws_idx
  ON workspace_subscriptions (workspace_id, status, current_period_end DESC);

CREATE TABLE IF NOT EXISTS subscription_grants (
  subscription_id UUID NOT NULL REFERENCES workspace_subscriptions(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  credits BIGINT NOT NULL CHECK (credits > 0),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, period_start)
);

INSERT INTO subscription_plans (code, name, price_fen, period_days, period_credits, quotas, position)
VALUES
  ('starter-monthly', '创作起步包（30天）', 2900, 30, 350, '{"max_concurrent": 4, "badge": "入门"}', 10),
  ('pro-monthly', '制片专业包（30天）', 9900, 30, 1500, '{"max_concurrent": 10, "badge": "推荐"}', 20)
ON CONFLICT (code) DO NOTHING;
