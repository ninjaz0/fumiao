import { randomUUID } from "node:crypto";
import { databaseFixture } from "./database.js";
import { one } from "../../packages/platform/src/db.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../../packages/original-api/src/identity.js";
import { OriginalCanvases } from "../../packages/original-api/src/canvases.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { museCanvas } from "../../plugins/muse/src/canvas.js";
import { flowCanvas } from "../../plugins/flow/src/canvas.js";
import { gpuCanvas } from "../../plugins/gpu/src/canvas.js";
import { imagesCanvas } from "../../plugins/images/src/canvas.js";
export async function canvasesFixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p);
  try {
    await f.p.registry.installBuiltins(f.db);
    const catalog = new StudioCatalog(f.db);
    await f.db.transaction(async (sql) => {
      for (const plugin of [museCanvas, flowCanvas, gpuCanvas, imagesCanvas])
        await catalog.activate(sql, plugin.manifest);
    });
    const password = "canvas-storage-fixture";
    await identity.bootstrap({ name: "admin", nickname: "管理员", password });
    const admin = (await one(
      f.db,
      "SELECT * FROM users WHERE name='admin'",
    )) as OriginalActor;
    await identity.createMember(admin, {
      name: "member",
      nickname: "成员",
      password,
    });
    const member = (await one(
      f.db,
      "SELECT * FROM users WHERE name='member'",
    )) as OriginalActor;
    const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
    await f.db.query(
      "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
      [team.id, member.id],
    );
    const workspace = await identity.activeWorkspace(f.db, admin),
      memberSpace = await identity.activeWorkspace(f.db, member);
    let stamp = 1800000000;
    const canvases = new OriginalCanvases(f.p, () => stamp);
    const connection = await f.p.createConnection(admin, {
      name: "Canvas fixture",
      pluginId: gpuCanvas.manifest.id,
      version: gpuCanvas.manifest.version,
      config: {},
    });
    const model = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1 ORDER BY id LIMIT 1",
      [connection.id],
    );
    return {
      ...f,
      identity,
      catalog,
      admin,
      member,
      workspace,
      memberSpace,
      team,
      canvases,
      setTime(value: number) {
        stamp = value;
      },
      async asset(key: string, kind = "ref", space = workspace, owner = admin) {
        const id = randomUUID();
        await f.db.query(
          "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind) VALUES($1,$2,$3,$4,$5,$6,0,'ready',$7)",
          [
            id,
            key,
            space.id,
            owner.id,
            "fixture/" + id,
            kind === "video"
              ? "video/mp4"
              : kind === "audio"
                ? "audio/wav"
                : "image/png",
            kind,
          ],
        );
        return one(f.db, "SELECT * FROM assets WHERE id=$1", [id]);
      },
      async job(
        publicId: number,
        kind: string,
        state = "completed",
        asset?: string,
        space = workspace,
        owner = admin,
      ) {
        const id = randomUUID();
        await f.db.query(
          `INSERT INTO jobs(id,public_id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,result)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'fixture',$10,'{}',$11,'fixture',1,$12,$13)`,
          [
            id,
            publicId,
            space.id,
            owner.id,
            model.id,
            connection.id,
            gpuCanvas.manifest.id,
            gpuCanvas.manifest.version,
            f.p.vault.seal({}),
            kind,
            randomUUID(),
            state,
            asset ? JSON.stringify({ assets: [asset] }) : null,
          ],
        );
        if (asset)
          await f.db.query(
            "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
            [id, asset],
          );
        return one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]);
      },
      async link(
        project: string,
        node: string,
        job: number,
        inputs = "{}",
        owner = admin,
      ) {
        const p = await one(
            f.db,
            "SELECT id FROM documents WHERE public_id=$1",
            [project],
          ),
          j = await one(f.db, "SELECT id FROM jobs WHERE public_id=$1", [job]);
        return one(
          f.db,
          "INSERT INTO canvas_job_links(project_id,node,job_id,owner_id,uid,inputs,created) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            p.id,
            node,
            j.id,
            owner.id,
            randomUUID(),
            Buffer.from(inputs),
            stamp,
          ],
        );
      },
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
