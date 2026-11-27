import type { FormField, ModelForm } from "@fumiao/plugin-sdk/model-form.js";
import type { FrozenModelRoute } from "./publication.js";
import { videoCapabilities } from "./video-parameters.js";

const imageFields: Record<string, [string, FormField["type"]]> = {
  n: ["图片张数", "integer"],
  size: ["尺寸", "string"],
  resolution: ["分辨率", "string"],
  aspect_ratio: ["画幅", "string"],
  quality: ["图片质量", "string"],
  background: ["背景", "string"],
  output_format: ["输出格式", "string"],
  output_compression: ["压缩程度", "integer"],
  seed: ["随机种子", "integer"],
  style: ["风格", "string"],
  moderation: ["内容审核", "string"],
  input_fidelity: ["参考图保真度", "string"],
};

export const isImageControl = (name: string) =>
  Object.hasOwn(imageFields, name);

export function imageReferenceLimits(caps: FrozenModelRoute["capabilities"]) {
  const def = caps.definitions?.input_references;
  const refs =
    caps.input_references ?? (def?.type === "range" ? def : undefined);
  const accepts =
    caps.input_modalities?.includes("image") ||
    caps.names?.includes("input_references");
  return {
    min: refs?.min ?? 0,
    max: Math.min(9, refs?.max ?? (accepts ? 9 : 0)),
  };
}

export function mediaModelForm(
  route: Pick<FrozenModelRoute, "purpose" | "protocol" | "capabilities">,
): ModelForm {
  const fields: Record<string, FormField> = {};
  const form: ModelForm = {
    canvas: true,
    parameterObject: true,
    fields,
    tiers: [],
    references: { min: 0, max: 0 },
  };
  const caps =
    route.purpose === "video"
      ? videoCapabilities(route.protocol, route.capabilities)
      : route.capabilities;
  const options: Record<string, string[] | undefined> = {
    size: caps.sizes,
    resolution: caps.resolutions,
    aspect_ratio: caps.aspect_ratios,
  };
  if (route.purpose === "video") {
    const seconds = new Set(caps.durations ?? []);
    for (
      let n = caps.duration_range?.min ?? 1;
      n <= (caps.duration_range?.max ?? 0);
      n++
    )
      seconds.add(n);
    if (caps.automatic_duration) seconds.add(-1);
    fields.seconds = {
      title: "视频时长",
      type: "integer",
      enum: [...seconds],
      default: [...seconds][0],
      optionLabels: { "-1": "自动" },
    };
    form.required = ["seconds"];
    form.references = {
      min: caps.requires_first_frame ? 1 : 0,
      max: caps.frame_images?.includes("first_frame") ? 1 : 0,
    };
  } else {
    form.references = imageReferenceLimits(route.capabilities);
  }
  for (const [name, [title, type]] of Object.entries(imageFields)) {
    const values = options[name];
    if (values?.length) fields[name] = { title, type: "string", enum: values };
    else if (route.purpose === "image" && caps.names?.includes(name)) {
      const def = caps.definitions?.[name];
      const field: FormField = { title, type };
      if (def?.type === "enum") {
        field.enum = def.values;
        field.type = typeof def.values[0] === "number" ? "integer" : "string";
      } else if (def?.type === "range") {
        Object.assign(field, {
          type: "integer",
          minimum: def.min,
          maximum: def.max,
        });
      } else if (def?.type === "boolean") field.type = "boolean";
      if (name === "n") {
        field.minimum = Math.max(1, field.minimum ?? 1);
        field.maximum = Math.min(16, field.maximum ?? 16);
        field.default =
          field.enum?.find(
            (v) =>
              typeof v === "number" &&
              v >= field.minimum! &&
              v <= field.maximum!,
          ) ?? field.minimum;
      }
      fields[name] = field;
    }
  }
  return form;
}
