ALTER TABLE chat_turns
  DROP CONSTRAINT chat_turns_check,
  ADD COLUMN route_revision_id uuid,
  ADD COLUMN price_revision_id uuid,
  ADD COLUMN native_purpose text GENERATED ALWAYS AS (CASE WHEN route_revision_id IS NOT NULL THEN 'chat'::text END) STORED,
  ADD FOREIGN KEY(model,native_purpose,route_revision_id) REFERENCES model_access_route_revisions(catalog_id,purpose,id),
  ADD FOREIGN KEY(model,native_purpose,price_revision_id) REFERENCES model_access_price_revisions(catalog_id,purpose,id),
  ADD COLUMN native_snapshot text,
  ADD CONSTRAINT chat_turn_source CHECK (
    (route_revision_id IS NULL AND price_revision_id IS NULL AND native_snapshot IS NULL AND
     (state<>'running' OR (plugin_id IS NOT NULL AND plugin_version IS NOT NULL AND config_snapshot IS NOT NULL))) OR
    (route_revision_id IS NOT NULL AND price_revision_id IS NOT NULL AND native_snapshot IS NOT NULL
     AND plugin_id IS NULL AND plugin_version IS NULL AND config_snapshot IS NULL AND connection_id IS NOT NULL)
  );
-- Cost attribution survives permanent canvas removal, just like the receipt.
ALTER TABLE chat_charges ADD COLUMN project_id uuid;
CREATE INDEX chat_charge_project ON chat_charges(project_id) WHERE project_id IS NOT NULL;
CREATE TABLE chat_turn_bills (
  turn_id uuid PRIMARY KEY REFERENCES chat_turns,
  bill jsonb NOT NULL
);
CREATE INDEX ledger_imported_chat_spend ON ledger(workspace_id,original_chat_turn)
  WHERE action='spend' AND chat_turn_id IS NULL AND original_chat_turn IS NOT NULL;
