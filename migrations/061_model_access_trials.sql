-- Keep the originally acknowledged receipt, even after a price or route change.
CREATE TABLE model_access_trial_receipts (
  uid uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users,
  workspace_id uuid NOT NULL REFERENCES workspaces,
  request_hash text NOT NULL,
  result jsonb NOT NULL
);
CREATE INDEX model_access_chat_health ON chat_turns(route_revision_id,finished DESC)
  WHERE route_revision_id IS NOT NULL AND finished IS NOT NULL;
CREATE INDEX model_access_media_health ON jobs(route_revision_id,updated_at DESC)
  WHERE route_revision_id IS NOT NULL;
