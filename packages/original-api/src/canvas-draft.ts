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
export const dialogueLineFields: Fields = {
  id: identifier,
  speaker: text(40, ""),
  text: text(300, ""),
  pack_id: { ...media, nullable: true, optional: true },
  voice_id: { ...text(120), optional: true },
  model: { ...text(180), optional: true },
  instruction: { ...text(300), optional: true },
  audio_job: { ...positive, optional: true },
  audio_pending: { ...positive, optional: true },
};
export const canvasBgmFields: Fields = {
  asset_id: { ...media, nullable: true, default: null },
  volume: { kind: "float", min: 0.02, max: 1, default: 0.35 },
  ducking: { kind: "boolean", strict: false, default: true },
  loop: { kind: "boolean", strict: false, default: true },
};
export const cinematographyFields: Fields = {
  shot_size: { ...text(40), optional: true },
  camera_angle: { ...text(40), optional: true },
  camera_movement: { ...text(40), optional: true },
  lighting: { ...text(40), optional: true },
  lens: { ...text(40), optional: true },
  mood: { ...text(40), optional: true },
};
export const canvasNodeFields: Fields = {
  narration_text: text(300, ""),
  narration_instruction: text(300, ""),
  narration_model: { ...text(80), optional: true },
  narration_job: positive,
  narration_pending: positive,
  audio_strategy: {
    ...literal(["replace", "keep_original", "mix"]),
    optional: true,
  },
  original_audio_gain: { kind: "float", min: 0, max: 1, optional: true },
  tail_inherited: { kind: "boolean", strict: false, optional: true },
  dialogue_lines: { ...list(object(dialogueLineFields), 20), optional: true },
  parent_id: { ...identifier, nullable: true, optional: true },
  generation_mode: {
    ...literal(["first_frame", "first_last_frame", "omni_ref", "grid_preview"]),
    optional: true,
  },
  grid_layout: { ...literal(["2x2", "3x3"]), nullable: true, optional: true },
  cinematography: {
    ...object(cinematographyFields),
    nullable: true,
    optional: true,
  },
  extra_params: { kind: "dictionary", nullable: true, optional: true },
  asset_packs: list(
    object({ id: media, revision: { ...integer(), min: 1 } }),
    9,
  ),
  id: identifier,
  type: literal(["text", "image", "video", "sticky", "plugin", "group"]),
  extension: { kind: "dictionary", optional: true },
  title: text(80, ""),
  x: { kind: "float", min: -100000, max: 100000 },
  y: { kind: "float", min: -100000, max: 100000 },
  width: { kind: "float", min: 160, max: 3200, default: 320 },
  height: { kind: "float", min: 100, max: 3200, default: 240 },
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
  nodes: list(object(canvasNodeFields), 400),
  edges: list(
    object({
      id: identifier,
      source: text(80),
      target: text(80),
      sourcePort: { ...text(32), optional: true },
      targetPort: { ...text(32), optional: true },
    }),
    1200,
  ),
  shots: { ...list({ kind: "string" }, 200), nullable: true, default: null },
  bgm: { ...object(canvasBgmFields), nullable: true, optional: true },
  loudnorm: { kind: "boolean", strict: false, optional: true },
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
  bgm_asset: { ...media, nullable: true, optional: true },
  bgm_volume: { kind: "float", min: 0.02, max: 1, optional: true },
  bgm_ducking: { kind: "boolean", strict: false, optional: true },
  loudnorm: { kind: "boolean", strict: false, optional: true },
  ...canvasExactRevisionFields,
};
export const canvasDialogueRunFields: Fields = {
  ...canvasExactRevisionFields,
  price_revision: {
    ...integer(null),
    nullable: true,
    min: 1,
    exactInteger: true,
  },
  uid: { kind: "uuid" },
  line_id: { ...identifier, optional: true },
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
const batchStageField = literal(["image", "video", "narration", "dialogue"]);
export const canvasBatchPrecheckFields: Fields = {
  expected_revision: { ...integer(null), nullable: true, min: 1 },
  node_ids: { ...list(identifier, 120), min: 1 },
  stages: {
    ...list(batchStageField, 4),
    default: ["image", "video"],
  },
};
export const canvasBatchRunFields: Fields = {
  ...canvasRunFields,
  node_ids: { ...list(identifier, 120), min: 1 },
  stages: {
    ...list(batchStageField, 4),
    default: ["image", "video"],
  },
  precheck_token: { kind: "string", max: 128, optional: true },
  expected_total_credits: { kind: "integer", min: 0, max: 100_000_000, optional: true },
  executable_keys: {
    kind: "list",
    item: { kind: "string", min: 1, max: 160 },
    max: 480,
    optional: true,
  },
};
export const canvasGridCropFields: Fields = {
  rows: literal([2, 3], 3),
  cols: literal([2, 3], 3),
  row: { ...integer(0), min: 0, max: 2 },
  col: { ...integer(0), min: 0, max: 2 },
};
export const batchQuoteItemFields: Fields = {
  kind: literal(["image", "video", "audio"]),
  model: text(180, ""),
  seconds: { ...integer(5), min: 0, max: 15, optional: true },
  quality: { ...literal([480, 768]), optional: true },
  resolution: { ...literal(["1K", "2K", "4K"]), optional: true },
  image_quality: { ...literal(["low", "medium", "high"]), optional: true },
  ratio: {
    ...literal(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    optional: true,
  },
  count: { ...integer(1), min: 1, max: 20, optional: true },
};
export const batchQuoteFields: Fields = {
  items: { ...list(object(batchQuoteItemFields), 120), min: 1 },
};
export const seriesCreateFields: Fields = {
  title: { kind: "string", min: 1, max: 120 },
  synopsis: { kind: "string", max: 4000, default: "" },
  bible: { kind: "dictionary", optional: true },
};
export const seriesUpdateFields: Fields = {
  expected_revision: { kind: "integer", min: 1 },
  title: { kind: "string", min: 1, max: 120, optional: true },
  synopsis: { kind: "string", max: 4000, optional: true },
  bible: { kind: "dictionary", optional: true },
};
export const episodeCreateFields: Fields = {
  season_no: { kind: "integer", min: 1, max: 99, default: 1 },
  episode_no: { kind: "integer", min: 1, max: 999 },
  title: { kind: "string", min: 1, max: 120 },
  status: {
    kind: "literal",
    values: ["draft", "producing", "review", "done"],
    default: "draft",
  },
  canvas_id: {
    kind: "string",
    pattern: "^[a-f0-9]{32}$",
    strictPattern: true,
    nullable: true,
    optional: true,
  },
};
export const episodeUpdateFields: Fields = {
  expected_revision: { kind: "integer", min: 1 },
  season_no: { kind: "integer", min: 1, max: 99, optional: true },
  episode_no: { kind: "integer", min: 1, max: 999, optional: true },
  title: { kind: "string", min: 1, max: 120, optional: true },
  status: {
    kind: "literal",
    values: ["draft", "producing", "review", "done"],
    optional: true,
  },
};
export const sceneCreateFields: Fields = {
  scene_no: { kind: "integer", min: 1, max: 999 },
  title: { kind: "string", min: 1, max: 120 },
  summary: { kind: "string", max: 2000, default: "" },
  canvas_id: { kind: "string", max: 64, nullable: true, optional: true },
  group_node_id: { kind: "string", max: 80, nullable: true, optional: true },
  create_canvas: { kind: "boolean", strict: false, default: true },
};
export const sceneUpdateFields: Fields = {
  scene_no: { kind: "integer", min: 1, max: 999, optional: true },
  title: { kind: "string", min: 1, max: 120, optional: true },
  summary: { kind: "string", max: 2000, optional: true },
  group_node_id: { kind: "string", max: 80, nullable: true, optional: true },
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
export type DialogueLine = {
  id: string;
  speaker: string;
  text: string;
  pack_id?: string | null;
  voice_id?: string;
  model?: string;
  instruction?: string;
  audio_job?: number | null;
  audio_pending?: number | null;
};
export type CanvasBgm = {
  asset_id: string | null;
  volume: number;
  ducking: boolean;
  loop: boolean;
};
export type CinematographySpec = {
  shot_size?: string;
  camera_angle?: string;
  camera_movement?: string;
  lighting?: string;
  lens?: string;
  mood?: string;
};
export type CanvasGenerationMode =
  | "first_frame"
  | "first_last_frame"
  | "omni_ref"
  | "grid_preview";
export type CanvasNode = {
  narration_text: string;
  narration_instruction: string;
  narration_model?: string;
  narration_job: number | null;
  narration_pending: number | null;
  audio_strategy?: "replace" | "keep_original" | "mix";
  original_audio_gain?: number;
  tail_inherited?: boolean;
  dialogue_lines?: DialogueLine[];
  parent_id?: string | null;
  generation_mode?: CanvasGenerationMode;
  grid_layout?: "2x2" | "3x3" | null;
  cinematography?: CinematographySpec | null;
  extra_params?: Record<string, unknown> | null;
  asset_packs: { id: string; revision: number }[];
  id: string;
  type: "text" | "image" | "video" | "sticky" | "plugin" | "group";
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
  bgm?: CanvasBgm | null;
  loudnorm?: boolean;
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
