-- Old contexts are byte-preserving text. Parse only the project identifier
-- and allow escaped NULs in unrelated user text without changing the stored row.
CREATE FUNCTION model_access_legacy_chat_project(context_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE ctx json;
BEGIN
  ctx := replace(context_text, chr(92)||'u0000', chr(92)||'uFFFD')::json;
  IF json_typeof(ctx) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  IF ctx->'project' IS NULL THEN RETURN ''; END IF;
  IF (SELECT count(*) FROM json_each(ctx) WHERE key='project') <> 1 THEN RETURN NULL; END IF;
  IF json_typeof(ctx->'project')='string' AND ctx->>'project' ~ '^[a-f0-9]{32}$' THEN RETURN ctx->>'project'; END IF;
  RETURN NULL;
EXCEPTION WHEN data_exception OR program_limit_exceeded THEN RETURN NULL;
END
$$;
