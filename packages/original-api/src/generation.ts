import { resolvePublishedRoute } from "@fumiao/platform/model-access/publication.js";
import { acceptNativeMedia } from "./native-media.js";
import { hasStudioPackages } from "@fumiao/platform/studio-plugin-profile.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { randomUUID } from "node:crypto";
import type { Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue, DomainError, hash } from "@fumiao/platform/security.js";
import { canonical, validator } from "@fumiao/platform/plugins.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { ReferencePacks, packPurposes } from "@fumiao/platform/packs.js";
import { capacity, JOB_RESERVE } from "@fumiao/platform/capacity.js";
import {
  executableJob,
  ordinaryFlowSource,
} from "@fumiao/platform/retired-jobs.js";
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
    const row = await one(
      sql,
      `SELECT j.*,(${ordinaryFlowSource}) AS ordinary_origin FROM jobs j WHERE public_id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
      [id, workspace],
    );
    if (!row) return undefined;
    await new OriginalLibrary(this.p).access(
      sql,
      user,
      { kind: "job", row },
      workspace,
    );
    const metadata = { ...row.original_view.actual, ...row.result?.usage };
    if (continuation && !row.ordinary_origin) delete metadata.flow_media_id;
    return {
      id: Number(row.public_id),
      model: row.provider_model,
      kind: row.kind,
      state: row.state,
      params: row.input.params,
      view: { ...row.input.params, ...row.original_view },
      metadata,
    };
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
        "SELECT c.*,v.manifest FROM studio_catalog c LEFT JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE c.id=$1",
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
      const native = catalog.source_kind === "builtin";
      const plugin = native
        ? undefined
        : await this.p.registry.resolve(
            sql,
            catalog.plugin_id,
            catalog.plugin_version,
          );
      const adapter = plugin?.originalSubmission;
      requireValue(
        native || (catalog.manifest.originalSubmission && adapter),
        503,
        "原生成提交适配器尚未启用",
      );
      adapter?.validate(draft, "before-packs");
      const namespace = native ? "-builtin" : adapter!.namespace(draft);
      requireValue(
        /^(?:|-[a-z0-9-]{1,80})$/.test(namespace),
        500,
        "插件请求命名空间无效",
      );
      const uid = `${user.public_id}${namespace}-${draft.uid}`;
      // Global policy -> owner identity -> workspace wallet. Configuration and
      // queue admission remain stable through acceptance; no external calls.
      const policy = await one(
        sql,
        "SELECT price_revision FROM studio_policy FOR SHARE",
      );
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "original-submit:" + user.id,
      ]);
      await sql.query(
        "SELECT workspace_id FROM wallets WHERE workspace_id=$1 FOR UPDATE",
        [workspace.id],
      );
      if (!draft.asset_packs.length) adapter?.validate(draft, "before-retry");
      const packages = !native && (await hasStudioPackages(sql));
      const previous = await one(
        sql,
        native
          ? "SELECT j.public_id,j.workspace_id,j.deleted_at,j.request_hash,j.price_revision FROM model_access_job_uids i JOIN jobs j ON j.id=i.job_id WHERE i.uid=$1"
          : packages
            ? `SELECT * FROM jobs WHERE deleted_at IS NULL AND (original_uid=$1 OR (owner_id=$2 AND catalog_id=$3 AND studio_client_uid=$4 AND EXISTS(SELECT 1 FROM studio_shared_models WHERE model_id=$3))) LIMIT 1`
            : "SELECT * FROM jobs WHERE original_uid=$1 AND deleted_at IS NULL",
        packages ? [uid, user.id, draft.model, draft.uid] : [uid],
      );
      // A legacy draft defaults to 5 seconds. A native draft without an explicit
      // duration selects the route default, which must remain distinct on replay.
      const useRouteDuration = native && draft.kind === "video" &&
        !Object.hasOwn(draft.params ?? {}, "seconds") && !draft.provided.includes("seconds");
      // Keep the generation fingerprint compatible with receipts issued before
      // explicit native quotes. A quote authorizes the order, not its content.
      const fingerprintDraft: Record<string, unknown> = { ...draft, ...(previous && native ? { price_revision: Number(previous.price_revision) } : {}), ...(useRouteDuration ? { seconds: undefined } : {}), provided: undefined };
      delete fingerprintDraft.route_revision;
      delete fingerprintDraft.price_revision_id;
      delete fingerprintDraft.max_charge;
      const fingerprint = native ? hash(canonical(fingerprintDraft)) : "";
      if (previous) {
        await new OriginalLibrary(this.p).access(
          sql,
          user,
          { kind: "job", row: previous },
          workspace.id,
        );
        if (native) {
          requireValue(
            !previous.deleted_at,
            409,
            "已删除作品的请求编号不能再次生成",
          );
          requireValue(
            previous.request_hash === fingerprint,
            409,
            "请求编号已用于其他生成任务",
          );
        }
        return { id: Number(previous.public_id) };
      }
      let snapshots: unknown[] = [];
      if (draft.asset_packs.length) {
        // Expand public IDs before validating any direct references, as Pure does.
        const packs = new ReferencePacks(this.p.db),
          refs = [...draft.refs],
          prompts = [pythonStrip(draft.prompt)];
        requireValue(
          new Set(draft.asset_packs.map((p) => p.id)).size ===
            draft.asset_packs.length,
          400,
          "请勿重复引用素材包",
        );
        for (const selectedPack of draft.asset_packs) {
          const pack = await packs.view(
            sql,
            await packs.get(
              sql,
              user,
              selectedPack.id,
              workspace.id,
              true,
              "share",
            ),
          );
          requireValue(
            pack.revision === selectedPack.revision,
            409,
            `素材包“${pack.name}”已更新，请重新选择后生成`,
          );
          for (const id of pack.media) if (!refs.includes(id)) refs.push(id);
          const indexes = pack.media
            .map((id: string) => `<Picture ${refs.indexOf(id) + 1}>`)
            .join(", ");
          prompts.push(
            `${pack.name}（${packPurposes[pack.purpose as keyof typeof packPurposes]}，${indexes}）：${pack.description}`,
          );
          snapshots.push(
            Object.fromEntries(
              ["id", "revision", "name", "purpose", "description", "media"].map(
                (key) => [key, (pack as any)[key]],
              ),
            ),
          );
        }
        draft.prompt = prompts.join("\n\n");
        draft.refs = refs;
        draft.asset_packs = [];
        requireValue(
          refs.length <= 9 && [...draft.prompt].length <= 12000,
          400,
          "参考图片合计最多 9 张，提示词和素材说明合计最多 12000 字",
        );
        adapter?.validate(draft, "before-retry");
      }
      if (native) {
        const route = await resolvePublishedRoute(sql, draft.model);
        requireValue(route, 409, "模型线路已更新");
        requireValue(
          priceRevision != null &&
            BigInt(priceRevision) === BigInt(policy.price_revision),
          409,
          "积分价格已更新，请确认新价格后重新提交",
        );
        if (draft.parent)
          requireValue(
            await this.task(sql, user, workspace.id, draft.parent),
            404,
            "来源任务不可访问",
          );
        return acceptNativeMedia(
          this.p,
          sql,
          user,
          workspace.id,
          route,
          draft,
          uid,
          fingerprint,
          Number(policy.price_revision),
          snapshots,
          meta,
        );
      }
      requireValue(plugin && adapter, 503, "原生成提交适配器尚未启用");
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
