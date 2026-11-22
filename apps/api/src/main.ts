import "reflect-metadata";
import { runtime } from "../../../packages/platform/src/runtime.js";
import { configureCapacity } from "../../../packages/platform/src/capacity.js";
import {
  studioConfiguration,
  checkStudio,
} from "../../../packages/platform/src/studio-runtime.js";
import { createOriginalApp } from "./original.js";

studioConfiguration(process.env);
const p = runtime();
try {
  await checkStudio(p, process.env);
  await configureCapacity(p.db);
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
