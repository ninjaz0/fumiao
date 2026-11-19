-- Preserve state-screen data without importing live GPU credentials.
CREATE FUNCTION state_import_id(source text,kind text,key text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
 FROM (SELECT encode(sha256(convert_to(source||':'||kind||':'||key,'UTF8')),'hex') h) digest;
$$;
ALTER TABLE gpu_pairings ADD COLUMN owner_id uuid REFERENCES users;
ALTER TABLE gpu_nodes ADD COLUMN owner_id uuid REFERENCES users;
ALTER TABLE gpu_nodes ADD COLUMN detail text NOT NULL DEFAULT '';
ALTER TABLE gpu_nodes ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE gpu_nodes ADD CHECK(NOT archived OR NOT enabled);
ALTER TABLE gpu_nodes DROP CONSTRAINT gpu_nodes_control_check;
ALTER TABLE gpu_nodes ADD CHECK(control IN ('active','paused','draining','removed'));
CREATE INDEX gpu_nodes_owner ON gpu_nodes(owner_id,public_id DESC);

-- Existing deployments may lack these facts. NULL means unknown, never an
-- invented owner, ordering or attempt count. New inserts have explicit defaults.
CREATE SEQUENCE assets_original_order_seq AS bigint MAXVALUE 9007199254740991;
ALTER TABLE assets ADD COLUMN original_order bigint UNIQUE CHECK(original_order BETWEEN 1 AND 9007199254740991);
ALTER TABLE assets ALTER COLUMN original_order SET DEFAULT nextval('assets_original_order_seq');
ALTER SEQUENCE assets_original_order_seq OWNED BY assets.original_order;
CREATE INDEX assets_state_order ON assets(workspace_id,original_order DESC) WHERE original_kind IN ('ref','ref_video','ref_audio');
ALTER TABLE jobs ADD COLUMN attempts integer CHECK(attempts>=0);
ALTER TABLE jobs ALTER COLUMN attempts SET DEFAULT 0;
ALTER TABLE jobs ADD COLUMN original_node bigint CHECK(original_node BETWEEN 1 AND 9007199254740991);
UPDATE jobs j SET attempts=r.attempt FROM (SELECT job,max(attempt) AS attempt FROM job_runs GROUP BY job) r WHERE j.id=r.job;
UPDATE jobs SET attempts=0 WHERE state='queued' AND attempts IS NULL AND remote_id IS NULL AND plugin_id!='legacy-archive';
UPDATE jobs j SET attempts=COALESCE((r.payload->>'attempts')::integer,j.attempts),
  original_node=(r.payload->>'node')::bigint,
  original_view=j.original_view || jsonb_build_object('refs',COALESCE((r.payload->>'refs')::jsonb,'[]'::jsonb),
    'created',r.payload->'created','updated',r.payload->'updated','note',r.payload->'note','result',r.payload->'result')
FROM legacy_records r WHERE r.collection='jobs' AND j.id=state_import_id(r.source,'job',r.legacy_id);
UPDATE assets a SET original_order=(r.payload->>'original_order')::bigint
FROM legacy_records r WHERE r.collection='media' AND a.id=state_import_id(r.source,'asset',r.legacy_id)
  AND r.payload->>'original_order' IS NOT NULL;
SELECT setval('assets_original_order_seq',GREATEST(COALESCE((SELECT max(original_order) FROM assets),0),1),EXISTS(SELECT 1 FROM assets WHERE original_order IS NOT NULL));

CREATE TABLE original_state_settings(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 legacy_workspace_id uuid REFERENCES workspaces,
 image_enabled boolean NOT NULL DEFAULT true
);
INSERT INTO original_state_settings(singleton) VALUES(true);
-- Earlier exports did not include these settings; do not guess their values.
UPDATE original_state_settings SET legacy_workspace_id=state_import_id(r.source,'workspace',r.payload->>'value')
FROM legacy_records r WHERE r.collection='state_settings' AND r.payload->>'key'='workspaces_migrated_v1';
UPDATE original_state_settings SET image_enabled=(r.payload->>'value')::boolean
FROM legacy_records r WHERE r.collection='state_settings' AND r.payload->>'key'='image_enabled';
-- Previous exports retained expired job tickets in their audit payload. Those
-- credentials have no role in historical display or execution on the new stack.
UPDATE legacy_records SET payload=payload-'ticket'-'lease' WHERE collection='jobs';
DROP FUNCTION state_import_id(text,text,text);
