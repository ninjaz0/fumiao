-- Original workers supply their own credential and can retry enrollment.
-- Advanced pairing rows retain their existing protocol and have no label or models.
ALTER TABLE gpu_pairings ADD COLUMN label text;
ALTER TABLE gpu_pairings ADD COLUMN models jsonb;
ALTER TABLE gpu_pairings ADD COLUMN claimed_node_id uuid REFERENCES gpu_nodes;
ALTER TABLE gpu_pairings ADD CHECK (
  (label IS NULL AND models IS NULL AND claimed_node_id IS NULL)
  OR (label IS NOT NULL AND models IS NOT NULL AND owner_id IS NOT NULL AND (claimed = (claimed_node_id IS NOT NULL)))
);
CREATE UNIQUE INDEX gpu_pairings_original_claim ON gpu_pairings(claimed_node_id) WHERE claimed_node_id IS NOT NULL;
CREATE UNIQUE INDEX gpu_pairings_numbered_label ON gpu_pairings(label) WHERE label ~ '^弗淼[0-9]{1,9}$';
CREATE TABLE original_node_names (
  label text PRIMARY KEY CHECK(label ~ '^弗淼[0-9]{1,9}$')
);
ALTER TABLE original_state_settings ADD COLUMN node_name_sequence bigint NOT NULL DEFAULT 0 CHECK(node_name_sequence BETWEEN 0 AND 999999999);
CREATE INDEX jobs_gpu_assignment ON jobs(remote_id) WHERE state='running' AND remote_id IS NOT NULL;
