-- Keep enabled intact: the worker still needs to drain already accepted jobs.
ALTER TABLE connections ADD COLUMN sandbox_address_pause text
  CHECK (sandbox_address_pause IN ('non-public','unresolved'));

CREATE OR REPLACE FUNCTION studio_service_selected(catalog text, service uuid)
RETURNS boolean LANGUAGE SQL STABLE AS $$
 SELECT COALESCE((SELECT connection_id=service FROM studio_model_service WHERE model_id=catalog),true)
   AND NOT EXISTS (SELECT 1 FROM connections WHERE id=service AND sandbox_address_pause IS NOT NULL)
$$;
