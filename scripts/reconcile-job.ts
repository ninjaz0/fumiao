import { runtime } from "../packages/platform/src/runtime.js";
import { Operations } from "../packages/platform/src/operations.js";
import type { Actor } from "../packages/platform/src/platform.js";
import { one } from "../packages/platform/src/db.js";
const p = runtime();
try {
  if (!process.env.JOB_ID) {
    const jobs = await p.db.query(
      "SELECT id,plugin_id,provider_model,workspace_id,created_at,error,remote_id FROM jobs WHERE state='uncertain' ORDER BY created_at",
    );
    console.log(JSON.stringify(jobs.rows, null, 2));
  } else {
    const name = process.env.ADMIN_NAME || "admin";
    const actor = (await one(
      p.db,
      "SELECT id,name,nickname,role FROM users WHERE lower(name)=lower($1) AND role='admin' AND active=true AND deleted_at IS NULL",
      [name],
    )) as Actor | undefined;
    if (!actor) throw new Error(`No active administrator named ${name}`);
    console.log(
      JSON.stringify(
        await new Operations(p).resolve(actor, process.env.JOB_ID, {
          action: process.env.ACTION,
          reason: process.env.REASON,
          remoteId: process.env.REMOTE_ID || undefined,
        }),
      ),
    );
  }
} finally {
  await p.db.close();
}
