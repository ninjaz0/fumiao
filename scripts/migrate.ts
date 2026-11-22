import { runtime } from "@fumiao/platform/runtime.js";
import { migrate } from "@fumiao/platform/db.js";
import { configureCapacity } from "@fumiao/platform/capacity.js";
const p = runtime();
try {
  await migrate(p.db);
  await configureCapacity(p.db);
  await p.registry.initializeStudio(
    p.db,
    Boolean(process.env.STUDIO_LEGACY_SOURCE),
  );
  console.log("Database and plugin manifests are ready");
} finally {
  await p.db.close();
}
