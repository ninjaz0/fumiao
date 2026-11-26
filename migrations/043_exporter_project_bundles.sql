-- Project-bundle exporters (Jianying Draft ZIP, FCPXML 1.11) store non-video
-- export artifacts alongside existing MP4 compositions while keeping legacy rows valid.
ALTER TABLE assets DROP CONSTRAINT assets_original_kind;
ALTER TABLE assets ADD CONSTRAINT assets_original_kind
  CHECK(original_kind IN ('ref','ref_video','ref_audio','image','video','audio','export'));

ALTER TABLE storyboard_exports
  ADD COLUMN output_kind text NOT NULL DEFAULT 'composition' CHECK(output_kind IN ('composition','project')),
  ADD COLUMN output_mime text NOT NULL DEFAULT 'video/mp4',
  ADD COLUMN output_filename text,
  ADD COLUMN basis_hash text;

CREATE INDEX idx_storyboard_exports_basis
  ON storyboard_exports(workspace_id, project_id, exporter_plugin, exporter_id, exporter_version, basis_hash)
  WHERE state='done' AND basis_hash IS NOT NULL;
