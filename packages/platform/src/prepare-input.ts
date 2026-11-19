import { z } from "zod";
import type { Platform } from "./platform.js";
import type { Sql } from "./db.js";
import { one } from "./db.js";
import { DomainError, requireValue } from "./security.js";
import { validator } from "./plugins.js";
import {
  InputPreparationError,
  preparedInputSchema,
  type PreparationRequest,
  type PreparationAsset,
} from "../../plugin-sdk/src/preparation.js";
export async function prepareSubmission(
  p: Platform,
  sql: Sql,
  model: any,
  input: {
    prompt: string;
    params: Record<string, unknown>;
    references: string[];
    referencePacks: unknown[];
  },
  workspace: string,
) {
  const plugin = await p.registry.resolve(
    sql,
    model.plugin_id,
    model.plugin_version,
  );
  requireValue(
    plugin.referenceIds && plugin.prepareInput,
    503,
    "输入冻结适配器不可用",
  );
  const request: PreparationRequest = structuredClone({
    model: model.provider_model,
    kind: model.kind,
    prompt: input.prompt,
    params: input.params,
    references: input.references,
    hasReferencePacks: input.referencePacks.length > 0,
  });
  try {
    const selected = z
      .array(z.string().uuid())
      .max(24)
      .safeParse(plugin.referenceIds(request));
    requireValue(selected.success, 500, "插件参考素材选择结果无效");
    const ids = selected.data,
      assets: PreparationAsset[] = [];
    for (const id of [...new Set(ids)].sort()) {
      const a = await one(
        sql,
        `SELECT a.id,a.mime,a.original_kind,a.size,a.metadata,r.seconds,r.fps,r.has_audio,r.name FROM assets a LEFT JOIN asset_reference_media r ON r.asset_id=a.id WHERE a.id=$1 AND a.workspace_id=$2 AND a.state='ready' FOR KEY SHARE OF a`,
        [id, workspace],
      );
      requireValue(a, 404, "参考素材不可访问");
      assets.push({
        id,
        role: a.original_kind,
        mime: a.mime,
        size: Number(a.size),
        width: a.metadata.width || 0,
        height: a.metadata.height || 0,
        ...(a.seconds === null
          ? {}
          : {
              reference: {
                seconds: a.seconds,
                fps: a.fps,
                has_audio: a.has_audio,
                name: a.name,
              },
            }),
      });
    }
    const prepared = preparedInputSchema.safeParse(
      plugin.prepareInput(request, assets),
    );
    requireValue(prepared.success, 500, "插件输入冻结结果无效");
    const result = prepared.data;
    requireValue(
      result.references.every((id) => ids.includes(id)),
      500,
      "插件返回未授权的参考素材",
    );
    const schema = plugin.manifest.models.find(
      (m) => m.id === model.provider_model,
    )?.preparedSchema;
    requireValue(
      schema && validator.validate(schema, result.params),
      500,
      "插件输入冻结结果无效",
    );
    const policy = model.schema["x-references"] || {};
    requireValue(
      result.references.length >= (policy.min || 0) &&
        result.references.length <= (policy.max ?? 12),
      400,
      "参考素材数量不符合模型要求",
    );
    for (const id of result.references) {
      const a = assets.find((a) => a.id === id)!;
      requireValue(
        !policy.types || policy.types.includes(a.mime.split("/")[0]),
        400,
        "参考素材类型不符合模型要求",
      );
    }
    return result;
  } catch (e) {
    if (e instanceof InputPreparationError)
      throw new DomainError(400, e.message);
    throw e;
  }
}
