import { requireValue } from "../security.js";
import type { DeclaredParameters } from "./discovery.js";

const deliverable = ["png", "jpeg", "webp"];

function formatName(value: unknown) {
  const name =
    typeof value === "string"
      ? value.toLowerCase().replace(/^image\//, "")
      : "";
  return name === "jpg" ? "jpeg" : name;
}

/** UI choices use standard format names. The upstream receives its own enum spelling. */
export function imageFormats(caps: DeclaredParameters) {
  const formats = new Map<string, string>();
  if (caps.unconfirmed_parameters?.includes("output_format")) return formats;
  const definition = caps.definitions?.output_format;
  if (!definition && !caps.names?.includes("output_format")) return;
  const values = definition
    ? definition.type === "enum"
      ? definition.values
      : []
    : deliverable;
  for (const value of values) {
    const name = formatName(value);
    if (
      typeof value === "string" &&
      deliverable.includes(name) &&
      !formats.has(name)
    )
      formats.set(name, value);
  }
  return formats;
}

export function imageCapabilities<T extends DeclaredParameters>(caps: T): T {
  if (!caps.definitions?.output_format) return caps;
  const formats = imageFormats(caps)!;
  const preferred = defaultImageFormat(caps, formats);
  return {
    ...caps,
    output_format_default: preferred ? formats.get(preferred) : undefined,
    definitions: {
      ...caps.definitions,
      output_format: {
        type: "enum",
        values: [...formats.values()],
      },
    },
  };
}

export function defaultImageFormat(
  caps: DeclaredParameters,
  formats: Map<string, string>,
) {
  if (!caps.definitions?.output_format) return;
  const preferred = formatName(caps.output_format_default);
  return formats.has(preferred) ? preferred : formats.keys().next().value;
}

export function imageOutputFormat(
  caps: DeclaredParameters,
  selected?: unknown,
) {
  const formats = imageFormats(caps);
  requireValue(
    formats?.size !== 0,
    409,
    "此线路没有可交付的 PNG、JPEG 或 WebP 图片格式",
  );
  if (selected === undefined) {
    // An undeclared default still works for existing and manually added routes.
    const fallback = formats && defaultImageFormat(caps, formats);
    return fallback ? formats?.get(fallback) : undefined;
  }
  const wire = formats?.get(formatName(selected));
  requireValue(wire, 400, "线路不支持此图片输出格式");
  return wire;
}
