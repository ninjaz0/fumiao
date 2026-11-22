-- Keep the hot path independent of release package size. Each activation gets a
-- fresh subscription identity so an uninstall/reinstall cannot replay old work.
CREATE TABLE studio_event_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id text NOT NULL, version text NOT NULL, topic text NOT NULL,
  UNIQUE(plugin_id,topic)
);
CREATE INDEX studio_subscription_topic ON studio_event_subscriptions(topic);
CREATE FUNCTION sync_studio_subscriptions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.installed,NEW.enabled,NEW.removing,NEW.version)
    IS NOT DISTINCT FROM (OLD.installed,OLD.enabled,OLD.removing,OLD.version) THEN RETURN NEW; END IF;
  DELETE FROM studio_event_subscriptions WHERE plugin_id=NEW.id;
  IF NEW.installed AND NEW.enabled AND NOT NEW.removing THEN
    INSERT INTO studio_event_subscriptions(plugin_id,version,topic)
    SELECT NEW.id,NEW.version,e->>'type' FROM studio_package_releases r,
      jsonb_array_elements(r.package->'contributes'->'events') e
      WHERE r.id=NEW.id AND r.version=NEW.version;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER studio_subscription_change AFTER INSERT OR UPDATE OF installed,enabled,removing,version
  ON studio_packages FOR EACH ROW EXECUTE FUNCTION sync_studio_subscriptions();

CREATE TABLE studio_event_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription uuid NOT NULL,
  plugin_id text NOT NULL, version text NOT NULL, topic text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  owner_id uuid, resource jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0,
  dead boolean NOT NULL DEFAULT false
);
CREATE INDEX studio_event_due ON studio_event_deliveries(available_at,id) WHERE NOT dead;
-- System-initiated calls carry a NULL actor in the existing audit stream.
ALTER TABLE studio_plugin_audit ALTER COLUMN actor_id DROP NOT NULL;

CREATE FUNCTION publish_studio_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE topic_name text; space uuid; owner_user uuid; payload jsonb;
BEGIN
  -- An automated handler may produce assets. Do not recursively schedule automations.
  IF current_setting('fumiao.event_handler',true)='on' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='jobs' THEN
    topic_name := 'job.' || NEW.state;
    space := NEW.workspace_id; owner_user := NEW.owner_id;
    payload := jsonb_build_object('id', NEW.public_id, 'kind', NEW.kind, 'state', NEW.state);
  ELSIF TG_TABLE_NAME='assets' THEN
    topic_name := 'asset.created'; space := NEW.workspace_id; owner_user := NEW.owner_id;
    payload := jsonb_build_object('id',NEW.public_id,'mime',NEW.mime,'size',NEW.size);
  ELSE
    IF TG_OP='DELETE' THEN
      topic_name := 'member.removed'; space := OLD.workspace_id; owner_user := OLD.user_id;
    ELSE
      topic_name := 'member.added'; space := NEW.workspace_id; owner_user := NEW.user_id;
    END IF;
    SELECT jsonb_build_object('id',public_id) INTO payload FROM users WHERE id=owner_user;
    owner_user := NULL;
  END IF;
  INSERT INTO studio_event_deliveries(subscription,plugin_id,version,topic,workspace_id,owner_id,resource)
    SELECT id,plugin_id,version,topic,space,owner_user,payload FROM studio_event_subscriptions WHERE topic=topic_name;
  RETURN NULL;
END $$;
CREATE TRIGGER studio_job_event AFTER UPDATE OF state ON jobs FOR EACH ROW
  WHEN (NEW.state IN ('completed','failed') AND NEW.state<>OLD.state) EXECUTE FUNCTION publish_studio_event();
CREATE TRIGGER studio_job_terminal_insert AFTER INSERT ON jobs FOR EACH ROW
  WHEN (NEW.state IN ('completed','failed')) EXECUTE FUNCTION publish_studio_event();
CREATE TRIGGER studio_asset_insert AFTER INSERT ON assets FOR EACH ROW
  WHEN (NEW.state='ready') EXECUTE FUNCTION publish_studio_event();
CREATE TRIGGER studio_asset_ready AFTER UPDATE OF state ON assets FOR EACH ROW
  WHEN (NEW.state='ready' AND OLD.state<>NEW.state) EXECUTE FUNCTION publish_studio_event();
CREATE TRIGGER studio_members_event AFTER INSERT OR DELETE ON members FOR EACH ROW EXECUTE FUNCTION publish_studio_event();

CREATE TABLE studio_action_receipts (
  plugin_id text NOT NULL REFERENCES studio_packages(id), workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, request_id uuid NOT NULL,
  fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plugin_id,workspace_id,actor_id,request_id)
);
