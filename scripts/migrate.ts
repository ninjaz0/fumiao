import { runtime } from "../packages/platform/src/runtime.js";
import { migrate } from "../packages/platform/src/db.js";
import { configureCapacity } from "../packages/platform/src/capacity.js";
const p = runtime();
try {
  await migrate(p.db);
  await configureCapacity(p.db);
  await p.registry.installBuiltins(p.db, process.env.API_PROTOCOL === "original");
  console.log("Database and plugin manifests are ready");
} finally {
  await p.db.close();
}
