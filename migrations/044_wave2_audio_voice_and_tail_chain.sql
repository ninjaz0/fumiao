-- Wave 2: character pack voice profiles (F032), tail-frame job chaining (F028),
-- and storyboard audio mix/ducking/loudnorm snapshots (F014 / F020 / F033).

CREATE TABLE asset_pack_meta (
  pack_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  turnaround_views JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice_profile JSONB
);

CREATE TABLE job_tail_chains (
  child_job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  parent_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_tail_chains_parent
  ON job_tail_chains (parent_job_id);

ALTER TABLE storyboard_exports
  ADD COLUMN mix_options JSONB;
