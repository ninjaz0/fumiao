import { imageReferenceLimits, isImageControl } from "./model-access/media-form.js";
import { prepareVideoParameters } from "./model-access/video-parameters.js";
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
} from "@fumiao/plugin-sdk/preparation.js";
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

/** Validate only explicitly offered image controls. References travel separately
 * from caller parameters so data URLs and provider routing fields cannot be injected. */
export function prepareImageParameters(
  route: import("./model-access/publication.js").FrozenModelRoute,
  raw: Record<string, unknown>,
  referenceCount: number,
) {
  const caps = route.capabilities;
  const fields: Record<string, unknown> = {};
  const options: Record<string, string[] | undefined> = {
    size: caps.sizes,
    resolution: caps.resolutions,
    aspect_ratio: caps.aspect_ratios,
  };
  for (const [name, value] of Object.entries(raw)) {
    const choices = options[name];
    const def = Object.hasOwn(caps.definitions ?? {}, name)
      ? caps.definitions![name]
      : undefined;
    requireValue(
      isImageControl(name) && (caps.names?.includes(name) || choices?.length),
      400,
      "线路不支持此图片参数",
    );
    requireValue(
      typeof value === "boolean" ||
        (typeof value === "string" &&
          value.length <= 128 &&
          !value.includes("\0")) ||
        (typeof value === "number" && Number.isSafeInteger(value)),
      400,
      "图片参数无效",
    );
    if (choices?.length)
      requireValue(
        typeof value === "string" && choices.includes(value),
        400,
        "图片参数超出线路范围",
      );
    if (def) {
      const valid =
        def.type === "enum"
          ? typeof value !== "boolean" && def.values.includes(value)
          : def.type === "range"
            ? typeof value === "number" && value >= def.min && value <= def.max
            : typeof value === "boolean";
      requireValue(valid, 400, "图片参数超出线路范围");
    }
    fields[name] = value;
  }
  const count = fields.n ?? 1;
  requireValue(
    typeof count === "number" &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= 16,
    400,
    "图片张数无效",
  );
  const refs = imageReferenceLimits(caps);
  requireValue(
    referenceCount >= refs.min && referenceCount <= refs.max,
    400,
    "参考图片数量不符合线路要求",
  );
  return { params: fields, count };
}

export function prepareMediaParameters(
  route: import("./model-access/publication.js").FrozenModelRoute,
  raw: Record<string, unknown>,
  referenceCount: number,
) {
  return route.purpose === "video"
    ? prepareVideoParameters(route, raw, referenceCount)
    : prepareImageParameters(route, raw, referenceCount);
}
