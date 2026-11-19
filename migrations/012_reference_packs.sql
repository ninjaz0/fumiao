ALTER TABLE documents ADD COLUMN public_id text;
UPDATE documents SET public_id=replace(id::text,'-','');
-- Match earlier imports without renaming or overwriting unrelated documents.
CREATE FUNCTION imported_document_id(source text,kind text,key text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
 FROM (SELECT encode(sha256(convert_to(source||':'||kind||':'||key,'UTF8')),'hex') h) digest;
$$;
UPDATE documents d SET public_id=r.legacy_id FROM legacy_records r
 WHERE r.collection IN ('asset_packs','canvas_projects') AND r.legacy_id ~ '^[a-f0-9]{32}$'
 AND d.id=imported_document_id(r.source,CASE r.collection WHEN 'asset_packs' THEN 'pack' ELSE 'canvas' END,r.legacy_id);
-- Only untouched imported packs receive their source revision/time. Preserve
-- edits made through the earlier development API.
UPDATE documents d SET revision=COALESCE((r.payload->>'revision')::integer,1),updated_at=COALESCE(to_timestamp((r.payload->>'updated')::double precision),d.updated_at)
 FROM legacy_records r WHERE r.collection='asset_packs' AND d.id=imported_document_id(r.source,'pack',r.legacy_id)
 AND d.revision=1 AND d.title=r.payload->>'name'
 AND d.body->>'purpose'=r.payload->>'purpose' AND d.body->>'description'=r.payload->>'description'
 AND d.body->'assets'=COALESCE((SELECT jsonb_agg(imported_document_id(m.source,'asset',m.payload->>'media')::text ORDER BY (m.payload->>'position')::integer)
   FROM legacy_records m WHERE m.source=r.source AND m.collection='asset_pack_media' AND m.payload->>'pack'=r.legacy_id),'[]'::jsonb);
ALTER TABLE documents ALTER COLUMN public_id SET DEFAULT replace(gen_random_uuid()::text,'-','');
ALTER TABLE documents ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_public_id_format CHECK(public_id ~ '^[a-f0-9]{32}$');
CREATE UNIQUE INDEX documents_public_id ON documents(public_id);
CREATE TABLE document_pack_refs(
 document_id uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
 pack_id uuid NOT NULL REFERENCES documents,
 PRIMARY KEY(document_id,pack_id), CHECK(document_id!=pack_id)
);
CREATE INDEX document_pack_refs_pack ON document_pack_refs(pack_id);
INSERT INTO document_pack_refs(document_id,pack_id)
 SELECT DISTINCT d.id,p.id FROM documents d,
 jsonb_array_elements(CASE WHEN jsonb_typeof(d.body->'nodes')='array' THEN d.body->'nodes' ELSE '[]'::jsonb END) n,
 jsonb_array_elements(CASE WHEN jsonb_typeof(n->'asset_packs')='array' THEN n->'asset_packs' ELSE '[]'::jsonb END) r,
 documents p WHERE d.kind='canvas' AND p.kind='pack' AND NOT p.deleted AND NOT d.deleted
 AND (p.public_id=r->>'id' OR p.id::text=r->>'id') AND d.workspace_id=p.workspace_id;
CREATE FUNCTION protect_referenced_pack() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='pack' AND EXISTS(SELECT 1 FROM document_pack_refs r JOIN documents d ON d.id=r.document_id
     WHERE r.pack_id=OLD.id AND NOT d.deleted) THEN
  RAISE EXCEPTION 'reference pack is used by a canvas' USING ERRCODE='P1003';
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER pack_delete_guard BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION protect_referenced_pack();
-- A separate function returns NEW for soft deletion.
CREATE FUNCTION protect_hidden_pack() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.deleted AND NOT OLD.deleted AND OLD.kind='pack' AND
 EXISTS(SELECT 1 FROM document_pack_refs r JOIN documents d ON d.id=r.document_id WHERE r.pack_id=OLD.id AND NOT d.deleted) THEN
  RAISE EXCEPTION 'reference pack is used by a canvas' USING ERRCODE='P1003';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER pack_hide_guard BEFORE UPDATE OF deleted ON documents FOR EACH ROW EXECUTE FUNCTION protect_hidden_pack();
ALTER TABLE jobs ADD COLUMN reference_packs jsonb NOT NULL DEFAULT '[]';
UPDATE jobs j SET reference_packs=COALESCE((r.payload->>'reference_packs')::jsonb,'[]'::jsonb)
 FROM legacy_records r WHERE r.collection='jobs' AND j.id=imported_document_id(r.source,'job',r.payload->>'id');
DROP FUNCTION imported_document_id(text,text,text);
