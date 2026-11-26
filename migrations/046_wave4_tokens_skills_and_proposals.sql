-- Wave 4: Workspace Scoped API Tokens (F035/F012), Workspace SKILL.md skills (F017),
-- Canvas Agent Proposals (F018), and Agent Execution Safety Policy (F031).
-- All sidecar tables avoid altering core tables checked by migration-boundary snapshots.

CREATE TABLE IF NOT EXISTS workspace_api_tokens (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  rate_limit_rpm INT NOT NULL DEFAULT 120 CHECK (rate_limit_rpm BETWEEN 1 AND 6000),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_api_tokens_ws
  ON workspace_api_tokens (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_skills (
  id UUID PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
  body_md TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_workspace_skills_ws
  ON workspace_skills (workspace_id, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_turn_skill_snapshots (
  turn_id UUID PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
  snapshots JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_proposals (
  id UUID PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  project_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  base_revision INT NOT NULL,
  title TEXT NOT NULL DEFAULT '画布变更提案',
  summary TEXT NOT NULL DEFAULT '',
  operations JSONB NOT NULL,
  estimated_credits INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'expired')),
  applied_revision INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_canvas_proposals_project
  ON canvas_proposals (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_agent_policies (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_policy TEXT NOT NULL DEFAULT 'plan_only'
    CHECK (execution_policy IN ('plan_only', 'propose_and_confirm', 'auto_within_budget')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
