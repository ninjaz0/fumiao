import { runtime } from "@fumiao/platform/runtime.js";
import { ensureBuiltinEdgeTts } from "@fumiao/platform/tts/edge-plugin.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
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
  const admin = await new OriginalIdentity(p).bootstrap(input);
  await ensureBuiltinEdgeTts(p);
  console.log(JSON.stringify(admin));
} finally {
  await p.db.close();
}
