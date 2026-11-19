-- Account every writer, including imports and plugin/GPU results. The global
-- counter is locked only at commit, after business rows, to avoid a quota ->
-- wallet/job/workspace lock inversion. All deltas in a transaction apply once.
CREATE TABLE storage_capacity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 used bigint NOT NULL CHECK(used>=0),
 reserved bigint NOT NULL CHECK(reserved>=0),
 quota bigint NOT NULL DEFAULT 20000000000 CHECK(quota>=0)
);
CREATE TABLE storage_holds (
 key text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('job','export')),
 job_id uuid UNIQUE REFERENCES jobs ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES workspaces,
 budget bigint NOT NULL CHECK(budget>=0),
 materialized bigint NOT NULL DEFAULT 0 CHECK(materialized>=0),
 CHECK((kind='job' AND job_id IS NOT NULL AND budget=67108864) OR
       (kind='export' AND job_id IS NULL AND budget=268435456))
);
CREATE INDEX job_assets_output_asset ON job_assets(asset_id) WHERE role='output';
-- Keep workspace accounting consistent if a maintenance/import transaction
-- changes a stored size or moves an asset; INSERT/DELETE already have triggers.
CREATE FUNCTION update_asset_workspace_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.workspace_id=OLD.workspace_id THEN
  UPDATE workspaces SET storage_used=storage_used+NEW.size-OLD.size WHERE id=NEW.workspace_id
   AND (NEW.size<=OLD.size OR storage_used+NEW.size-OLD.size<=storage_limit);
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace storage quota exceeded' USING ERRCODE='P1001'; END IF;
 ELSE
  PERFORM id FROM workspaces WHERE id IN (OLD.workspace_id,NEW.workspace_id) ORDER BY id FOR UPDATE;
  UPDATE workspaces SET storage_used=storage_used-OLD.size WHERE id=OLD.workspace_id;
  UPDATE workspaces SET storage_used=storage_used+NEW.size WHERE id=NEW.workspace_id AND storage_used+NEW.size<=storage_limit;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace storage quota exceeded' USING ERRCODE='P1001'; END IF;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER asset_storage_update AFTER UPDATE OF size,workspace_id ON assets
 FOR EACH ROW EXECUTE FUNCTION update_asset_workspace_storage();
INSERT INTO storage_holds(key,kind,job_id,workspace_id,budget,materialized)
 SELECT 'job:'||j.id,'job',j.id,j.workspace_id,67108864,
 COALESCE((SELECT sum(a.size) FROM job_assets r JOIN assets a ON a.id=r.asset_id
           WHERE r.job_id=j.id AND r.role='output'),0)
 FROM jobs j WHERE j.kind!='chat' AND j.state NOT IN ('completed','failed','cancelled');
INSERT INTO storage_capacity(singleton,used,reserved)
 SELECT true,(SELECT COALESCE(sum(size),0) FROM assets),
 (SELECT COALESCE(sum(GREATEST(0,budget-materialized)),0) FROM storage_holds);

CREATE TABLE storage_changes (
 transaction_id bigint PRIMARY KEY,
 used_delta bigint NOT NULL DEFAULT 0,
 reserved_delta bigint NOT NULL DEFAULT 0
);
CREATE FUNCTION add_storage_change(bytes bigint, holds bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF bytes=0 AND holds=0 THEN RETURN; END IF;
 INSERT INTO storage_changes(transaction_id,used_delta,reserved_delta)
 VALUES(txid_current(),bytes,holds)
 ON CONFLICT(transaction_id) DO UPDATE SET
 used_delta=storage_changes.used_delta+EXCLUDED.used_delta,
 reserved_delta=storage_changes.reserved_delta+EXCLUDED.reserved_delta;
END;
$$;
CREATE FUNCTION commit_storage_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE delta storage_changes%ROWTYPE;
BEGIN
 DELETE FROM storage_changes WHERE transaction_id=NEW.transaction_id RETURNING * INTO delta;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE storage_capacity SET used=used+delta.used_delta,reserved=reserved+delta.reserved_delta
 WHERE singleton AND (delta.used_delta+delta.reserved_delta<=0 OR
 used+reserved+delta.used_delta+delta.reserved_delta<=quota);
 IF NOT FOUND THEN RAISE EXCEPTION 'global storage quota exceeded' USING ERRCODE='P1002'; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER storage_commit AFTER INSERT OR UPDATE ON storage_changes
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commit_storage_change();

CREATE FUNCTION track_asset_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN PERFORM add_storage_change(NEW.size,0);
 ELSIF TG_OP='DELETE' THEN PERFORM add_storage_change(-OLD.size,0);
 ELSE
  PERFORM add_storage_change(NEW.size-OLD.size,0);
  UPDATE storage_holds h SET materialized=materialized+NEW.size-OLD.size
  WHERE h.job_id IN (SELECT job_id FROM job_assets WHERE asset_id=NEW.id AND role='output');
 END IF;
 RETURN NULL;
END;
$$;
-- Run after workspace accounting, before touching a job's hold.
CREATE TRIGGER asset_z_capacity AFTER INSERT OR DELETE OR UPDATE OF size ON assets
 FOR EACH ROW EXECUTE FUNCTION track_asset_capacity();

CREATE FUNCTION track_storage_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN PERFORM add_storage_change(0,GREATEST(0,NEW.budget-NEW.materialized));
 ELSIF TG_OP='DELETE' THEN PERFORM add_storage_change(0,-GREATEST(0,OLD.budget-OLD.materialized));
 ELSE PERFORM add_storage_change(0,GREATEST(0,NEW.budget-NEW.materialized)-GREATEST(0,OLD.budget-OLD.materialized));
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER hold_capacity AFTER INSERT OR UPDATE OR DELETE ON storage_holds
 FOR EACH ROW EXECUTE FUNCTION track_storage_hold();

CREATE FUNCTION track_job_storage_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='chat' OR NEW.state IN ('completed','failed','cancelled') THEN
  DELETE FROM storage_holds WHERE job_id=NEW.id;
 ELSE
  INSERT INTO storage_holds(key,kind,job_id,workspace_id,budget,materialized)
  SELECT 'job:'||NEW.id,'job',NEW.id,NEW.workspace_id,67108864,
   COALESCE(sum(a.size),0) FROM job_assets r JOIN assets a ON a.id=r.asset_id
   WHERE r.job_id=NEW.id AND r.role='output'
  ON CONFLICT(job_id) DO NOTHING;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER job_storage_hold AFTER INSERT OR UPDATE OF state ON jobs
 FOR EACH ROW EXECUTE FUNCTION track_job_storage_hold();

CREATE FUNCTION track_output_storage_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP!='INSERT' AND OLD.role='output' THEN
  UPDATE storage_holds SET materialized=materialized-(SELECT size FROM assets WHERE id=OLD.asset_id)
  WHERE job_id=OLD.job_id;
 END IF;
 IF TG_OP!='DELETE' AND NEW.role='output' THEN
  UPDATE storage_holds SET materialized=materialized+(SELECT size FROM assets WHERE id=NEW.asset_id)
  WHERE job_id=NEW.job_id;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER output_storage_hold AFTER INSERT OR UPDATE OR DELETE ON job_assets
 FOR EACH ROW EXECUTE FUNCTION track_output_storage_hold();
