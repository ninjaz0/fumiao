import {
  importRequestSchema,
  importerSchema,
  parseImportPlan,
  type ImporterEntry,
  type ImportResult,
} from "@fumiao/plugin-sdk/importers.js";
import { packageContributions } from "@fumiao/plugin-sdk/contributions.js";
import type { Platform, Actor } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import {
  PluginHost,
  type HttpTransport,
} from "@fumiao/platform/plugin-host.js";
import { runProgram } from "@fumiao/platform/plugin-program.js";
import {
  prepareImportFiles,
  storeImportFiles,
} from "@fumiao/platform/plugin-import-files.js";
import { hash, DomainError, requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalCanvases } from "./canvases.js";

const available = `FROM studio_packages p JOIN studio_package_releases r USING(id,version)
 WHERE p.installed AND p.enabled AND NOT p.removing AND r.package->'contributes' ? 'importers'`;
export async function importersFor(
  sql: Sql,
  actor: Actor,
): Promise<ImporterEntry[]> {
  const { rows } = await sql.query(
    "SELECT p.id,p.version,r.package->'contributes'->'importers' AS items " +
      available +
      " ORDER BY p.id",
  );
  return rows.flatMap((row) =>
    importerSchema
      .array()
      .parse(row.items)
      .filter((d) => d.audience === "member" || actor.role === "admin")
      .map(({ program, ...item }) => ({
        ...item,
        plugin: row.id,
        version: row.version,
      })),
  );
}
async function definition(
  sql: Sql,
  plugin: string,
  id: string,
  version: string,
  role: string,
  lock = false,
) {
  const row = await one(
    sql,
    "SELECT p.version,r.package->'contributes' AS contributes " +
      available +
      " AND p.id=$1" +
      (lock ? " FOR SHARE OF p" : ""),
    [plugin],
  );
  requireValue(row, 404, "导入器未启用");
  requireValue(row.version === version, 409, "插件已更新，请刷新后重试");
  const grants = packageContributions(row);
  const item = grants.importers?.find((d) => d.id === id);
  requireValue(
    item && (item.audience === "member" || role === "admin"),
    403,
    "无权使用此导入器",
  );
  return { item, grants };
}
export class PluginImports {
  constructor(
    readonly p: Platform,
    readonly http?: HttpTransport,
  ) {}
  async run(
    user: Actor,
    selected: string | undefined,
    plugin: string,
    id: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    const parsed = importRequestSchema.safeParse(body);
    requireValue(parsed.success, 400, "导入请求无效");
    const { requestId, version, source } = parsed.data;
    const identity = new OriginalIdentity(this.p),
      space = await identity.activeWorkspace(this.p.db, user, selected);
    const key = [plugin, space.id, user.id, requestId],
      fingerprint = hash(JSON.stringify(["import", version, id, source]));
    const receipt = async (sql: Sql): Promise<ImportResult | undefined> => {
      const row = await one(
        sql,
        "SELECT fingerprint,response FROM studio_action_receipts WHERE plugin_id=$1 AND workspace_id=$2 AND actor_id=$3 AND request_id=$4",
        key,
      );
      requireValue(
        !row || row.fingerprint === fingerprint,
        409,
        "此请求编号已用于其他操作",
      );
      return row?.response;
    };
    const prior = await receipt(this.p.db);
    if (prior) return prior;
    const { item, grants } = await definition(
      this.p.db,
      plugin,
      id,
      version,
      user.role,
    );
    const host = new PluginHost(
      this.p.db,
      {
        pluginId: plugin,
        workspace: space.id,
        contributions: grants,
        mode: "write",
        scopes: ["workspace"],
      },
      this.http,
    );
    const written: string[] = [];
    const audit = (sql: Sql, outcome: string) =>
      sql.query(
        `INSERT INTO studio_plugin_audit(plugin_id,package_version,page_id,action_id,kind,actor_id,workspace_id,outcome,detail)
     VALUES($1,$2,'importers',$3,'program',$4,$5,$6,$7)`,
        [plugin, version, id, user.id, space.id, outcome, host.summary()],
      );
    try {
      signal.throwIfAborted();
      const raw = await runProgram(
        item.program,
        "plan",
        [{ source }],
        host.granted.filter((name) => name === "http.fetch"),
        (name, args, inner) => {
          requireValue(
            ((args[1] as { method?: string } | undefined)?.method ?? "GET") ===
              "GET",
            403,
            "导入器只能读取外部来源",
          );
          return host.call(name, args, AbortSignal.any([signal, inner]));
        },
      );
      const origins = grants.hostCapabilities.includes("http")
        ? (grants.http?.origins ?? [])
        : [];
      const plan = parseImportPlan(item.target, raw, origins);
      const result = await prepareImportFiles(
        plan.assets,
        origins,
        signal,
        this.http,
        async (files) =>
          this.p.db.transaction(async (sql) => {
            const actor = (await one(
              sql,
              "SELECT * FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR SHARE",
              [user.id],
            )) as Actor | undefined;
            requireValue(actor, 401, "请先登录");
            await identity.requireWorkspace(
              sql,
              actor,
              Number(space.public_id),
              true,
            );
            const existing = await receipt(sql);
            if (existing) return existing;
            await definition(sql, plugin, id, version, actor.role, true);
            const assets = await storeImportFiles(
              sql,
              this.p.storage,
              space.id,
              actor.id,
              files,
              written,
              signal,
            );
            const output: ImportResult = { assets };
            if (plan.target === "canvas") {
              const ids = new Map(assets.map((a) => [a.key, a.id]));
              const nodes = plan.canvas.nodes.map(
                ({ image, references, ...node }) => ({
                  ...node,
                  ...(image && { media_id: ids.get(image), use_media: true }),
                  ...(references && {
                    params: { h3_refs: references.map((ref) => ids.get(ref)) },
                  }),
                }),
              );
              output.canvas = await new OriginalCanvases(this.p).importProject(
                sql,
                actor,
                space.id,
                plan.canvas.title,
                {
                  nodes,
                  edges: plan.canvas.edges,
                  shots: plan.canvas.shots ?? null,
                },
              );
            }
            await sql.query(
              "INSERT INTO studio_action_receipts(plugin_id,workspace_id,actor_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6)",
              [...key, fingerprint, JSON.stringify(output)],
            );
            await audit(sql, "succeeded");
            signal.throwIfAborted();
            return output;
          }),
      );
      return result;
    } catch (error) {
      if (written.length) {
        // A lost COMMIT acknowledgement can leave a valid receipt and assets.
        // Only discard objects the database confirms are still unreferenced.
        const { rows } = await this.p.db.query(
          "SELECT object_key FROM assets WHERE object_key=ANY($1::text[])",
          [written],
        );
        const retained = new Set(rows.map((r) => r.object_key));
        await Promise.all(
          written
            .filter((object) => !retained.has(object))
            .map((object) => this.p.storage.remove(object)),
        );
        const committed = await receipt(this.p.db);
        if (committed) return committed;
      }
      await audit(this.p.db, "failed");
      if (error instanceof DomainError) throw error;
      if (["P1001", "P1002"].includes((error as { code?: string }).code ?? ""))
        throw new DomainError(507, "空间不足，请先清理素材或作品");
      throw new DomainError(422, "导入失败，请检查来源内容、素材和画布结构");
    }
  }
}
