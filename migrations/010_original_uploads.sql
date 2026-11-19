CREATE TABLE asset_provenance(
 asset_id uuid PRIMARY KEY REFERENCES assets ON DELETE CASCADE,
 source_id uuid REFERENCES assets ON DELETE SET NULL,
 source_public_id text NOT NULL,
 frame_seconds double precision NOT NULL CHECK(frame_seconds>=0 AND frame_seconds<=3600),
 created_at timestamptz NOT NULL DEFAULT date_trunc('second',clock_timestamp())
);
