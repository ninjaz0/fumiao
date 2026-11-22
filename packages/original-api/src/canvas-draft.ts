import {
  canvasExtensionSchema,
  validCanvasResult,
  type CanvasExtension,
} from "@fumiao/plugin-sdk/canvas-nodes.js";
import { requireValue } from "@fumiao/platform/security.js";
import { parseBody, type Field, type Fields } from "./validation.js";
const integer = (defaultValue?: unknown): Field => ({
  kind: "integer",
  finite: true,
  allowLargeInteger: true,
  ...(defaultValue !== undefined ? { default: defaultValue } : {}),
});
const literal = (
  values: (string | number)[],
  defaultValue?: unknown,
): Field => ({
  kind: "literal",
  values,
  pythonLiteral: true,
  ...(defaultValue !== undefined ? { default: defaultValue } : {}),
});
const list = (item: Field, max: number): Field => ({
  kind: "list",
  item,
  max,
  default: [],
});
const object = (fields: Fields): Field => ({
  kind: "object",
  fields,
  extra: true,
});
const text = (max: number, defaultValue?: string): Field => ({
  kind: "string",
  max,
  ...(defaultValue !== undefined ? { default: defaultValue } : {}),
});
const media: Field = {
  kind: "string",
  pattern: "^[a-f0-9]{32}$",
  strictPattern: true,
};
const identifier: Field = {
  kind: "string",
  pattern: "^[a-zA-Z0-9_-]{1,80}$",
  strictPattern: true,
};
const positive: Field = { ...integer(null), nullable: true, gt: 0 };
const h3Fields: Fields = {
  mode: literal(["reference", "frames"]),
  first_frame: { ...media, nullable: true, default: null },
  last_frame: { ...media, nullable: true, default: null },
  video_audio: list(media, 3),
};
export const canvasParamsFields: Fields = {
  h3: { ...object(h3Fields), nullable: true, default: null },
  h3_refs: list(media, 12),
  model: text(180, ""),
  flow_source_job: positive,
  ratio: literal(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "16:9"),
  quality: literal([480, 768], 480),
  seconds: { ...integer(5), min: 0, max: 15 },
  seed: { ...integer(null), nullable: true, min: 0, max: 2 ** 53 - 1 },
  sampling_steps: literal([16, 20, 32, 50], 20),
  fast_mode: { kind: "boolean", strict: false, default: false },
  resolution: literal(["1K", "2K", "4K"], "1K"),
  image_quality: literal(["low", "medium", "high"], "medium"),
};
export const canvasNodeFields: Fields = {
  narration_text: text(300, ""),
  narration_instruction: text(300, ""),
  narration_job: positive,
  narration_pending: positive,
  asset_packs: list(
    object({ id: media, revision: { ...integer(), min: 1 } }),
    9,
  ),
  id: identifier,
  type: literal(["text", "image", "video", "sticky", "plugin"]),
  extension: { kind: "dictionary", optional: true },
  title: text(80, ""),
  x: { kind: "float", min: -100000, max: 100000 },
  y: { kind: "float", min: -100000, max: 100000 },
  width: { kind: "float", min: 160, max: 1600, default: 320 },
  height: { kind: "float", min: 100, max: 1600, default: 240 },
  text: text(12000, ""),
  prompt: text(12000, ""),
  color: literal(
    ["none", "mint", "blue", "purple", "orange", "yellow"],
    "none",
  ),
  media_id: { ...media, nullable: true, default: null },
  active_job: positive,
  use_media: { kind: "boolean", strict: false, default: false },
  params: {
    ...object(canvasParamsFields),
    default: parseBody({}, canvasParamsFields, true),
  },
};
export const canvasDocumentFields: Fields = {
  schemaVersion: literal([1], 1),
  nodes: list(object(canvasNodeFields), 200),
  edges: list(
    object({
      id: identifier,
      source: text(80),
      target: text(80),
      sourcePort: { ...text(32), optional: true },
      targetPort: { ...text(32), optional: true },
    }),
    600,
  ),
  shots: { ...list({ kind: "string" }, 200), nullable: true, default: null },
};
export const canvasNewFields: Fields = {
  title: { ...text(80, "未命名画布"), min: 1 },
  template: {
    ...literal(["event", "product", "portrait"], null),
    nullable: true,
  },
  ratio: literal(["16:9", "9:16"], "16:9"),
};
export const canvasSaveFields: Fields = {
  expected_revision: { ...integer(), min: 1 },
  title: { ...text(80), min: 1 },
  document: object(canvasDocumentFields),
};
export const canvasRevisionFields: Fields = {
  expected_revision: { ...integer(), min: 1 },
};
export const canvasExactRevisionFields: Fields = {
  expected_revision: {
    ...canvasRevisionFields.expected_revision,
    exactInteger: true,
  },
};
export const canvasPluginRunFields: Fields = {
  ...canvasExactRevisionFields,
  uid: { kind: "uuid" },
};
export const storyboardExportFields: Fields = {
  exporter: text(120, "storyboard/mp4"),
  uid: { kind: "uuid" },
  ...canvasExactRevisionFields,
};
export const canvasRunFields: Fields = {
  ...canvasExactRevisionFields,
  price_revision: {
    ...integer(null),
    nullable: true,
    min: 1,
    exactInteger: true,
  },
  uid: { kind: "uuid" },
};
export const canvasCandidatesFields: Fields = {
  ...canvasRunFields,
  count: literal([1, 2], 1),
};
export type CanvasParams = {
  h3: {
    mode: "reference" | "frames";
    first_frame: string | null;
    last_frame: string | null;
    video_audio: string[];
  } | null;
  h3_refs: string[];
  model: string;
  flow_source_job: number | null;
  ratio: string;
  quality: number;
  seconds: number;
  seed: number | null;
  sampling_steps: number;
  fast_mode: boolean;
  resolution: string;
  image_quality: string;
};
export type CanvasNode = {
  narration_text: string;
  narration_instruction: string;
  narration_job: number | null;
  narration_pending: number | null;
  asset_packs: { id: string; revision: number }[];
  id: string;
  type: "text" | "image" | "video" | "sticky" | "plugin";
  extension?: CanvasExtension;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  prompt: string;
  color: string;
  media_id: string | null;
  active_job: number | null;
  use_media: boolean;
  params: CanvasParams;
};
export type CanvasDocument = {
  schemaVersion: 1;
  nodes: CanvasNode[];
  edges: {
    id: string;
    source: string;
    target: string;
    sourcePort?: string;
    targetPort?: string;
  }[];
  shots?: string[];
};
/** Pydantic excludes shots only when None; an explicit empty list stays visible. */
export function canvasDocumentValue(
  value: Record<string, any>,
): CanvasDocument {
  const result = { ...value };
  for (const node of result.nodes) {
    requireValue(
      (node.type === "plugin") === (node.extension !== undefined),
      422,
      "插件节点声明无效",
    );
    if (node.extension) {
      const parsed = canvasExtensionSchema.safeParse(node.extension);
      requireValue(parsed.success, 422, "插件节点参数无效");
      const { definition, result: outputs } = parsed.data;
      requireValue(
        !outputs || validCanvasResult(definition.outputs, outputs),
        422,
        "插件节点输出无效",
      );
      node.extension = parsed.data;
    }
  }
  if (result.shots === null) delete result.shots;
  return result as CanvasDocument;
}
export function parseCanvasDocument(value: unknown): CanvasDocument {
  return canvasDocumentValue(
    parseBody({ document: value }, { document: object(canvasDocumentFields) })
      .document,
  );
}
export function parseCanvasSave(value: unknown) {
  const body = parseBody(value, canvasSaveFields, true);
  return {
    expected_revision: body.expected_revision as number,
    title: body.title as string,
    document: canvasDocumentValue(body.document),
  };
}
