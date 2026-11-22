// Seed the database state written by pre-sandbox Studio. The production import
// API never accepts these releases, even when their bytes match an old archive.
import { readFile } from "node:fs/promises";
import type { Platform, Actor } from "@fumiao/platform/platform.js";
import type { PackageFile } from "@fumiao/platform/studio-packages.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { one } from "@fumiao/platform/db.js";

export type LegacyPackage = PackageFile & { adapterModule: string };
export async function legacyPackage(id: string): Promise<LegacyPackage> {
  const version = id === "compatible-chat" ? "1.2.1" : "1.0.0";
  return JSON.parse(
    await readFile(
      `plugins/${id}/package/legacy-${version}.fmplugin.json`,
      "utf8",
    ),
  );
}
export async function seedLegacyPackage(p: Platform, file: LegacyPackage) {
  await p.db.transaction(async (sql) => {
    const manifest = await p.registry.installStudioPackage(
      sql,
      file.id,
      file.adapterVersion,
    );
    await new StudioCatalog(p.db).activate(sql, manifest, true);
    await sql.query("INSERT INTO studio_adapter_modules VALUES($1,$2,$3)", [
      file.id,
      file.adapterVersion,
      file.adapterModule,
    ]);
    await sql.query("INSERT INTO studio_package_releases VALUES($1,$2,$3)", [
      file.id,
      file.version,
      JSON.stringify(file),
    ]);
    await sql.query(
      "INSERT INTO studio_packages(id,version,update_url) VALUES($1,$2,$3)",
      [file.id, file.version, file.updateUrl],
    );
    if (manifest.mode === "pull") {
      const admin = (await one(
        sql,
        "SELECT id,name,nickname,role FROM users WHERE role='admin' LIMIT 1",
      )) as Actor;
      const c = await p.createConnectionOn(
        sql,
        admin,
        {
          name: file.label,
          pluginId: file.id,
          version: file.adapterVersion,
          config: {},
          concurrency: 1,
        },
        true,
      );
      await sql.query("UPDATE connections SET enabled=true WHERE id=$1", [
        c.id,
      ]);
    }
  });
}
