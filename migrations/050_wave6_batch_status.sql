-- Wave 6 Concurrent-Safe Batch Run Receipt State Machine (#9 F010)
-- Additive columns on our own sidecar table `canvas_batch_runs` (zero core-table ALTER).

ALTER TABLE canvas_batch_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('in_progress', 'completed'));

ALTER TABLE canvas_batch_runs
  ADD COLUMN IF NOT EXISTS expected_revision INT;

ALTER TABLE canvas_batch_runs
  ADD COLUMN IF NOT EXISTS allowed_keys TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE canvas_batch_runs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
