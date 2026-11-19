import { runtime } from "../packages/platform/src/runtime.js";
import { studioPluginProfile } from "../packages/platform/src/studio-plugin-profile.js";
import { migrate } from "../packages/platform/src/db.js";
import { configureCapacity } from "../packages/platform/src/capacity.js";
const p = runtime();
try {
  await migrate(p.db);
  await configureCapacity(p.db);
  if (process.env.API_PROTOCOL === "original")
    await p.registry.initializeStudio(
      p.db,
      Boolean(process.env.STUDIO_LEGACY_SOURCE),
    );
  else if (!(await studioPluginProfile(p.db)))
    await p.registry.installBuiltins(p.db);
  console.log("Database and plugin manifests are ready");
} finally {
  await p.db.close();
}
