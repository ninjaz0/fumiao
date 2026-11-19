-- Public media URLs retain their original identifiers; relations remain UUIDs.
ALTER TABLE assets ADD COLUMN public_id text;
UPDATE assets SET public_id=CASE WHEN metadata->>'legacyId' ~ '^[0-9a-f]{32}$' THEN metadata->>'legacyId' ELSE replace(id::text,'-','') END;
ALTER TABLE assets ALTER COLUMN public_id SET DEFAULT replace(gen_random_uuid()::text,'-','');
ALTER TABLE assets ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE assets ADD CONSTRAINT assets_public_id_format CHECK(public_id ~ '^[0-9a-f]{32}$');
CREATE UNIQUE INDEX assets_public_id ON assets(public_id);
ALTER TABLE assets ADD COLUMN original_kind text;
UPDATE assets a SET original_kind=COALESCE(
 (SELECT r.payload->>'kind' FROM legacy_records r WHERE r.collection='media' AND r.payload->>'id'=a.metadata->>'legacyId' LIMIT 1),
 CASE WHEN EXISTS(SELECT 1 FROM job_assets j WHERE j.asset_id=a.id AND j.role='output') THEN split_part(a.mime,'/',1)
 ELSE CASE WHEN a.mime LIKE 'video/%' THEN 'ref_video' WHEN a.mime LIKE 'audio/%' THEN 'ref_audio' ELSE 'ref' END END);
ALTER TABLE assets ALTER COLUMN original_kind SET DEFAULT 'ref';
ALTER TABLE assets ALTER COLUMN original_kind SET NOT NULL;
ALTER TABLE assets ADD CONSTRAINT assets_original_kind CHECK(original_kind IN ('ref','ref_video','ref_audio','image','video','audio'));
ALTER TABLE assets ADD COLUMN object_modified double precision NOT NULL DEFAULT extract(epoch FROM clock_timestamp());
CREATE TABLE avatar_objects(
 public_id text PRIMARY KEY CHECK(public_id ~ '^[0-9a-f]{32}$'), object_key text NOT NULL UNIQUE,
 size bigint NOT NULL CHECK(size>0), modified double precision NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$')
);
