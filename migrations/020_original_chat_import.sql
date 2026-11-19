-- An adoption survives deletion of its canvas in Pure. Retain the public key,
-- while an optional live FK supports native canvas relationships.
ALTER TABLE chat_applications ADD COLUMN project_public_id text;
UPDATE chat_applications a SET project_public_id=d.public_id FROM documents d WHERE d.id=a.project_id;
ALTER TABLE chat_applications ALTER COLUMN project_public_id SET NOT NULL;
ALTER TABLE chat_applications ADD CHECK(project_public_id ~ '^[0-9a-f]{32}$');
ALTER TABLE chat_applications ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE chat_applications DROP CONSTRAINT chat_applications_project_id_fkey;
ALTER TABLE chat_applications ADD FOREIGN KEY(project_id) REFERENCES documents ON DELETE SET NULL;
ALTER TABLE chat_applications ADD FOREIGN KEY(message_id,conversation_id) REFERENCES chat_messages(id,conversation_id);

-- PostgreSQL JSONB cannot hold decoded U+0000. Chat audit snapshots use raw
-- UTF-8 JSON bytes, with access metadata outside the payload for isolation.
CREATE TABLE legacy_chat_records (
 source text NOT NULL,
 collection text NOT NULL,
 legacy_id text NOT NULL,
 workspace_id uuid NOT NULL REFERENCES workspaces,
 payload bytea NOT NULL,
 PRIMARY KEY(source,collection,legacy_id)
);
CREATE INDEX legacy_chat_records_workspace ON legacy_chat_records(workspace_id);
