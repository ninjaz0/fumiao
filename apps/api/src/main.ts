import "reflect-metadata";
import { runtime } from "@fumiao/platform/runtime.js";
import { configureCapacity } from "@fumiao/platform/capacity.js";
import { ensureBuiltinEdgeTts } from "@fumiao/platform/tts/edge-plugin.js";
import {
  studioConfiguration,
  checkStudio,
} from "@fumiao/platform/studio-runtime.js";
import { createOriginalApp } from "./original.js";

studioConfiguration(process.env);
const p = runtime();
try {
  await checkStudio(p, process.env);
  await configureCapacity(p.db);
  await ensureBuiltinEdgeTts(p);
} catch (error) {
  await p.db.close();
  throw error;
}
const app = await createOriginalApp(p);
await app.listen(
  Number(process.env.PORT || 4000),
  process.env.API_HOST || "0.0.0.0",
);
for (const event of ["SIGTERM", "SIGINT"])
  process.on(event, () => {
    void app
      .close()
      .then(() => p.db.close())
      .then(() => process.exit(0));
  });
