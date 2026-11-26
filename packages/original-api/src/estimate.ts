import type { Platform } from "@fumiao/platform/platform.js";
import { one } from "@fumiao/platform/db.js";
import { requireValue, DomainError } from "@fumiao/platform/security.js";
import { hasStudioPackages } from "@fumiao/platform/studio-plugin-profile.js";
import {
  QueueForecasts,
  type ForecastCandidate,
} from "@fumiao/platform/queue-snapshot.js";
import {
  submissionDuration,
  unobservedDuration,
} from "@fumiao/platform/submission-forecast.js";
import {
  estimateInputSchema,
  OriginalSubmissionError,
  InputPreparationError,
  type EstimateDraft,
  type OriginalReference,
} from "@fumiao/plugin-sdk/index.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { OriginalLibrary } from "./library.js";
import { parseBody } from "./validation.js";
import { estimateFields } from "./estimate-draft.js";

// These are original protocol defaults, not provider dispatch branches.
const defaults = { video: "MiniMax H3", image: "gpt-image-2.6-sunburst" };
const candidateId = "00000000-0000-4000-8000-000000000001";
const virtualConnectionId = "00000000-0000-4000-8000-000000000002";
export class OriginalEstimates {
  constructor(readonly p: Platform) {}
  async read(user: OriginalActor, value: unknown, selected?: string) {
    const draft = parseBody(value, estimateFields) as EstimateDraft;
    try {
      return await this.p.db.transaction(async (sql) => {
        await sql.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        if (
          draft.model &&
          (await one(
            sql,
            `SELECT c.id FROM studio_catalog c
          JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
          WHERE c.id=$1 AND c.descriptor->>'kind'=$2 AND (v.manifest->'originalSubmission'->>'version' IN ('2','3') OR (v.manifest->'originalSubmission'->>'version'='5' AND v.manifest->'originalEstimate' IS NULL))`,
            [draft.model, draft.kind],
          ))
        ) {
          await new OriginalIdentity(this.p).activeWorkspace(
            sql,
            user,
            selected,
          );
          return { duration: { ...unobservedDuration }, queue: null };
        }
        const fallback =
          draft.kind === "image" && !draft.h3 ? defaults.image : defaults.video;
        const requested =
          draft.h3 || draft.kind === "audio"
            ? fallback
            : draft.model || fallback;
        const catalog =
          (await one(
            sql,
            "SELECT c.*,v.manifest FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE c.id=$1 AND c.descriptor->>'kind'<>'chat'",
            [requested],
          )) ||
          (await one(
            sql,
            "SELECT c.*,v.manifest FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE c.id=$1",
            [fallback],
          ));
        requireValue(
          catalog?.manifest.originalEstimate,
          503,
          "原估时适配器尚未启用",
        );
        const plugin = await this.p.registry.resolve(
          sql,
          catalog.plugin_id,
          catalog.plugin_version,
        );
        requireValue(plugin.originalEstimate, 503, "原估时适配器尚未启用");
        let workspace: any;
        const authorize = async () => {
          workspace ??= await new OriginalIdentity(this.p).activeWorkspace(
            sql,
            user,
            selected,
          );
        };
        const authorized = new Map<string, OriginalReference>();
        const prepared = estimateInputSchema.parse(
          await plugin.originalEstimate.prepare(draft, {
            authorize,
            references: async (
              ids,
              roles = ["ref"],
              missing = { status: 404, message: "内容不存在或无权访问" },
            ) => {
              await authorize();
              requireValue(ids.length <= 12, 500, "插件估时引用无效");
              const refs: OriginalReference[] = [];
              for (const publicId of ids) {
                const row = await one(
                  sql,
                  "SELECT a.*,r.seconds,r.fps,r.has_audio,r.name FROM assets a LEFT JOIN asset_reference_media r ON r.asset_id=a.id WHERE a.public_id=$1 AND a.state='ready'",
                  [publicId],
                );
                requireValue(
                  row && roles.includes(row.original_kind),
                  missing.status,
                  missing.message,
                );
                await new OriginalLibrary(this.p).access(
                  sql,
                  user,
                  { kind: "asset", row },
                  workspace.id,
                );
                const ref: OriginalReference = {
                  id: row.id,
                  publicId,
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
                };
                authorized.set(ref.id, ref);
                refs.push(ref);
              }
              return refs;
            },
          }),
        );
        await authorize();
        requireValue(
          prepared.references.every((id) => authorized.has(id)) &&
            plugin.manifest.models.some(
              (m) => m.id === prepared.model && m.kind === prepared.kind,
            ),
          500,
          "插件估时输入无效",
        );
        const connections = (
          await sql.query(
            `SELECT c.id,c.plugin_id,c.plugin_version,c.enabled,c.revision,c.queue_health,c.queue_health_revision,COALESCE(p.enabled,true) AS allowed FROM connections c JOIN models m ON m.connection_id=c.id LEFT JOIN model_permissions p ON p.model_id=m.id AND p.workspace_id=$2 WHERE m.catalog_id=$1 AND studio_service_selected(m.catalog_id,c.id) AND c.plugin_id=$3 AND c.plugin_version=$4 ORDER BY c.id`,
            [
              prepared.model,
              workspace.id,
              catalog.plugin_id,
              catalog.plugin_version,
            ],
          )
        ).rows;
        const enabled = connections.filter((c) => c.enabled);
        requireValue(
          enabled.length <= 1,
          503,
          "该模型配置了多个执行连接，请指定唯一原站连接",
        );
        const connection =
          enabled[0] ||
          (connections.length === 1
            ? connections[0]
            : {
                id: virtualConnectionId,
                plugin_id: catalog.plugin_id,
                plugin_version: catalog.plugin_version,
                enabled: true,
                revision: 0,
                queue_health: {},
                queue_health_revision: null,
                allowed: true,
              });
        const hasPackages = await hasStudioPackages(sql);
        const policy = await one(
          sql,
          `SELECT ${hasPackages ? "studio_plugin_accepts($3) AND " : ""}studio_model_allowed($1,$2) AS allowed`,
          hasPackages
            ? [prepared.model, workspace.id, catalog.plugin_id]
            : [prepared.model, workspace.id],
        );
        const candidate: ForecastCandidate = {
          connection: connection as ForecastCandidate["connection"],
          job: {
            id: candidateId,
            public_id: 2 ** 62,
            workspace_id: workspace.id,
            connection_id: connection.id,
            plugin_id: catalog.plugin_id,
            plugin_version: catalog.plugin_version,
            provider_model: prepared.model,
            kind: prepared.kind,
            state: "queued",
            remote_id: null,
            allowed: policy.allowed && connection.allowed,
            input: {
              prompt: "",
              params: prepared.params,
              references: prepared.references,
            },
          },
        };
        const snapshot = await new QueueForecasts(this.p).read(
          sql,
          workspace.id,
          { candidate },
        );
        const queue = snapshot.jobs[candidateId].eta;
        const duration = await submissionDuration(
          this.p,
          sql,
          candidate.job,
          queue,
          snapshot.candidateEligible,
        );
        return { duration, queue };
      });
    } catch (error) {
      if (error instanceof OriginalSubmissionError)
        throw new DomainError(error.status, error.message);
      if (error instanceof InputPreparationError)
        throw new DomainError(400, error.message);
      throw error;
    }
  }
}
