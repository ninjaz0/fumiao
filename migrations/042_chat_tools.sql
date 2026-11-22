-- Each accepted turn retains its tool set through updates and removals.
-- Older turns have no rows and complete with their original chat protocol.
CREATE TABLE chat_turn_tools (
  turn_id uuid NOT NULL REFERENCES chat_turns ON DELETE CASCADE,
  plugin_id text NOT NULL,
  package_version text NOT NULL,
  tool_id text NOT NULL,
  PRIMARY KEY(turn_id,plugin_id,tool_id),
  FOREIGN KEY(plugin_id,package_version) REFERENCES studio_package_releases(id,version)
);
