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
CREATE INDEX canvas_chat_links_conversation_created ON canvas_chat_links(conversation_id,created,project_id);
WITH historical AS MATERIALIZED (
  SELECT c.turn_id,c.workspace_id,t.conversation_id,t.created,
         model_access_legacy_chat_project(m.context) AS project_key
  FROM chat_charges c JOIN chat_turns t ON t.id=c.turn_id
  JOIN chat_messages m ON m.id=t.user_message
  JOIN chat_conversations conv ON conv.id=t.conversation_id AND conv.workspace_id=c.workspace_id
  WHERE c.project_id IS NULL AND t.route_revision_id IS NULL
), attributed AS (
  SELECT h.turn_id, CASE WHEN h.project_key='' THEN (
    SELECT (array_agg(DISTINCT d.id))[1] FROM canvas_chat_links l
    JOIN documents d ON d.id=l.project_id AND d.kind='canvas' AND d.workspace_id=h.workspace_id
    WHERE l.conversation_id=h.conversation_id AND l.created<=h.created
    HAVING COUNT(DISTINCT d.id)=1
  ) ELSE d.id END AS project_id
  FROM historical h LEFT JOIN documents d ON d.public_id=h.project_key AND d.kind='canvas' AND d.workspace_id=h.workspace_id
)
UPDATE chat_charges c SET project_id=a.project_id FROM attributed a
WHERE c.turn_id=a.turn_id AND a.project_id IS NOT NULL;
DROP FUNCTION model_access_legacy_chat_project(text);
