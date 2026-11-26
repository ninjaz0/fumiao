-- Wave 6 Hardening & 4-Level Series Scenes (strictly additive sidecar tables; zero ALTER on core tables)

-- F031: Strict approved-proposal scope binding & per-execution budget/idempotency tracking
CREATE TABLE IF NOT EXISTS agent_proposal_scopes (
  proposal_id UUID PRIMARY KEY REFERENCES canvas_proposals(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  allowed_node_ids TEXT[] NOT NULL DEFAULT '{}',
  approved_credits BIGINT NOT NULL DEFAULT 0 CHECK (approved_credits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_proposal_executions (
  proposal_id UUID NOT NULL REFERENCES canvas_proposals(id) ON DELETE CASCADE,
  execution_key TEXT NOT NULL,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  node_id TEXT,
  amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, execution_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_proposal_exec_job
  ON agent_proposal_executions(job_id);

-- F034: Single-use order_id + activation idempotency + payment_mode accounting
CREATE TABLE IF NOT EXISTS subscription_activations (
  idempotency_key TEXT PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES workspace_subscriptions(id) ON DELETE CASCADE,
  order_id TEXT UNIQUE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cost_credits BIGINT NOT NULL DEFAULT 0 CHECK (cost_credits >= 0),
  payment_mode TEXT NOT NULL DEFAULT 'wallet' CHECK (payment_mode IN ('wallet', 'order', 'free', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_activations_workspace
  ON subscription_activations(workspace_id, created_at DESC);

-- F026: 4-level Series -> Season -> Episode -> Scene hierarchy
CREATE TABLE IF NOT EXISTS series_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id TEXT NOT NULL UNIQUE,
  episode_id UUID NOT NULL REFERENCES series_episodes(id) ON DELETE CASCADE,
  scene_no INT NOT NULL CHECK (scene_no >= 1),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  canvas_project_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  group_node_id TEXT,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, scene_no)
);

CREATE INDEX IF NOT EXISTS idx_series_scenes_episode
  ON series_scenes(episode_id, position, scene_no);
