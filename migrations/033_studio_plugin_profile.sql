-- An absent row belongs to callers that have not initialized the Studio launcher.
-- Persist the decision so a restart cannot seed a deliberately empty catalog.
CREATE TABLE studio_plugin_profile (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode text NOT NULL CHECK (mode IN ('explicit', 'compatible'))
);
