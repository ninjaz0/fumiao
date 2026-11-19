ALTER TABLE storyboard_exports ADD COLUMN plugin_id text NOT NULL DEFAULT 'original-storyboard';
ALTER TABLE storyboard_exports ADD COLUMN plugin_version text NOT NULL DEFAULT '1.0.0';
ALTER TABLE storyboard_exports ADD COLUMN lease_token uuid;
ALTER TABLE storyboard_exports ADD COLUMN lease_until timestamptz;
CREATE TABLE storyboard_export_objects (
 export_id uuid PRIMARY KEY,
 object_key text NOT NULL UNIQUE,
 work_token uuid NOT NULL,
 committed boolean NOT NULL DEFAULT false
);
CREATE FUNCTION track_storyboard_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP!='INSERT' AND OLD.state IN ('queued','running') THEN PERFORM add_storage_change(0,-268435456); END IF;
 IF TG_OP!='DELETE' AND NEW.state IN ('queued','running') THEN PERFORM add_storage_change(0,268435456); END IF;
 RETURN NULL;
END;
$$;
CREATE TRIGGER storyboard_capacity AFTER INSERT OR UPDATE OF state OR DELETE ON storyboard_exports FOR EACH ROW EXECUTE FUNCTION track_storyboard_capacity();
SELECT add_storage_change(0,count(*)*268435456) FROM storyboard_exports WHERE state IN ('queued','running');
-- Local completed exports have no provider charge or billing ledger entry.
ALTER TABLE jobs DROP CONSTRAINT jobs_price_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_price_check CHECK(price>0 OR (price=0 AND plugin_id='original-storyboard' AND state='completed'));
