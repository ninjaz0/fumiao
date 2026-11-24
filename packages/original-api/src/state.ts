import { canvasNodeEntries } from "@fumiao/platform/canvas-node-plugins.js";
import { statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import {
  studioPluginProfile,
  pairedPluginAvailable,
  listedStudioCatalog,
} from "@fumiao/platform/studio-plugin-profile.js";
import { importersFor } from "./plugin-importers.js";
import { resourceMenus } from "@fumiao/platform/plugin-extensions.js";
import { PluginPages } from "@fumiao/platform/plugin-pages.js";
import { installedSettingsPages } from "@fumiao/platform/studio-packages.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { QueueForecasts } from "@fumiao/platform/queue-snapshot.js";
import { elapsedDetail, type Run } from "@fumiao/platform/timing-math.js";
import { Executor } from "@fumiao/platform/executor.js";
import {
  stateProviderFieldsSchema,
  stateJobProjectionSchema,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import { OriginalIdentity, avatars, type OriginalActor } from "./identity.js";
import { OriginalCredits } from "./credits.js";
import { OriginalLibrary } from "./library.js";
import { OriginalStateRecords, attachJobResults } from "./state-records.js";
const labels = [
  "山峦",
  "日出",
  "月色",
  "海浪",
  "小岛",
  "森林",
  "新叶",
  "花朵",
  "橘子",
  "行星",
  "彩虹",
  "帆船",
];
const epoch = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);
export class OriginalState {
  constructor(readonly p: Platform) {}
  async read(
    user: OriginalActor,
    selected?: string,
  ): Promise<Record<string, any>> {
    for (let attempt = 0; ; attempt++)
      try {
        return await this.p.db.transaction(async (sql) => {
          await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
          const current = await one(
            sql,
            "SELECT * FROM users WHERE id=$1 AND active AND deleted_at IS NULL",
            [user.id],
          );
          requireValue(current, 401, "请先登录");
          const actor: OriginalActor = {
              ...(current as OriginalActor),
              ...(user.tokenId
                ? {
                    tokenId: user.tokenId,
                    tokenWorkspaceId: user.tokenWorkspaceId,
                    tokenWorkspacePublicId: user.tokenWorkspacePublicId,
                    tokenScopes: user.tokenScopes,
                  }
                : {}),
              ...(user.agentAction ? { agentAction: user.agentAction } : {}),
            },
            isToken = Boolean(actor.tokenId),
            tokenScopes = new Set(actor.tokenScopes ?? []),
            isBrowserAdmin = !isToken && actor.role === "admin",
            identity = new OriginalIdentity(this.p),
            catalog = new StudioCatalog(this.p.db),
            records = new OriginalStateRecords(),
            credits = new OriginalCredits(this.p);
          const workspace = await identity.activeWorkspace(
            sql,
            actor,
            selected,
          );
          requireValue(workspace, 403, "无法访问这个工作区");
          const settings = await one(
            sql,
            "SELECT s.*,w.public_id FROM original_state_settings s LEFT JOIN workspaces w ON w.id=s.legacy_workspace_id",
          );
          requireValue(settings?.public_id, 503, "原默认工作区尚未完成迁移");
          await new Executor(this.p).recoverOn(sql, true);
          const forecast = await new QueueForecasts(this.p).read(
              sql,
              workspace.id,
              { imageEnabled: settings.image_enabled },
            ),
            stamp = forecast.serverTime;
          const models = await catalog.catalog(sql),
            plugins = await this.providers(
              sql,
              models,
              stamp,
              settings.image_enabled,
            );
          const listedPolicy = (policy: { revision: number; enabled: Record<string, boolean> }) => ({
            revision: policy.revision,
            enabled: Object.fromEntries(Object.entries(policy.enabled).filter(([id]) => Object.hasOwn(models, id))),
          });
          const nodePage = isBrowserAdmin ? await one(sql,`SELECT p.id,p.version,p.enabled,(SELECT count(*)::int FROM jobs j WHERE j.plugin_id=p.id AND j.state NOT IN ('completed','failed','cancelled')) AS pending,r.package->'settingsPage'->>'title' AS title FROM studio_packages p JOIN studio_package_releases r USING(id,version)
            JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion'
            WHERE p.installed AND v.manifest->>'mode'='pull' AND r.package ? 'settingsPage' LIMIT 1`) : null;
          const spaces = await identity.spaces(sql, actor);
          const scopedSpaces = isToken
            ? spaces.filter((s) => s.id === Number(workspace.public_id))
            : spaces;
          const pages = isToken ? [] : await new PluginPages(this.p).list(sql, actor);
          const rawProfile = identity.profile(actor);
          const includeJobs = !isToken || tokenScopes.has("job:read");
          const includeAssets = !isToken || tokenScopes.has("asset:read");
          const out: Record<string, any> = {
            ...(plugins.profile ? { studio_plugins: true } : {}),
            server_time: stamp,
            workspace_id: Number(workspace.public_id),
            ...(!isToken
              ? { legacy_workspace_id: Number(settings.public_id) }
              : {}),
            workspaces: scopedSpaces,
            me: isToken
              ? {
                  id: rawProfile.id,
                  name: rawProfile.name,
                  nickname: rawProfile.nickname,
                  avatar: rawProfile.avatar,
                  role: "token",
                  scopes: [...tokenScopes],
                }
              : rawProfile,
            ...(!isToken
              ? {
                  avatars: avatars.map((id, i) => ({
                    id: "builtin:" + id,
                    label: labels[i],
                    url: "/avatars/" + id + ".svg",
                  })),
                }
              : {}),
            jobs: includeJobs
              ? await this.jobs(
                  sql,
                  workspace.id,
                  stamp,
                  forecast.jobs,
                  plugins.byModel,
                )
              : [],
            assets: includeAssets
              ? await records.assets(sql, workspace.id)
              : [],
            nodes:
              isBrowserAdmin && (await pairedPluginAvailable(sql))
                ? await records.nodes(sql, actor, stamp)
                : [],
            canvas_nodes: await canvasNodeEntries(sql),
            plugin_actions: isToken ? [] : await resourceMenus(sql, actor),
            plugin_importers: isToken ? [] : await importersFor(sql, actor),
            plugin_pages: pages.filter((page) => !page.placement),
            studio_pages: pages.filter((page) => page.placement === "studio"),
            ...(isBrowserAdmin && {
              settings_pages: await installedSettingsPages(sql),
            }),
            gpu_node_settings: nodePage ?? null,
            ...plugins.fields,
            video_models: Object.fromEntries(
              Object.entries(models)
                .filter(([, s]) => s.kind === "video" && !s.hidden)
                .map(([id, s]) => [id, s.label]),
            ),
            audio_models: Object.fromEntries(
              Object.entries(models)
                .filter(([, s]) => s.kind === "audio" && !s.hidden)
                .map(([id, s]) => [id, s.label]),
            ),
            model_catalog: models,
            model_forms: Object.fromEntries(
              (
                await sql.query(
                  `SELECT c.id, f.forms->c.id AS form FROM ${await listedStudioCatalog(sql)} c
               JOIN plugin_model_forms f ON f.plugin_id=c.plugin_id AND f.plugin_version=c.plugin_version`,
                )
              ).rows.map((r) => [r.id, r.form]),
            ),
            model_groups: await catalog.groups(sql),
            model_policy: listedPolicy(await catalog.policy(sql)),
            model_access: await catalog.effective(sql, workspace.id),
            ...(!isToken
              ? {
                  credits: await credits.wallet(
                    sql,
                    Number(workspace.public_id),
                  ),
                  credit_history: await credits.history(
                    sql,
                    Number(workspace.public_id),
                  ),
                }
              : {}),
            pricing: await catalog.prices(sql),
            favorites:
              includeJobs || includeAssets
                ? await new OriginalLibrary(this.p).favorites(
                    sql,
                    actor,
                    workspace.id,
                  )
                : { jobs: [], assets: [] },
          };
          if (isBrowserAdmin) {
            const capacity = await one(sql, "SELECT * FROM storage_capacity");
            let free = await this.p.storage.availableBytes?.();
            if (free === undefined) {
              const disk = await statfs(tmpdir());
              free = Number(disk.bavail) * Number(disk.bsize);
            }
            const teams = (
              await sql.query(
                "SELECT id,public_id FROM workspaces WHERE kind='team' AND public_id=ANY($1::bigint[]) ORDER BY public_id",
                [spaces.filter((s) => s.kind === "team").map((s) => s.id)],
              )
            ).rows;
            const teamPolicies = await catalog.teamPolicies(
              sql,
              teams.map((t) => t.id),
            );
            const policies = Object.fromEntries(
              teams.map((t, i) => [
                String(t.public_id),
                listedPolicy(teamPolicies[i]),
              ]),
            );
            Object.assign(out, {
              used: Number(capacity.used),
              reserved: Number(capacity.reserved),
              quota: Number(capacity.quota),
              disk_free: free,
              users: (
                await sql.query(
                  "SELECT * FROM users WHERE deleted_at IS NULL ORDER BY public_id",
                )
              ).rows.map((u) => ({
                ...identity.profile(u as OriginalActor),
                active: Number(u.active),
              })),
              invite_codes: (await identity.invites(actor, sql)).items,
              team_model_policies: policies,
              credit_accounts: await credits.accountRows(sql),
            });
          }
          if (!isBrowserAdmin) for (const job of out.jobs) job.node = null;
          return out;
        });
      } catch (error: any) {
        if (error.code !== "40001" || attempt >= 2) throw error;
      }
  }
  private async providers(
    sql: Sql,
    catalog: Record<string, any>,
    stamp: number,
    imageEnabled: boolean,
  ) {
    const rows = (
      await sql.query(
        `SELECT DISTINCT v.id,v.version,v.manifest FROM ${await listedStudioCatalog(sql)} c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE v.manifest->'originalState' IS NOT NULL`,
      )
    ).rows;
    const fields: Record<string, unknown> = {},
      byModel = new Map<string, ProviderPlugin>();
    for (const v of rows) {
      const plugin = await this.p.registry.resolve(sql, v.id, v.version),
        adapter = plugin.originalState!,
        policy = v.manifest.originalState;
      requireValue(adapter, 503, "原状态插件尚未安装");
      const connections = (
        await sql.query(
          "SELECT * FROM connections WHERE plugin_id=$1 AND plugin_version=$2 AND NOT removed ORDER BY enabled DESC,id",
          [v.id, v.version],
        )
      ).rows;
      requireValue(connections.length <= 1 || await one(sql,"SELECT id FROM studio_packages WHERE id=$1 AND installed",[v.id]), 503, "原状态提供方连接存在歧义");
      const connection = connections[0];
      const configured = connection
        ? adapter.configured(this.p.vault.open(connection.config))
        : false;
      requireValue(typeof configured === "boolean", 500, "插件配置状态无效");
      const result = adapter.configuration({
        catalog,
        stamp,
        imageEnabled,
        connection: connection
          ? {
              configured,
              enabled: connection.enabled,
              health:
                connection.queue_health_revision === connection.revision
                  ? connection.queue_health
                  : {},
            }
          : undefined,
      });
      requireValue(
        result &&
          Object.keys(result).length === policy.fields.length &&
          policy.fields.every(
            (key: string) =>
              Object.hasOwn(result, key) && !Object.hasOwn(fields, key),
          ),
        503,
        "原状态字段缺失或重复",
      );
      Object.assign(fields, result);
      for (const m of plugin.manifest.models)
        if (catalog[m.id]) byModel.set(m.id, plugin);
    }
    const profile = await studioPluginProfile(sql);
    // The original wire format requires these sections even when their package is absent.
    // Validate each installed adapter above before projecting the empty sections.
    if (profile) {
      const images = Object.entries(catalog).filter(
        ([, m]) => m.kind === "image" && !m.hidden,
      );
      Object.assign(fields, {
        ratios: Object.keys(catalog).length
          ? ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]
          : [],
        sizes: {},
        gpu_models: {},
        h3_limits: {
          images: 0,
          videos: 0,
          audios: 0,
          total: 0,
          clip_seconds: 0,
        },
        images: {
          configured: false,
          enabled: imageEnabled,
          default_model: images[0]?.[0] ?? "",
          models: Object.fromEntries(images.map(([id, m]) => [id, m.label])),
          sizes: {},
        },
        flow: { configured: false, ready: false, model_count: 0 },
        muse: {
          configured: false,
          ready: false,
          image_ratios: [],
          video_ratios: [],
          durations: [],
        },
        ...fields,
      });
    }
    const validated = stateProviderFieldsSchema.safeParse(fields);
    requireValue(validated.success, 503, "原状态插件未完整启用");
    return { fields: validated.data!, byModel, profile };
  }
  /** A canvas uses the same global queue snapshot but retains the stored note
   * rather than the studio-only "waiting for model" display override. */
  async canvasJobs(sql: Sql, workspace: string) {
    const settings = await one(
      sql,
      "SELECT image_enabled FROM original_state_settings",
    );
    await new Executor(this.p).recoverOn(sql, true);
    const forecast = await new QueueForecasts(this.p).read(sql, workspace, {
      imageEnabled: settings.image_enabled,
    });
    const catalog = await new StudioCatalog(this.p.db).catalog(sql);
    const plugins = await this.providers(
      sql,
      catalog,
      forecast.serverTime,
      settings.image_enabled,
    );
    return this.jobs(
      sql,
      workspace,
      forecast.serverTime,
      forecast.jobs,
      plugins.byModel,
      false,
    );
  }
  private async jobs(
    sql: Sql,
    workspace: string,
    stamp: number,
    forecast: Record<string, any>,
    byModel: Map<string, ProviderPlugin>,
    admissionNote = true,
  ) {
    const visible = (
      await sql.query(`SELECT j.*,u.public_id AS owner_public_id,w.public_id AS workspace_public_id,
      COALESCE(NULLIF(u.nickname,''),u.name) AS author,n.public_id AS node_public_id,
      studio_model_allowed(COALESCE(j.catalog_id,m.catalog_id),j.workspace_id) AS allowed,
      v.manifest->'originalSubmission'->>'version' IN ('2','3') AS remote_studio
      FROM jobs j JOIN users u ON u.id=j.owner_id JOIN workspaces w ON w.id=j.workspace_id JOIN models m ON m.id=j.model_id
      JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
      LEFT JOIN gpu_nodes n ON n.id::text=j.remote_id
      WHERE j.workspace_id=$1 AND j.plugin_id!='legacy-archive' AND j.deleted_at IS NULL
        AND j.kind IN ('image','video','audio')
        AND (v.endpoint IS NULL OR j.original_uid IS NOT NULL)
      ORDER BY j.public_id`, [workspace])
    ).rows;
    const queued = (
      await sql.query(`SELECT j.id,j.provider_model,j.connection_id,j.kind,
      studio_model_allowed(COALESCE(j.catalog_id,m.catalog_id),j.workspace_id) AS allowed,
      v.manifest->'originalSubmission'->>'version' IN ('2','3') AS remote_studio
      FROM jobs j JOIN models m ON m.id=j.model_id
      JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
      WHERE j.state='queued' AND j.plugin_id!='legacy-archive' AND j.deleted_at IS NULL
        AND j.kind IN ('image','video','audio')
        AND (v.endpoint IS NULL OR j.original_uid IS NOT NULL)
      ORDER BY j.public_id`)
    ).rows;
    const pending = new Map<string, number>(),
      ahead = new Map<string, number>();
    for (const j of queued) {
      const plugin = byModel.get(j.provider_model);
      requireValue(j.remote_studio || plugin, 503, "任务模型缺少原状态插件");
      const lane = j.remote_studio
        ? "remote:" + j.connection_id
        : plugin!.manifest.originalState!.queueLane === "kind"
          ? j.kind
          : plugin!.manifest.id;
      ahead.set(j.id, j.allowed ? pending.get(lane) || 0 : 0);
      if (j.allowed) pending.set(lane, (pending.get(lane) || 0) + 1);
    }
    const runs = (
      await sql.query(
        "SELECT DISTINCT ON(job) * FROM job_runs WHERE job=ANY($1::uuid[]) ORDER BY job,id DESC",
        [visible.map((j) => j.id)],
      )
    ).rows;
    const latest = new Map(runs.map((r) => [r.job, r]));
    await attachJobResults(sql, visible);
    const fields = [
      "ratio",
      "quality",
      "seconds",
      "sampling_steps",
      "seed",
      "width",
      "height",
      "image_quality",
      "audio_settings",
      "h3_inputs",
      "refs",
    ];
    const jobs: Record<string, any>[] = [];
    const frozenPlugins = new Map<string, ProviderPlugin>();
    for (const j of visible) {
      const key = j.plugin_id + "@" + j.plugin_version;
      if (!j.remote_studio && !frozenPlugins.has(key)) {
        const version = await one(
          sql,
          "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
          [j.plugin_id, j.plugin_version],
        );
        const adapter = version?.manifest.originalState
          ? await this.p.registry.resolve(sql, j.plugin_id, j.plugin_version)
          : byModel.get(j.provider_model);
        if (adapter) frozenPlugins.set(key, adapter);
      }
      const plugin = frozenPlugins.get(key);
      requireValue(
        (j.remote_studio || plugin) &&
          fields.every((k) => Object.hasOwn(j.original_view, k)) &&
          j.attempts !== null,
        503,
        "任务尚未完成原状态迁移",
      );
      const run = latest.get(j.id);
      const projection = stateJobProjectionSchema.parse(
        j.remote_studio
          ? {
              width: j.result_metadata?.width,
              height: j.result_metadata?.height,
            }
          : plugin!.originalState!.project({
              state: j.state,
              kind: j.kind,
              model: j.provider_model,
              phase: run?.phase,
              remoteId: j.remote_id,
              view: j.original_view,
              metadata: j.result_metadata || {},
              usage: j.result?.usage || {},
            }),
      );
      const view = {
        ...Object.fromEntries(fields.map((k) => [k, j.original_view[k]])),
        ...(j.remote_studio && j.original_view.params
          ? { params: j.original_view.params }
          : {}),
        actual: j.original_view.actual || {},
        ...Object.fromEntries(
          Object.entries(projection).filter(([, v]) => v !== undefined),
        ),
      };
      jobs.push({
        id: Number(j.public_id),
        workspace: Number(j.workspace_public_id),
        owner: Number(j.owner_public_id),
        author: j.author,
        prompt: j.input.prompt,
        ...view,
        parent: j.original_parent === null ? null : Number(j.original_parent),
        status:
          j.state === "completed"
            ? "done"
            : ["dispatching", "finalizing", "uncertain"].includes(j.state)
              ? "running"
              : j.state,
        created: epoch(j.created_at),
        result: j.result_public_id ?? null,
        note:
          admissionNote && j.state === "queued" && !j.allowed
            ? "等待模型开放"
            : (j.request_note ?? (j.error || projection.note || "")),
        node: j.node_public_id === null ? null : Number(j.node_public_id),
        kind: j.kind,
        model: j.provider_model,
        updated: epoch(j.updated_at),
        attempts: j.attempts,
        timing:
          forecast[j.id]?.timing ??
          elapsedDetail(run as Run | undefined, stamp),
        ...(j.state === "queued" ? { ahead: ahead.get(j.id) } : {}),
        ...(forecast[j.id] ? { eta: forecast[j.id].eta } : {}),
      });
    }
    jobs.push(
      ...(await new OriginalStateRecords().archivedJobs(sql, workspace, stamp)),
    );
    return jobs.sort((a, b) => b.id - a.id);
  }
}
