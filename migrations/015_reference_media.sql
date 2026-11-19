CREATE TABLE asset_reference_media (
 asset_id uuid PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
 plugin_id text, plugin_version text,
 seconds double precision NOT NULL CHECK(seconds>=0 AND seconds<'Infinity'::double precision),
 fps double precision NOT NULL CHECK(fps>=0 AND fps<'Infinity'::double precision),
 has_audio boolean NOT NULL DEFAULT false,
 name text NOT NULL DEFAULT '' CHECK(char_length(name)<=120),
 FOREIGN KEY(plugin_id,plugin_version) REFERENCES plugin_versions(id,version),
 CHECK((plugin_id IS NULL)=(plugin_version IS NULL))
);
