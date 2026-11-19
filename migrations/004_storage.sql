ALTER TABLE workspaces ADD COLUMN storage_used bigint NOT NULL DEFAULT 0 CHECK(storage_used>=0), ADD COLUMN storage_limit bigint NOT NULL DEFAULT 21474836480 CHECK(storage_limit>=0);
UPDATE workspaces w SET storage_used=COALESCE((SELECT sum(size) FROM assets WHERE workspace_id=w.id),0);
CREATE INDEX assets_workspace ON assets(workspace_id,created_at DESC);
CREATE FUNCTION account_asset_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  UPDATE workspaces SET storage_used=storage_used+NEW.size WHERE id=NEW.workspace_id AND storage_used+NEW.size<=storage_limit;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace storage quota exceeded' USING ERRCODE='P1001'; END IF;
  RETURN NEW;
 ELSIF TG_OP='DELETE' THEN
  UPDATE workspaces SET storage_used=storage_used-OLD.size WHERE id=OLD.workspace_id;
  RETURN OLD;
 END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER asset_storage_insert AFTER INSERT ON assets FOR EACH ROW EXECUTE FUNCTION account_asset_storage();
CREATE TRIGGER asset_storage_delete AFTER DELETE ON assets FOR EACH ROW EXECUTE FUNCTION account_asset_storage();
ALTER TABLE payment_orders ADD COLUMN checked_at timestamptz;
