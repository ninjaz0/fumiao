-- Resource connections pin a declaration version and cannot dispatch jobs.
ALTER TABLE connections ADD COLUMN fmworker_resource_driver boolean NOT NULL DEFAULT false;
ALTER TABLE connections ADD CHECK (NOT fmworker_resource_driver OR NOT enabled);
CREATE UNIQUE INDEX fmworker_resource_connection ON connections(plugin_id,plugin_version)
  WHERE fmworker_resource_driver;

ALTER TABLE fmworker_resources ADD COLUMN created bigint NOT NULL
  DEFAULT floor(extract(epoch FROM clock_timestamp()));

CREATE TABLE fmworker_usage (
  node_id uuid NOT NULL REFERENCES gpu_nodes,
  uid bytea NOT NULL CHECK (octet_length(uid) BETWEEN 1 AND 400),
  units double precision NOT NULL CHECK (units BETWEEN 0 AND 1000000),
  created bigint NOT NULL CHECK (created>=0),
  PRIMARY KEY (node_id,uid)
);

-- Archives preserve public fields without credentials. Early exports carried
-- usage records alone, so usage can reference an archived node without a marker.
CREATE FUNCTION restore_original_fmworker_resources(import_source text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE nul_marker text := gen_random_uuid()::text;
BEGIN
  INSERT INTO fmworker_resources(node_id,kind,enabled,capabilities,created)
  SELECT n.id,r.payload->>'kind',(r.payload->>'enabled')::integer=1,
    (r.payload->>'capabilities')::jsonb,(r.payload->>'created')::bigint
  FROM legacy_records r
  JOIN legacy_records nr ON nr.source=r.source AND nr.collection='nodes' AND nr.legacy_id=r.payload->>'node'
  JOIN gpu_nodes n ON n.archived AND n.public_id=(nr.payload->>'id')::bigint
  JOIN users u ON u.id=n.owner_id AND u.public_id=(nr.payload->>'owner')::bigint
  WHERE r.collection='fm_resources' AND (import_source IS NULL OR r.source=import_source)
  ON CONFLICT(node_id) DO NOTHING;

  -- PR21 stored raw JSON. PostgreSQL cannot extract any field from JSON
  -- containing an escaped NUL. Protect only actual NUL escapes before parsing,
  -- then restore them as bytes, retaining literal backslash-u0000 strings.
  WITH usage_records AS MATERIALIZED (
    SELECT source,regexp_replace(payload::text,$rx$(?<!\\)((?:\\\\)*)\\u0000$rx$,
        $replacement$\1$replacement$||nul_marker,'g')::json AS payload
    FROM legacy_records
    WHERE collection='fm_usage' AND (import_source IS NULL OR source=import_source)
  )
  INSERT INTO fmworker_usage(node_id,uid,units,created)
  SELECT n.id,COALESCE(decode(r.payload->>'uid_hex','hex'), (
      SELECT string_agg(convert_to(chunk,'UTF8'),decode('00','hex') ORDER BY position)
      FROM unnest(string_to_array(r.payload->>'uid',nul_marker)) WITH ORDINALITY AS parts(chunk,position)
    )),
    (r.payload->>'units')::double precision,(r.payload->>'created')::bigint
  FROM usage_records r
  JOIN legacy_records nr ON nr.source=r.source AND nr.collection='nodes' AND nr.legacy_id=r.payload->>'node'
  JOIN gpu_nodes n ON n.archived AND n.public_id=(nr.payload->>'id')::bigint
  ON CONFLICT(node_id,uid) DO NOTHING;
END;
$$;

SELECT restore_original_fmworker_resources(NULL);

-- Only store reservation metadata and opaque provider request IDs.
CREATE TABLE fmworker_verifications (
  request_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES fmworker_resources,
  ticket_hash text NOT NULL,
  fingerprint text NOT NULL,
  user_agent bytea NOT NULL,
  provider_id text,
  created bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))
);
CREATE INDEX fmworker_verification_job ON fmworker_verifications(job_id);
