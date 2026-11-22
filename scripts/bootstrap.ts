import { runtime } from "../packages/platform/src/runtime.js";
import { OriginalIdentity } from "../packages/original-api/src/identity.js";
if (process.env.STUDIO_LEGACY_SOURCE)
  throw new Error(
    "STUDIO_LEGACY_SOURCE selects an existing workspace. Run pnpm import:legacy to initialize this database",
  );
const p = runtime();
try {
  if (!process.env.ADMIN_PASSWORD)
    throw new Error("Set ADMIN_PASSWORD for this command");
  const input = {
    name: process.env.ADMIN_NAME || "admin",
    nickname: process.env.ADMIN_NICKNAME || "管理员",
    password: process.env.ADMIN_PASSWORD,
  };
  console.log(JSON.stringify(await new OriginalIdentity(p).bootstrap(input)));
} finally {
  await p.db.close();
}
