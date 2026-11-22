import { PluginMedia } from "./plugin-media.js";
import { z } from "zod";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
import {
  actionRequestSchema,
  hostOperations,
  memberScopes,
  packageContributions,
  pageGroups,
  pageTabKey,
  programActionOutputSchema,
  settingsScopes,
  viewSchema,
  type ActionRequest,
  type ActionResult,
  type PageAction,
  type PluginPageEntry,
  type ResolvedContributions,
  type ResolvedPage,
  type SettingsScope,
  type SettingsValue,
  type ViewButton,
} from "@fumiao/plugin-sdk/contributions.js";
import { one, type Sql } from "./db.js";
import { OriginalNodes } from "./node-management.js";
import { Platform } from "./platform.js";
import { PluginHost, type HttpTransport } from "./plugin-host.js";
import { loadProgram, runProgram } from "./plugin-program.js";
import { PluginSettingsStore } from "./plugin-settings.js";
import { DomainError, requireValue } from "./security.js";

// Project just the contribution fields. A release can also contain large native modules and installers.
const releaseQuery = `SELECT p.id,p.version,p.enabled,p.removing,r.package->>'label' AS label,
  r.package->>'adapterVersion' AS "adapterVersion",r.package->'settingsPage' AS "settingsPage",
  r.package->'contributes' AS contributes FROM studio_packages p
  JOIN studio_package_releases r USING(id,version) WHERE p.installed`;
type Release = Parameters<typeof packageContributions>[0] & {
  id: string;
  version: string;
  enabled: boolean;
  removing: boolean;
  label: string;
  adapterVersion: string;
};
type Context = {
  release: Release;
  page: ResolvedPage;
  contributions: ResolvedContributions;
  actor: OriginalActor;
  workspace: string;
};
type PageInput = {
  plugin?: {
    id: string;
    label: string;
    version: string;
    enabled: boolean;
    removing: boolean;
    pending: number;
  };
  models?: Record<string, unknown>[];
  services?: Record<string, unknown>[];
  jobs?: Record<string, unknown>[];
  settings?: Record<SettingsScope, SettingsValue | null>;
  nodes?: { nodes: Record<string, unknown>[]; nodeModels: unknown };
};
type Audit = {
  plugin: string;
  page: string;
  action: string;
  actor: string;
  workspace: string | null;
  version: string | null;
  kind?: PageAction["kind"];
  target: string | null;
  /** Host functions a program action called, e.g. `data.put×1`. */
  calls?: string;
};

function visible(release: Release, page: ResolvedPage) {
  return page.visibleWhen === "installed" || release.enabled;
}

async function invoke(
  source: string,
  hook: "action" | "view",
  args: unknown[],
  host?: PluginHost,
) {
  try {
    return host
      ? await runProgram(source, hook, args, host.granted, host.call)
      : (await loadProgram(source))(hook, ...args);
  } catch (error) {
    // A limit the host enforced is the administrator's to see; what went
    // wrong inside the program is not.
    const limit =
      host?.limit ??
      (error instanceof DomainError && error.status === 408
        ? error
        : undefined);
    if (limit) throw new DomainError(422, limit.message);
    throw new DomainError(
      422,
      hook === "view" ? "插件设置页输出无效" : "插件操作程序执行失败",
    );
  }
}

function validateView(output: unknown, page: ResolvedPage) {
  const result = viewSchema.safeParse(output);
  requireValue(result.success, 422, "插件设置页输出无效");
  const { primary, blocks } = result.data;
  const declared = (id: string) => page.actions.some((a) => a.id === id);
  const button = (b: ViewButton) =>
    (b.opensForm
      ? blocks.some(
          (f) =>
            f.type === "form" &&
            f.id === b.opensForm &&
            f.presentation === "dialog",
        )
      : declared(b.action)) &&
    (!b.payload || Buffer.byteLength(JSON.stringify(b.payload)) <= 4096);
  requireValue(
    (!primary || button(primary)) &&
      blocks.every((block) => {
        if (block.type === "form") return declared(block.submit.action);
        if (block.type === "list")
          return block.rows.every((row) => row.actions.every(button));
        return true;
      }),
    422,
    "插件设置页输出无效",
  );
  return result.data;
}

const pairPayload = z
  .object({
    name: z.string().max(45),
    models: z.array(z.string()).min(1).max(20),
  })
  .strict();

export class PluginPages {
  private readonly settings = new PluginSettingsStore();
  constructor(
    private readonly p: Platform,
    private readonly http?: HttpTransport,
  ) {}

  private pluginHost(
    sql: Sql,
    ctx: Context,
    mode: "read" | "write",
    session = new PluginMedia(this.p.storage),
  ) {
    return new PluginHost(
      sql,
      {
        pluginId: ctx.release.id,
        workspace: ctx.workspace,
        contributions: ctx.contributions,
        mode,
        scopes: ctx.page.audience === "member" ? ["workspace"] : settingsScopes,
      },
      this.http,
      { session, actor: ctx.actor.id },
    );
  }

  async list(sql: Sql, actor: OriginalActor): Promise<PluginPageEntry[]> {
    const { rows } = await sql.query<Release>(releaseQuery);
    const entries: PluginPageEntry[] = [];
    for (const pkg of rows) {
      for (const page of packageContributions(pkg).settingsPages) {
        if (
          !visible(pkg, page) ||
          (page.audience === "admin" && actor.role !== "admin")
        )
          continue;
        entries.push({
          key: pageTabKey(pkg.id, page.id),
          plugin: pkg.id,
          page: page.id,
          title: page.title,
          icon: page.icon,
          group: page.group,
          order: page.order,
          audience: page.audience,
          legacy: !!page.legacy,
          version: pkg.version,
        });
      }
    }
    return entries.sort(
      (a, b) =>
        pageGroups.indexOf(a.group) - pageGroups.indexOf(b.group) ||
        a.order - b.order ||
        a.title.localeCompare(b.title, "zh-CN") ||
        a.key.localeCompare(b.key),
    );
  }

  private async context(
    sql: Sql,
    actor: OriginalActor,
    selected: string | undefined,
    plugin: string,
    pageId: string,
    audit?: Audit,
  ): Promise<Context> {
    // The installation row also serializes first writes (revision 0) and release changes.
    const [release] = (
      await sql.query<Release>(
        releaseQuery + " AND p.id=$1" + (audit ? " FOR UPDATE OF p" : ""),
        [plugin],
      )
    ).rows;
    if (audit && release) audit.version = release.version;
    const contributions = release && packageContributions(release);
    const page = contributions?.settingsPages.find((p) => p.id === pageId);
    if (audit)
      audit.kind = page?.actions.find((a) => a.id === audit.action)?.kind;
    // An upload can outlast a role change. Use the live actor for this operation.
    const {
      rows: [current],
    } = await sql.query<OriginalActor>(
      "SELECT * FROM users WHERE id=$1 AND active AND deleted_at IS NULL" +
        (audit ? " FOR SHARE" : ""),
      [actor.id],
    );
    requireValue(current, 401, "请先登录");
    const workspace = await new OriginalIdentity(this.p).activeWorkspace(
      sql,
      current,
      selected,
    );
    requireValue(workspace, 403, "无法访问这个工作区");
    if (audit) audit.workspace = workspace.id;
    requireValue(
      release && contributions && page && visible(release, page),
      404,
      "未安装此设置页",
    );
    if (page.audience === "admin") this.p.admin(current);
    else
      requireValue(
        page.scopes.every((s) => memberScopes.includes(s)),
        403,
        "成员设置页读取范围无效",
      );
    return {
      release,
      page,
      contributions,
      actor: current,
      workspace: workspace.id,
    };
  }

  private async nodes(sql: Sql, ctx: Context) {
    requireValue(
      ctx.contributions.hostCapabilities.includes("nodes"),
      403,
      "插件未声明节点能力",
    );
    const plugin = await this.p.registry.resolve(
      sql,
      ctx.release.id,
      ctx.release.adapterVersion,
    );
    const nodeModels =
      plugin.originalState?.configuration({
        stamp: Date.now() / 1000,
        catalog: {},
        imageEnabled: true,
      }).gpu_models ??
      Object.fromEntries(
        plugin.manifest.models.map((m) => [m.id, { label: m.label }]),
      );
    const { rows } = await sql.query(
      `SELECT n.public_id::float8 AS id,n.name,n.control,n.detail,n.models,
      CASE WHEN n.last_seen < now()-interval '75 seconds' THEN 'offline' ELSE coalesce(n.queue_state->>'stage','preparing') END AS stage,
      floor(extract(epoch FROM n.last_seen))::float8 AS lastseen,coalesce(n.queue_state->'ready_models','[]') AS ready_models,
      jsonb_strip_nulls(jsonb_build_object('gpu_name',n.timing_context#>'{profile,gpu_name}','vram_gib',n.timing_context#>'{profile,vram_gib}')) AS profile
      FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id WHERE c.plugin_id=$1
      AND NOT c.fmworker_resource_driver AND n.control!='removed'
      AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id) ORDER BY n.public_id DESC`,
      [ctx.release.id],
    );
    return { nodes: rows, nodeModels };
  }

  private async input(sql: Sql, ctx: Context) {
    const { release: pkg, workspace, page, actor } = ctx;
    const input: PageInput = {};
    // Member pages are workspace- and owner-scoped, including their pending count.
    const member = page.audience === "member";
    const filter = member ? " AND j.workspace_id=$2 AND j.owner_id=$3" : "";
    const params = member ? [pkg.id, workspace, actor.id] : [pkg.id];
    if (page.scopes.includes("plugin")) {
      const { pending } = await one(
        sql,
        `SELECT count(*)::int AS pending FROM jobs j WHERE j.plugin_id=$1
        AND j.state NOT IN ('completed','failed','cancelled')` + filter,
        params,
      );
      input.plugin = {
        id: pkg.id,
        label: pkg.label,
        version: pkg.version,
        enabled: pkg.enabled,
        removing: pkg.removing,
        pending,
      };
    }
    if (page.scopes.includes("models"))
      input.models = (
        await sql.query(
          `SELECT c.id,coalesce(c.display_label,c.descriptor->>'label') AS label,
        c.descriptor->>'kind' AS kind,studio_plugin_accepts($1) AND studio_model_allowed(c.id,$2) AS enabled
        FROM studio_catalog c WHERE NOT c.hidden AND (c.plugin_id=$1 OR EXISTS (
          SELECT 1 FROM studio_shared_models s WHERE s.model_id=c.id AND s.plugin_id=$1))
        ORDER BY c.position,c.id`,
          [pkg.id, workspace],
        )
      ).rows;
    if (page.scopes.includes("services"))
      input.services = (
        await sql.query(
          `SELECT id,name,enabled FROM connections
        WHERE plugin_id=$1 AND NOT removed AND NOT fmworker_resource_driver ORDER BY name,id`,
          [pkg.id],
        )
      ).rows;
    if (page.scopes.includes("jobs")) {
      const jobs = (
        await sql.query(
          `SELECT j.public_id::float8 AS id,
        CASE WHEN j.state='completed' THEN 'done' WHEN j.state IN ('dispatching','finalizing','uncertain') THEN 'running' ELSE j.state END AS status,
        j.provider_model AS model,n.public_id::float8 AS node,j.created_at AS "createdAt"
        FROM jobs j LEFT JOIN gpu_nodes n ON n.id::text=j.remote_id
        WHERE j.plugin_id=$1 AND j.deleted_at IS NULL` +
            filter +
            (page.legacy ? " AND j.workspace_id=$2" : "") +
            " ORDER BY j.created_at DESC,j.public_id DESC" +
            (page.legacy ? "" : " LIMIT 100"),
          page.legacy ? [pkg.id, workspace] : params,
        )
      ).rows;
      input.jobs = page.legacy
        ? jobs.map(({ id, status, node }) => ({ id, status, node }))
        : jobs;
    }
    if (page.scopes.includes("settings")) {
      const values: NonNullable<PageInput["settings"]> = {
        global: null,
        workspace: null,
      };
      for (const scope of settingsScopes)
        values[scope] = await this.settings.read(
          sql,
          {
            pluginId: pkg.id,
            scope,
            workspaceId: scope === "global" ? null : workspace,
          },
          ctx.contributions.settings,
        );
      input.settings = values;
    }
    if (page.scopes.includes("nodes")) input.nodes = await this.nodes(sql, ctx);
    return input;
  }

  async view(
    actor: OriginalActor,
    selected: string | undefined,
    plugin: string,
    page: string,
  ) {
    let mediaAudit: Audit | undefined;
    let result;
    try {
      result = await this.p.db.transaction(async (sql) => {
        await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const ctx = await this.context(sql, actor, selected, plugin, page);
        const input = await this.input(sql, ctx);
        if (ctx.page.legacy)
          return invoke("({view:" + ctx.page.program + "\n})", "view", [
            {
              enabled: ctx.release.enabled,
              pending: input.plugin!.pending,
              nodes: input.nodes!.nodes,
              models: input.nodes!.nodeModels,
              jobs: input.jobs,
            },
          ]);
        const host = this.pluginHost(sql, ctx, "read");
        try {
          return validateView(
            await invoke(ctx.page.program, "view", [input], host),
            ctx.page,
          );
        } finally {
          if (host.used["media.probe"]) {
            mediaAudit = {
              plugin,
              page,
              action: "view",
              kind: "program",
              actor: ctx.actor.id,
              workspace: ctx.workspace,
              version: ctx.release.version,
              target: null,
              calls: host.summary(),
            };
          }
        }
      });
    } catch (error) {
      if (mediaAudit)
        await this.audit(this.p.db, mediaAudit, "failed", mediaAudit.calls!);
      throw error;
    }
    if (mediaAudit)
      await this.audit(this.p.db, mediaAudit, "succeeded", mediaAudit.calls!);
    return result;
  }

  private async host(
    sql: Sql,
    ctx: Context,
    operation: keyof typeof hostOperations,
    request: ActionRequest,
  ): Promise<ActionResult> {
    requireValue(
      ctx.contributions.hostCapabilities.includes(hostOperations[operation]),
      403,
      "插件未声明节点能力",
    );
    const { id } = ctx.release;
    // Keep the node change and its page action audit in the same transaction.
    const scoped = new Platform(
      {
        query: sql.query.bind(sql),
        transaction: (fn) => fn(sql),
        close: async () => {},
      },
      this.p.vault,
      this.p.registry,
      this.p.storage,
    );
    const nodes = new OriginalNodes(scoped, id);
    if (operation === "nodes.suggestName" || operation === "nodes.pair")
      requireValue(request.target === undefined, 400, "此操作不接受节点标识");
    if (operation === "nodes.suggestName")
      return { value: (await nodes.suggestedName()).name, refresh: false };
    if (operation === "nodes.pair") {
      const parsed = pairPayload.safeParse(request.payload);
      requireValue(parsed.success, 400, "节点配对参数无效");
      const pair = await nodes.pair(ctx.actor, parsed.data);
      return {
        result: {
          title: "接入命令 · " + pair.name,
          label: "接入命令",
          value: pair.command,
        },
        refresh: true,
      };
    }
    const target = Number(request.target);
    requireValue(
      /^\d+$/.test(String(request.target)) &&
        Number.isSafeInteger(target) &&
        target > 0,
      400,
      "节点标识必须是正整数",
    );
    requireValue(
      await one(
        sql,
        `SELECT n.id FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id
      WHERE c.plugin_id=$1 AND n.public_id=$2 FOR UPDATE OF n`,
        [id, target],
      ),
      404,
      "实例不存在",
    );
    await nodes.manage(ctx.actor, target, operation.slice("nodes.".length));
    return { refresh: true };
  }

  private async execute(
    sql: Sql,
    ctx: Context,
    action: PageAction,
    request: ActionRequest,
    audit: Audit,
    media: PluginMedia,
  ): Promise<ActionResult> {
    const write = async (
      scope: SettingsScope,
      values: Record<string, unknown>,
      revision: number | undefined,
    ) => {
      requireValue(revision !== undefined, 400, "请提供插件设置修订号");
      const saved = await this.settings.write(sql, {
        pluginId: ctx.release.id,
        scope,
        workspaceId: scope === "global" ? null : ctx.workspace,
        declaration: ctx.contributions.settings,
        packageVersion: ctx.release.version,
        actorId: ctx.actor.id,
        values,
        revision,
      });
      requireValue(
        Buffer.byteLength(JSON.stringify(saved.values)) <= 64 * 1024,
        400,
        "插件设置超过 64 KB",
      );
    };
    switch (action.kind) {
      case "host":
        return this.host(sql, ctx, action.operation, request);
      case "settings":
        await write(action.scope, request.payload, request.revision);
        return { refresh: true };
      case "program": {
        const input = await this.input(sql, ctx);
        const host = this.pluginHost(sql, ctx, "write", media);
        let result;
        try {
          result = await invoke(
            ctx.page.program,
            "action",
            [action.id, request.payload, input],
            host,
          );
        } finally {
          audit.calls = host.summary() || undefined;
        }
        const output = programActionOutputSchema.safeParse(result);
        requireValue(output.success, 422, "插件操作输出无效");
        for (const scope of settingsScopes) {
          const values = output.data.settings?.[scope];
          // A button can compute a change from the very snapshot supplied to
          // action(). A submitted form revision always takes precedence.
          if (values)
            await write(
              scope,
              values,
              request.revision ?? input.settings?.[scope]?.revision,
            );
        }
        return { notice: output.data.notice, refresh: true };
      }
    }
  }

  async action(
    actor: OriginalActor,
    selected: string | undefined,
    plugin: string,
    page: string,
    action: string,
    body: unknown,
  ) {
    const parsed = actionRequestSchema.safeParse(body);
    const audit: Audit = {
      plugin,
      page,
      action,
      actor: actor.id,
      workspace: null,
      version: null,
      target:
        parsed.success && parsed.data.target !== undefined
          ? String(parsed.data.target)
          : null,
    };
    const media = new PluginMedia(this.p.storage);
    try {
      return await this.p.db.transaction(async (sql) => {
        const ctx = await this.context(
          sql,
          actor,
          selected,
          plugin,
          page,
          audit,
        );
        this.p.admin(ctx.actor);
        requireValue(
          ctx.page.audience === "admin",
          403,
          "成员设置页暂不支持操作",
        );
        const declaration = ctx.page.actions.find((a) => a.id === action);
        requireValue(declaration, 404, "插件未声明此操作");
        if (body instanceof DomainError) throw body;
        requireValue(parsed.success, 400, "插件操作请求无效");
        const result = await this.execute(
          sql,
          ctx,
          declaration,
          parsed.data,
          audit,
          media,
        );
        await this.audit(sql, audit, "succeeded", audit.calls ?? null);
        return result;
      });
    } catch (error) {
      await media.rollback();
      const failure =
        error instanceof DomainError
          ? error
          : new DomainError(500, "插件操作执行失败");
      await this.audit(
        this.p.db,
        audit,
        failure.status < 500 && failure.status !== 422 ? "rejected" : "failed",
        [failure.message, audit.calls].filter(Boolean).join(" · "),
      );
      throw failure;
    }
  }

  private async audit(
    sql: Sql,
    a: Audit,
    outcome: string,
    detail: string | null,
  ) {
    // kind / package_version stay NULL when the URL does not resolve to a declared
    // action of an installed release. Never store payloads or pairing commands.
    await sql.query(
      `INSERT INTO studio_plugin_audit(plugin_id,package_version,page_id,action_id,kind,actor_id,workspace_id,target,outcome,detail)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        a.plugin,
        a.version,
        a.page,
        a.action,
        a.kind ?? null,
        a.actor,
        a.workspace,
        a.target,
        outcome,
        detail,
      ].map((v) => (typeof v === "string" ? v.replaceAll("\0", "�") : v)),
    );
  }
}
