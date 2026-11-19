CREATE TABLE studio_package_releases (
  id text NOT NULL,
  version text NOT NULL,
  package jsonb NOT NULL,
  PRIMARY KEY(id,version)
);
CREATE TABLE studio_packages (
  id text PRIMARY KEY,
  version text NOT NULL,
  previous_version text,
  installed boolean NOT NULL DEFAULT true,
  removing boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  update_url text,
  update_auth text,
  checked_at timestamptz,
  update_info jsonb,
  FOREIGN KEY(id,version) REFERENCES studio_package_releases
);

-- Preserve services already provisioned on this installation.
INSERT INTO studio_package_releases
SELECT DISTINCT ON (c.plugin_id) c.plugin_id,c.plugin_version,jsonb_build_object(
  'format',1,'id',v.id,'label',v.manifest->>'label','version',v.version,
  'adapterVersion',v.version)
FROM studio_catalog c JOIN plugin_versions v ON (v.id,v.version)=(c.plugin_id,c.plugin_version)
JOIN connections s ON (s.plugin_id,s.plugin_version)=(v.id,v.version)
WHERE NOT s.fmworker_resource_driver ORDER BY c.plugin_id,c.plugin_version DESC;
INSERT INTO studio_packages(id,version,enabled)
SELECT p.id,p.version,EXISTS(SELECT 1 FROM connections c WHERE c.plugin_id=p.id AND c.enabled AND NOT c.fmworker_resource_driver)
FROM studio_package_releases p;

CREATE FUNCTION studio_plugin_accepts(provider text) RETURNS boolean LANGUAGE SQL STABLE AS $$
  SELECT COALESCE((SELECT installed AND enabled FROM studio_packages WHERE id=provider),true)
$$;

ALTER TABLE connections ADD COLUMN removed boolean NOT NULL DEFAULT false;
CREATE TABLE studio_model_service (
 model_id text PRIMARY KEY REFERENCES studio_catalog(id),
 connection_id uuid NOT NULL REFERENCES connections(id)
);
CREATE FUNCTION studio_service_selected(catalog text, service uuid) RETURNS boolean LANGUAGE SQL STABLE AS $$
 SELECT COALESCE((SELECT connection_id=service FROM studio_model_service WHERE model_id=catalog),true)
$$;
ALTER TABLE jobs ADD COLUMN package_version text;
ALTER TABLE jobs ADD FOREIGN KEY(plugin_id,package_version) REFERENCES studio_package_releases(id,version);
CREATE TABLE studio_adapter_modules (
 id text NOT NULL, version text NOT NULL, code text NOT NULL, PRIMARY KEY(id,version)
);
ALTER TABLE studio_prices DROP CONSTRAINT studio_prices_amount_check;
ALTER TABLE studio_prices ADD CHECK(amount BETWEEN 0 AND 1000000000);
ALTER TABLE jobs DROP CONSTRAINT jobs_price_check;
ALTER TABLE jobs ADD CHECK(price>=0);
ALTER TABLE chat_charges DROP CONSTRAINT chat_charges_amount_check;
ALTER TABLE chat_charges ADD CHECK(amount>=0);

CREATE TABLE studio_shared_models(
  model_id text NOT NULL REFERENCES studio_catalog(id),
  plugin_id text NOT NULL,
  PRIMARY KEY(model_id,plugin_id)
);
ALTER TABLE studio_catalog ADD COLUMN display_label text;
ALTER TABLE jobs ADD COLUMN studio_client_uid text;
CREATE INDEX jobs_studio_client_uid ON jobs(owner_id,catalog_id,studio_client_uid) WHERE studio_client_uid IS NOT NULL;

CREATE TABLE studio_service_versions (
  connection_id uuid REFERENCES connections(id),
  version text NOT NULL,
  config text NOT NULL,
  PRIMARY KEY(connection_id,version)
);

-- Restore the administrator's price when a later version brings a tier back.
CREATE TABLE studio_retired_prices (key text PRIMARY KEY, amount bigint);
CREATE FUNCTION remember_studio_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO studio_retired_prices VALUES(OLD.key,OLD.amount)
  ON CONFLICT(key) DO UPDATE SET amount=excluded.amount;
  RETURN OLD;
END;
$$;
CREATE TRIGGER studio_price_retired AFTER DELETE ON studio_prices
FOR EACH ROW EXECUTE FUNCTION remember_studio_price();
CREATE FUNCTION restore_studio_price() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved bigint;
BEGIN
  SELECT amount INTO saved FROM studio_retired_prices WHERE key=NEW.key;
  IF FOUND THEN NEW.amount=saved; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER studio_price_restored BEFORE INSERT ON studio_prices
FOR EACH ROW EXECUTE FUNCTION restore_studio_price();
