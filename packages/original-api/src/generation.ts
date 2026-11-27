import { hasStudioPackages } from "@fumiao/platform/studio-plugin-profile.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { randomUUID } from "node:crypto";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import {
  requireValue,
  DomainError,
  hash,
} from "@fumiao/platform/security.js";
import { canonical, validator } from "@fumiao/platform/plugins.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { capacity, JOB_RESERVE } from "@fumiao/platform/capacity.js";
import { executableJob } from "@fumiao/platform/retired-jobs.js";
import { expandOriginalPacks, originalTask } from "./generation-inputs.js";
import { acceptTask, type AcceptTaskMeta } from "@fumiao/platform/accept.js";
import { saveSubmissionForecast } from "@fumiao/platform/submission-forecast.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalLibrary } from "./library.js";
import { parseDraft } from "./drafts.js";
import {
  InputPreparationError,
  preparedInputSchema,
  OriginalSubmissionError,
  type OriginalDraft,
  type OriginalReference,
  type OriginalTask,
} from "@fumiao/plugin-sdk/index.js";

export class OriginalGeneration {
  constructor(readonly p: Platform) {}
  async parse(kind: OriginalDraft["kind"], value: unknown) {
    return parseDraft(
      kind,
      value,
      await new StudioCatalog(this.p.db).catalog(),
    );
  }
  private async task(
    sql: Sql,
    user: OriginalActor,
    workspace: string,
    id?: number | null,
    continuation = false,
  ): Promise<OriginalTask | undefined> {
    if (!id) return undefined;
    const resource = await originalTask(sql, workspace, id, continuation);
    if (!resource) return;
    await new OriginalLibrary(this.p).access(
      sql,
      user,
      { kind: "job", row: resource.row },
      workspace,
    );
    return resource.task;
  }
  async submit(user: OriginalActor, value: OriginalDraft, selected?: string) {
    return this.p.db.transaction((sql) =>
      this.submitOn(sql, user, value, selected),
    );
  }
  /** Join the caller's transaction so a candidate batch and its links/holds are atomic.
   * The canvas wire contract also accepts price revisions outside the provider draft range. */
  async submitOn(
    sql: Sql,
    user: OriginalActor,
    value: OriginalDraft,
    selected?: string,
    priceRevision: number | bigint | null = value.price_revision,
    meta?: AcceptTaskMeta,
  ) {
    const draft = structuredClone(value);
    try {
      const catalog = await one(
        sql,
        "SELECT c.*,v.manifest FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE c.id=$1",
        [draft.model],
      );
      requireValue(
        catalog && catalog.descriptor.kind === draft.kind,
        400,
        draft.kind === "audio" ? "未知语音模型" : "未知生成模型",
      );
      const workspace = await new OriginalIdentity(this.p).activeWorkspace(
        sql,
        user,
        selected,
      );
      const plugin = await this.p.registry.resolve(
        sql,
        catalog.plugin_id,
        catalog.plugin_version,
      );
      const adapter = plugin.originalSubmission;
      requireValue(
        catalog.manifest.originalSubmission && adapter,
        503,
        "原生成提交适配器尚未启用",
      );
      adapter.validate(draft, "before-packs");
      const namespace = adapter.namespace(draft);
      requireValue(
        /^(?:|-[a-z0-9-]{1,80})$/.test(namespace),
        500,
        "插件请求命名空间无效",
      );
      const uid = `${user.public_id}${namespace}-${draft.uid}`;
      // Global policy -> owner identity -> workspace wallet. Configuration and
      // queue admission remain stable through acceptance; no external calls.
      await sql.query("SELECT price_revision FROM studio_policy FOR SHARE");
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "original-submit:" + user.id,
      ]);
      await sql.query(
        "SELECT workspace_id FROM wallets WHERE workspace_id=$1 FOR UPDATE",
        [workspace.id],
      );
      if (!draft.asset_packs.length) adapter.validate(draft, "before-retry");
      const packages = await hasStudioPackages(sql);
      const previous = await one(
        sql,
        packages
          ? `SELECT * FROM jobs WHERE deleted_at IS NULL AND (original_uid=$1 OR (owner_id=$2 AND catalog_id=$3 AND studio_client_uid=$4 AND EXISTS(SELECT 1 FROM studio_shared_models WHERE model_id=$3))) LIMIT 1`
          : "SELECT * FROM jobs WHERE original_uid=$1 AND deleted_at IS NULL",
        packages ? [uid, user.id, draft.model, draft.uid] : [uid],
      );
      if (previous) {
        await new OriginalLibrary(this.p).access(
          sql,
          user,
          { kind: "job", row: previous },
          workspace.id,
        );
        return { id: Number(previous.public_id) };
      }
      let snapshots: Awaited<ReturnType<typeof expandOriginalPacks>>["snapshots"] = [];
      if (draft.asset_packs.length) {
        await new OriginalIdentity(this.p).requireWorkspace(sql, user, Number(workspace.public_id));
        const expanded = await expandOriginalPacks(sql, workspace.id, draft, true);
        snapshots = expanded.snapshots;
        draft.prompt = expanded.prompt;
        draft.refs = expanded.refs;
        draft.asset_packs = [];
        adapter.validate(draft, "before-retry");
      }
      // The policy check precedes reference validation and billing in the original.
      if (packages)
        requireValue(
          (
            await one(sql, "SELECT studio_plugin_accepts($1) AS ok", [
              catalog.plugin_id,
            ])
          ).ok,
          409,
          "插件已停用",
        );
      requireValue(
        (
          await one(sql, "SELECT studio_model_allowed($1,$2) AS allowed", [
            draft.model,
            workspace.id,
          ])
        ).allowed,
        403,
        "当前空间未开放该模型，请选择其他模型",
      );
      adapter.validate(draft, "prepare");
      const plan = adapter.plan(draft);
      requireValue(plan.namespace === namespace, 500, "插件请求命名空间不一致");
      const connections = (
        await sql.query(
          `SELECT m.*,c.plugin_id,c.plugin_version,c.config,c.enabled AS connection_enabled FROM models m JOIN connections c ON c.id=m.connection_id
          LEFT JOIN model_permissions p ON p.model_id=m.id AND p.workspace_id=$2
          WHERE m.catalog_id=$1 ${(await hasStudioPackages(sql)) ? "AND studio_service_selected(m.catalog_id,c.id)" : ""} AND c.plugin_id=$3 AND c.plugin_version=$4 AND COALESCE(p.enabled,true)=true ORDER BY c.id FOR SHARE OF c`,
          [
            draft.model,
            workspace.id,
            catalog.plugin_id,
            catalog.plugin_version,
          ],
        )
      ).rows;
      const enabled = connections.filter((c) => c.connection_enabled);
      requireValue(
        enabled.length === 1,
        503,
        plan.requireConfigured ||
          (enabled.length
            ? "该模型配置了多个执行连接，请指定唯一原站连接"
            : "模型执行连接尚未启用"),
      );
      const model = enabled[0];
      if (catalog.manifest.originalSubmission.version >= 2)
        requireValue(
          validator.validate(
            plugin.manifest.configSchema,
            this.p.vault.open(model.config),
          ),
          503,
          "模型执行连接配置无效",
        );
      if (plan.requireConfigured) {
        const config = this.p.vault.open(model.config);
        requireValue(
          plugin.manifest.originalState
            ? plugin.originalState!.configured(config)
            : !!config.baseUrl && !!config.apiKey,
          503,
          plan.requireConfigured,
        );
        if (plugin.manifest.originalState?.requiresImageEnabled)
          requireValue(
            (
              await one(
                sql,
                "SELECT image_enabled FROM original_state_settings",
              )
            ).image_enabled,
            503,
            plan.requireConfigured,
          );
      }
      const references: OriginalReference[] = [];
      // Lock authorized assets deterministically, retain request order separately.
      const rows = new Map<string, any>();
      for (const id of [...new Set(plan.refs)].sort())
        rows.set(
          id,
          await one(
            sql,
            "SELECT a.*,r.seconds,r.fps,r.has_audio,r.name FROM assets a LEFT JOIN asset_reference_media r ON r.asset_id=a.id WHERE a.public_id=$1 AND a.state='ready' FOR KEY SHARE OF a",
            [id],
          ),
        );
      for (const id of plan.refs) {
        const row = rows.get(id);
        requireValue(
          row && plan.roles.includes(row.original_kind),
          plan.missing.status,
          plan.missing.message,
        );
        await new OriginalLibrary(this.p).access(
          sql,
          user,
          { kind: "asset", row },
          workspace.id,
        );
        references.push({
          id: row.id,
          publicId: row.public_id,
          role: row.original_kind,
          mime: row.mime,
          size: Number(row.size),
          width: Number(row.metadata.width || 0),
          height: Number(row.metadata.height || 0),
          ...(row.seconds === null
            ? {}
            : {
                reference: {
                  seconds: row.seconds,
                  fps: row.fps,
                  has_audio: row.has_audio,
                  name: row.name,
                },
              }),
        });
      }
      if (plan.referenceBytes)
        requireValue(
          references.reduce((n, r) => n + r.size, 0) <= plan.referenceBytes.max,
          400,
          plan.referenceBytes.message,
        );
      const admit = async () => {
        if (!plan.admission) return;
        await sql.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["original-admission:" + catalog.plugin_id],
        );
        const counts = await one(
          sql,
          `SELECT count(*) AS total,count(*) FILTER (WHERE owner_id=$2) AS owned FROM jobs j
            WHERE provider_model=ANY($1::text[]) AND deleted_at IS NULL
            AND state IN ('queued','dispatching','running','finalizing','uncertain') AND ${executableJob}`,
          [plan.admission.models, user.id],
        );
        requireValue(
          (!plan.admission.global ||
            Number(counts.total) < plan.admission.global) &&
            (!plan.admission.owner ||
              Number(counts.owned) < plan.admission.owner),
          429,
          plan.admission.message,
        );
      };
      const prepared = await adapter.prepare(draft, {
        references,
        owner: {
          id: Number(user.public_id),
          site: process.env.PUBLIC_URL || "http://localhost:3000",
        },
        parent: await this.task(sql, user, workspace.id, draft.parent),
        source: await this.task(sql, user, workspace.id, plan.source, true),
        admit,
        capacity: async () => {
          await capacity(sql, this.p.storage, JOB_RESERVE);
        },
      });
      const frozen = preparedInputSchema.safeParse({
        params: prepared.params,
        references: prepared.references,
      });
      const spec = plugin.manifest.models.find((m) => m.id === draft.model)!;
      requireValue(
        frozen.success &&
          prepared.references.every((id) =>
            references.some((a) => a.id === id),
          ) &&
          validator.validate(
            spec.preparedSchema || spec.inputSchema,
            prepared.params,
          ),
        500,
        "插件原提交冻结结果无效",
      );
      // Mandatory core checks also prevent an adapter from bypassing admission/capacity.
      await admit();
      await capacity(sql, this.p.storage, JOB_RESERVE);
      const quote = await new StudioCatalog(this.p.db).quote(
        sql,
        { ...model, catalog_id: draft.model },
        workspace.id,
        prepared.params,
        priceRevision ?? undefined,
      );
      const input = {
        modelId: model.id,
        key: randomUUID(),
        prompt: pythonStrip(draft.prompt),
        params: prepared.params,
        references: prepared.references,
        referencePacks: [],
      };
      const accepted = await acceptTask(
        this.p,
        sql,
        user,
        workspace.id,
        model,
        input,
        hash(canonical(draft)),
        quote,
        snapshots,
        {
          projectId: meta?.projectId ?? null,
          nodeId: meta?.nodeId ?? null,
          executionKey: meta?.executionKey ?? uid,
        },
      );
      const row = await one(
        sql,
        "UPDATE jobs SET original_uid=$2,original_parent=$3,original_view=$4 WHERE id=$1 RETURNING public_id",
        [
          accepted.id,
          uid,
          draft.parent,
          JSON.stringify({
            ...prepared.view,
            refs: prepared.references.map(
              (id) => references.find((a) => a.id === id)!.publicId,
            ),
          }),
        ],
      );
      if (packages)
        await sql.query("UPDATE jobs SET studio_client_uid=$2 WHERE id=$1", [
          accepted.id,
          draft.uid,
        ]);
      await saveSubmissionForecast(this.p, sql, accepted.id);
      return { id: Number(row.public_id) };
    } catch (error) {
      if (error instanceof OriginalSubmissionError)
        throw new DomainError(error.status, error.message);
      if (error instanceof InputPreparationError)
        throw new DomainError(400, error.message);
      throw error;
    }
  }
}
