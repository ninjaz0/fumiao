import { timingSafeEqual } from "node:crypto";
import { one, type Sql } from "../../platform/src/db.js";
import { executableJob } from "../../platform/src/retired-jobs.js";
import { Executor } from "../../platform/src/executor.js";
import { GpuGateway } from "../../platform/src/gpu.js";
import type { Platform } from "../../platform/src/platform.js";
import { hash, requireValue } from "../../platform/src/security.js";
import { JobTiming } from "../../platform/src/timing.js";
import type { OriginalActor } from "./identity.js";

const numbered = /^弗淼([0-9]{1,9})$(?![\s\S])/u;
const defaultName = (n: number) => "弗淼" + String(n).padStart(3, "0");
export const defaultPairModels = ["MiniMax H3"];
const controls = new Map([
  ["drain", "draining"],
  ["resume", "active"],
  ["stop", "paused"],
  ["remove", "removed"],
]);

function shellQuote(value: string) {
  return /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

async function nextNumber(sql: Sql) {
  const row = await one(
    sql,
    `SELECT GREATEST(node_name_sequence, (
      SELECT max(substring(label FROM 3)::bigint) FROM (
        SELECT label FROM gpu_pairings UNION ALL SELECT name FROM gpu_nodes
        UNION ALL SELECT label FROM original_node_names
      ) names WHERE label ~ '^弗淼[0-9]{1,9}$'
    )) + 1 AS number FROM original_state_settings`,
  );
  return Number(row.number);
}

export class BoundNodeCredential extends Error {}

export class OriginalNodes {
  private gpu: GpuGateway;
  constructor(private p: Platform) {
    this.gpu = new GpuGateway(p);
  }

  async suggestedName() {
    return { name: defaultName(await nextNumber(this.p.db)) };
  }

  async pair(actor: OriginalActor, input: { name: string; models: string[] }) {
    return this.p.db.transaction(async (sql) => {
      const candidates = (
        await sql.query(
          `SELECT v.id,v.version FROM plugin_versions v
          WHERE v.manifest->>'mode'='pull' AND v.manifest->'originalState'->'fields' ? 'gpu_models'
          AND EXISTS (SELECT 1 FROM studio_catalog s WHERE s.plugin_id=v.id AND s.plugin_version=v.version)`,
        )
      ).rows;
      requireValue(candidates.length === 1, 503, "GPU 接入暂不可用");
      const version = candidates[0];
      requireValue(
        this.p.registry.pairedAgent(version.id),
        503,
        "GPU 接入暂不可用",
      );
      const plugin = await this.p.registry.resolve(
        sql,
        version.id,
        version.version,
      );
      requireValue(plugin.originalState, 503, "GPU 接入暂不可用");
      const advertised = plugin.originalState.configuration({
        stamp: Date.now() / 1000,
        catalog: {},
        imageEnabled: true,
      }).gpu_models as Record<string, { slug?: string }> | undefined;
      const models = [...new Set(input.models)];
      const slugs = models.map((id) => {
        requireValue(
          plugin.manifest.models.some((model) => model.id === id),
          400,
          "请选择至少一个支持的模型",
        );
        const slug = advertised?.[id]?.slug;
        requireValue(
          typeof slug === "string" && /^[a-z0-9-]+$(?![\s\S])/.test(slug),
          503,
          "GPU 接入暂不可用",
        );
        return slug;
      });
      requireValue(models.length > 0, 400, "请选择至少一个支持的模型");
      const connections = (
        await sql.query(
          "SELECT id FROM connections WHERE plugin_id=$1 AND plugin_version=$2 AND NOT fmworker_resource_driver FOR SHARE",
          [version.id, version.version],
        )
      ).rows;
      requireValue(connections.length === 1, 503, "GPU 接入暂不可用");
      const owner = await one(
        sql,
        "SELECT id FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR SHARE",
        [actor.id],
      );
      requireValue(owner, 401, "请先登录");
      // Serialize allocation across members. A preview never reserves a name.
      await sql.query(
        "SELECT node_name_sequence FROM original_state_settings FOR UPDATE",
      );
      const number = await nextNumber(sql);
      const name =
        input.name.replace(
          /^[\p{White_Space}\x1c-\x1f]+|[\p{White_Space}\x1c-\x1f]+$/gu,
          "",
        ) || defaultName(number);
      const explicit = numbered.exec(name);
      if (explicit) {
        const taken = await one(
          sql,
          "SELECT label FROM gpu_pairings WHERE label=$1 UNION ALL SELECT name FROM gpu_nodes WHERE name=$1 UNION ALL SELECT label FROM original_node_names WHERE label=$1 LIMIT 1",
          [name],
        );
        requireValue(!taken, 409, "实例名称已使用，请更换名称");
        await sql.query(
          "UPDATE original_state_settings SET node_name_sequence=$1",
          [Math.max(number - 1, Number(explicit[1]))],
        );
      }
      const { code, expires } = await this.gpu.createPairing(
        sql,
        owner.id,
        connections[0].id,
        {
          label: name,
          models,
        },
      );
      const site = (process.env.PUBLIC_URL || "http://localhost:3000").replace(
        /\/+$/,
        "",
      );
      return {
        command: `curl -fsSL ${shellQuote(site + "/connect/install.sh")} -o /tmp/fumiao-install.sh && FUMIAO_SITE=${shellQuote(site)} bash /tmp/fumiao-install.sh --models=${slugs.join(",")} ${code}`,
        expires,
        name,
        models,
      };
    });
  }

  async enroll(input: { code: string; secret: string }) {
    const digest = hash(input.code);
    const nodeDigest = hash(input.secret);
    return this.p.db.transaction(async (sql) => {
      // Member removal locks the owner before revoking pairings and nodes.
      const owner = await one(
        sql,
        `SELECT u.id FROM gpu_pairings p JOIN users u ON u.id=p.owner_id
          JOIN connections c ON c.id=p.connection_id
          WHERE NOT c.fmworker_resource_driver AND p.token=$1 AND p.label IS NOT NULL AND u.active AND u.deleted_at IS NULL
          FOR SHARE OF u`,
        [digest],
      );
      requireValue(owner, 403, "配对码已过期或无效");
      const pair = await one(
        sql,
        "SELECT * FROM gpu_pairings WHERE token=$1 FOR UPDATE",
        [digest],
      );
      requireValue(pair, 403, "配对码已过期或无效");
      if (pair.claimed) {
        const node = await one(
          sql,
          `SELECT token_hash,enabled FROM gpu_nodes n WHERE id=$1 AND NOT n.archived
            AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id) FOR SHARE OF n`,
          [pair.claimed_node_id],
        );
        requireValue(
          node &&
            timingSafeEqual(
              Buffer.from(node.token_hash, "hex"),
              Buffer.from(nodeDigest, "hex"),
            ),
          403,
          "配对码已使用",
        );
        requireValue(node.enabled, 403, "实例接入已撤销，请获取新的接入命令");
      } else {
        // A client credential can race across two different invitations.
        // Check before INSERT so a rejected attempt leaves public IDs intact.
        await sql.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["gpu-node:" + nodeDigest],
        );
        const stamp = await one(sql, "SELECT clock_timestamp() AS now");
        requireValue(pair.expires_at > stamp.now, 403, "配对码已过期或无效");
        if (
          await one(sql, "SELECT 1 FROM gpu_nodes WHERE token_hash=$1", [
            nodeDigest,
          ])
        )
          throw new BoundNodeCredential();
        const node = await this.gpu.addNode(
          sql,
          pair.connection_id,
          pair.owner_id,
          pair.label,
          pair.models,
          nodeDigest,
        );
        await sql.query(
          "UPDATE gpu_pairings SET claimed=true,claimed_node_id=$2 WHERE token=$1",
          [digest, node],
        );
      }
      return { ok: true, models: pair.models };
    });
  }

  async registration(authorization: string) {
    requireValue(authorization.startsWith("Bearer "), 401, "缺少实例凭据");
    const node = await one(
      this.p.db,
      `SELECT n.public_id,n.models,n.control,p.token AS paired_code_hash
        FROM gpu_nodes n JOIN gpu_pairings p ON p.claimed_node_id=n.id
        JOIN connections c ON c.id=n.connection_id
        WHERE n.token_hash=$1 AND n.enabled AND NOT n.archived AND n.control!='removed'
          AND NOT c.fmworker_resource_driver
          AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)`,
      [hash(authorization.slice(7))],
    );
    requireValue(node, 403, "实例凭据已撤销");
    return {
      id: Number(node.public_id),
      models: node.models,
      paired_code_hash: node.paired_code_hash,
      control: node.control,
    };
  }

  async manage(actor: OriginalActor, id: number, action: string) {
    this.p.admin(actor);
    const control = controls.get(action);
    requireValue(control, 400, "未知操作");
    return this.p.db.transaction(async (sql) => {
      const node = await one(
        sql,
        `UPDATE gpu_nodes n SET control=$2,enabled=n.enabled AND $2!='removed'
          FROM connections c WHERE c.id=n.connection_id AND NOT c.fmworker_resource_driver
          AND public_id=$1 AND control!='removed'
          AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id) RETURNING n.id`,
        [id, control],
      );
      requireValue(node, 404, "实例不存在");
      if (action === "stop" || action === "remove")
        await this.interrupt(sql, [node.id], "管理员已断开实例");
      await new Executor(this.p).recoverOn(sql, true);
      if (action === "drain")
        await sql.query(
          `UPDATE gpu_nodes SET control='paused' WHERE id=$1 AND control='draining'
            AND NOT EXISTS (SELECT 1 FROM jobs j WHERE remote_id=gpu_nodes.id::text AND state IN ('dispatching','running','finalizing','uncertain') AND ${executableJob})`,
          [node.id],
        );
      return { ok: true };
    });
  }

  async removeOwned(sql: Sql, owner: string) {
    await sql.query(
      "UPDATE gpu_pairings SET expires_at=to_timestamp(0) WHERE owner_id=$1",
      [owner],
    );
    const { rows } = await sql.query<{ id: string }>(
      `SELECT n.id FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id
      WHERE n.owner_id=$1 AND NOT c.fmworker_resource_driver
      AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id) ORDER BY n.id FOR UPDATE OF n`,
      [owner],
    );
    if (!rows.length) return;
    const ids = rows.map(({ id }) => id);
    await this.interrupt(sql, ids, "接入成员已移除，等待其他实例");
    await sql.query(
      `UPDATE gpu_nodes SET control='removed',enabled=false,
        queue_state=jsonb_set(queue_state,'{stage}','"offline"')
        WHERE id=ANY($1::uuid[])`,
      [ids],
    );
  }

  private async interrupt(sql: Sql, nodes: string[], note: string) {
    const { rows: jobs } = await sql.query(
      `SELECT j.* FROM jobs j WHERE remote_id=ANY($1::text[]) AND state='running'
       AND ${executableJob} ORDER BY workspace_id,id FOR UPDATE OF j`,
      [nodes],
    );
    const timing = new JobTiming(this.p);
    const stamp = Math.floor(Date.now() / 1000);
    for (const job of jobs) {
      requireValue(job.attempts !== null, 503, "任务执行次数尚未完成迁移");
      await timing.end(sql, job, "interrupted", stamp);
      if (job.attempts >= 2)
        await this.p.settle(
          sql,
          job,
          "failed",
          undefined,
          note,
          undefined,
          { preserveTiming: true },
        );
      await sql.query(
        `UPDATE jobs SET state=CASE WHEN state='running' THEN 'queued' ELSE state END,
          remote_id=NULL,original_node=NULL,original_gpu_ticket=NULL,lease_token=NULL,
          lease_until=NULL,request_note=NULL,error=$2,updated_at=now()
          WHERE id=$1`,
        [job.id, note],
      );
    }
  }
}
