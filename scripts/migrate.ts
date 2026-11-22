import { runtime } from "../packages/platform/src/runtime.js";
import { migrate } from "../packages/platform/src/db.js";
import { configureCapacity } from "../packages/platform/src/capacity.js";
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
