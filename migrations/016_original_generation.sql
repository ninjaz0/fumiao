-- Original task UID is owner-global within the provider's original namespace.
-- Advanced request hashes remain independent. Deleted original tasks may reuse a UID.
ALTER TABLE jobs ADD COLUMN original_uid text;
ALTER TABLE jobs ADD COLUMN original_parent bigint;
ALTER TABLE jobs ADD COLUMN original_view jsonb NOT NULL DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN submission_forecast jsonb NOT NULL DEFAULT '{}';
UPDATE jobs j SET original_uid=r.payload->>'uid',
  original_parent=(r.payload->>'parent')::bigint,
  original_view=jsonb_build_object(
    'ratio',r.payload->'ratio','quality',r.payload->'quality','seconds',r.payload->'seconds',
    'sampling_steps',COALESCE(r.payload->'sampling_steps','20'::jsonb),'seed',r.payload->'seed',
    'width',r.payload->'width','height',r.payload->'height','image_quality',COALESCE(r.payload->'image_quality','"standard"'::jsonb),
    'audio_settings',COALESCE((r.payload->>'audio_settings')::jsonb,'{}'::jsonb),
    'h3_inputs',COALESCE((r.payload->>'h3_inputs')::jsonb,'{}'::jsonb),
    'actual',COALESCE((r.payload->>'output_metadata')::jsonb,'{}'::jsonb)),
  submission_forecast=COALESCE((r.payload->>'timing_forecast')::jsonb,'{}'::jsonb)
FROM legacy_records r WHERE r.collection='jobs' AND j.plugin_id='legacy-archive' AND j.public_id=r.legacy_id::bigint;
CREATE UNIQUE INDEX jobs_original_uid_live ON jobs(original_uid) WHERE original_uid IS NOT NULL AND deleted_at IS NULL;
