-- Wave 6 Batch Precheck Tickets & Idempotent Batch Receipts (#9 F010)
-- Strictly additive sidecar tables; zero ALTER on core tables.

CREATE TABLE IF NOT EXISTS canvas_precheck_tickets (
  token TEXT PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INT NOT NULL,
  price_revision INT NOT NULL,
  request_hash TEXT NOT NULL,
  executable_keys TEXT[] NOT NULL DEFAULT '{}',
  total_credits BIGINT NOT NULL DEFAULT 0 CHECK (total_credits >= 0),
  budget_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canvas_precheck_tickets_proj
  ON canvas_precheck_tickets(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS canvas_batch_runs (
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  uid UUID NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, project_id, uid)
);
