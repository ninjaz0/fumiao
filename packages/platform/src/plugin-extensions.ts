import { createHash } from "node:crypto";
import { z } from "zod";
import {
  packageContributions,
  type MenuEntry,
  type ResolvedContributions,
} from "@fumiao/plugin-sdk/contributions.js";
import { one, type Sql } from "./db.js";
import type { Actor, Platform } from "./platform.js";
import { PluginHost } from "./plugin-host.js";
import { PluginMedia } from "./plugin-media.js";
import { runProgram } from "./plugin-program.js";
import { DomainError, requireValue } from "./security.js";

const active = `SELECT p.id,p.version,r.package->'contributes' AS contributes FROM studio_packages p
 JOIN studio_package_releases r USING(id,version) WHERE p.installed AND p.enabled AND NOT p.removing`;
export async function resourceMenus(
  sql: Sql,
  actor: Actor,
): Promise<MenuEntry[]> {
  const { rows } = await sql.query(
    active + " AND r.package->'contributes' ? 'actions' ORDER BY p.id",
  );
  return rows.flatMap((row) =>
    (packageContributions(row).actions ?? [])
      .filter((a) => a.audience === "member" || actor.role === "admin")
      .map(({ id, title, target, audience, fields }) => ({
        id,
        title,
        target,
        audience,
        fields,
        plugin: row.id,
        version: row.version,
      })),
  );
}

const request = z
  .object({
    requestId: z.string().uuid(),
    version: z.string().max(32),
    target: z.union([
      z.string().regex(/^[a-f0-9]{32}$/),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ]),
    values: z.record(z.string().max(32), z.string().max(300)).default({}),
  })
  .strict();
const output = z.object({ notice: z.string().min(1).max(300) }).strict();

function hostFor(
  sql: Sql,
  pluginId: string,
  workspace: string,
  contributions: ResolvedContributions,
  session: PluginMedia,
  actor?: string,
) {
  const grants = actor
    ? contributions
    : {
        ...contributions,
        hostCapabilities: contributions.hostCapabilities.filter(
          (c) => c !== "media",
        ),
      };
  return new PluginHost(
    sql,
    {
      pluginId,
      workspace,
      contributions: grants,
      mode: "write",
      scopes: ["workspace"],
    },
    undefined,
    actor ? { session, actor } : undefined,
  );
}
async function audit(
  sql: Sql,
  plugin: string,
  version: string,
  page: string,
  action: string,
  actor: string | null,
  space: string,
  target: string,
  outcome: string,
  detail: string,
) {
  await sql.query(
    `INSERT INTO studio_plugin_audit(plugin_id,package_version,page_id,action_id,kind,actor_id,workspace_id,target,outcome,detail)
    VALUES($1,$2,$3,$4,'program',$5,$6,$7,$8,$9)`,
    [plugin, version, page, action, actor, space, target, outcome, detail],
  );
}

export async function resourceAction(
  sql: Sql,
  media: PluginMedia,
  actor: Actor,
  workspace: string,
  plugin: string,
  action: string,
  body: unknown,
) {
  const parsed = request.safeParse(body);
  requireValue(parsed.success, 400, "菜单操作请求无效");
  const { version, target, values } = parsed.data;
  const pkg = await one(sql, active + " AND p.id=$1 FOR UPDATE OF p", [plugin]);
  requireValue(pkg, 404, "插件未启用");
  requireValue(pkg.version === version, 409, "插件已更新，请刷新菜单");
  const grants = packageContributions(pkg);
  const decl = grants.actions?.find((a) => a.id === action);
  requireValue(
    decl && (decl.audience === "member" || actor.role === "admin"),
    403,
    "无权执行此菜单操作",
  );
  const fields = decl.fields ?? [];
  requireValue(
    Object.keys(values).every((k) => fields.some((f) => f.name === k)) &&
      fields.every((f) => !f.required || values[f.name]?.trim()),
    400,
    "表单值无效",
  );
  const asset = decl.target === "asset";
  requireValue(
    (asset && typeof target === "string") ||
      (!asset && typeof target === "number"),
    400,
    "目标类型无效",
  );
  const row = await one(
    sql,
    asset
      ? "SELECT public_id AS id,mime,size::float8 AS size FROM assets WHERE public_id=$1 AND workspace_id=$2 AND state='ready' FOR SHARE"
      : "SELECT public_id::float8 AS id,kind,state FROM jobs WHERE public_id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR SHARE",
    [target, workspace],
  );
  requireValue(row, 404, "目标不存在或不在当前工作区");
  const key = [plugin, workspace, actor.id, parsed.data.requestId];
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        version,
        action,
        target,
        fields.map((f) => values[f.name] ?? ""),
      ]),
    )
    .digest("hex");
  const receipt = await one(
    sql,
    "SELECT fingerprint,response FROM studio_action_receipts WHERE plugin_id=$1 AND workspace_id=$2 AND actor_id=$3 AND request_id=$4",
    key,
  );
  if (receipt) {
    requireValue(
      receipt.fingerprint === fingerprint,
      409,
      "此请求编号已用于其他操作",
    );
    return output.parse(receipt.response);
  }
  const host = hostFor(sql, plugin, workspace, grants, media, actor.id);
  await sql.query("SAVEPOINT menu_handler");
  try {
    const result = output.parse(
      await runProgram(
        decl.program,
        "run",
        [{ ...row, requestId: parsed.data.requestId }, values],
        host.granted,
        host.call,
      ),
    );
    await sql.query(
      "INSERT INTO studio_action_receipts(plugin_id,workspace_id,actor_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6)",
      [...key, fingerprint, JSON.stringify(result)],
    );
    await audit(
      sql,
      plugin,
      version,
      "menu",
      action,
      actor.id,
      workspace,
      String(target),
      "succeeded",
      host.summary(),
    );
    return result;
  } catch {
    await sql.query("ROLLBACK TO SAVEPOINT menu_handler");
    await media.rollback();
    await audit(
      sql,
      plugin,
      version,
      "menu",
      action,
      actor.id,
      workspace,
      String(target),
      "failed",
      host.summary(),
    );
    return new DomainError(422, "插件菜单操作执行失败");
  }
}

// Claim and acknowledge in one transaction. SKIP LOCKED allows several workers.
// A savepoint rolls back guest writes before persisting a retry or dead letter.
export async function deliverPluginEvent(p: Platform): Promise<boolean> {
  const media = new PluginMedia(p.storage);
  try {
    return await p.db.transaction(async (sql) => {
      const d = await one(
        sql,
        `SELECT d.*,w.public_id AS space_number FROM studio_event_deliveries d JOIN workspaces w ON w.id=d.workspace_id
        WHERE NOT dead AND available_at<=now() ORDER BY available_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      );
      if (!d) return false;
      const pkg = await one(
        sql,
        active + " AND p.id=$1 AND p.version=$2 FOR UPDATE OF p",
        [d.plugin_id, d.version],
      );
      const grants = pkg && packageContributions(pkg);
      const hook = grants?.events?.find((e) => e.type === d.topic);
      if (
        hook &&
        (await one(
          sql,
          "SELECT 1 FROM studio_event_subscriptions WHERE id=$1",
          [d.subscription],
        ))
      ) {
        const host = hostFor(
          sql,
          d.plugin_id,
          d.workspace_id,
          grants!,
          media,
          d.owner_id,
        );
        await sql.query("SAVEPOINT handler");
        try {
          await sql.query(
            "SELECT set_config('fumiao.event_handler','on',true)",
          );
          await runProgram(
            hook.program,
            "handle",
            [
              {
                id: d.id,
                type: d.topic,
                workspace: Number(d.space_number),
                resource: d.resource,
              },
            ],
            host.granted,
            host.call,
          );
          await audit(
            sql,
            d.plugin_id,
            d.version,
            "events",
            d.topic,
            null,
            d.workspace_id,
            d.id,
            "succeeded",
            host.summary(),
          );
        } catch {
          await sql.query("ROLLBACK TO SAVEPOINT handler");
          await media.rollback();
          await sql.query(
            `UPDATE studio_event_deliveries SET attempts=attempts+1,dead=attempts+1>=5,
            available_at=now()+interval '5 seconds'*(1<<attempts) WHERE id=$1`,
            [d.id],
          );
          await audit(
            sql,
            d.plugin_id,
            d.version,
            "events",
            d.topic,
            null,
            d.workspace_id,
            d.id,
            "failed",
            host.summary(),
          );
          return true;
        }
      }
      await sql.query("DELETE FROM studio_event_deliveries WHERE id=$1", [
        d.id,
      ]);
      return true;
    });
  } catch (error) {
    await media.rollback();
    throw error;
  }
}
