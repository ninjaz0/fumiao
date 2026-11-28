import type { CanvasExtension, CanvasNodeEntry } from "@fumiao/plugin-sdk/canvas-nodes";
import {acceptsCanvasEdge,canvasSourceKind} from "@fumiao/plugin-sdk/canvas-ports";
import {
  mediaDownloadFilename,
  normalizeMediaMime,
} from "@fumiao/plugin-sdk/media-filename";
import {
  isBgmMusicModel,
  pickSpeechAudioModel,
  resolveDialogueVoiceProfile,
  type SpeechPackCandidate,
} from "@fumiao/plugin-sdk/speech-routing";
import { matchChoiceMenuRect } from "./choice-menu-position";
export type Kind = "text" | "image" | "video" | "sticky" | "plugin" | "group";
export type CanvasGenerationMode =
  | "first_frame"
  | "first_last_frame"
  | "omni_ref"
  | "grid_preview";
export type CinematographySpec = {
  shot_size?: string;
  camera_angle?: string;
  camera_movement?: string;
  lighting?: string;
  lens?: string;
  mood?: string;
};
export type PrecheckStage = "image" | "video" | "narration" | "dialogue";
export type PrecheckItem = {
  node_id: string;
  title: string;
  node_type: Kind;
  stage: PrecheckStage;
  model: string;
  credits: number;
  exact_credits?: string;
  status: "ready" | "warning" | "blocked";
  issues: string[];
};
export type PrecheckResponse = {
  revision: number;
  stale_revision: boolean;
  price_revision: number;
  precheck_token?: string;
  executable_keys?: string[];
  items: PrecheckItem[];
  summary: {
    total: number;
    ready: number;
    warning: number;
    blocked: number;
    runnable: number;
    total_credits: number;
    available_credits: number;
    exact_total_credits?: string;
    exact_available_credits?: string;
    sufficient: boolean;
    budget_blocked?: boolean;
    budget_blocks?: string[];
    budget_warnings?: string[];
  };
};
export type H3Options = {mode:"reference"|"frames";first_frame?:string|null;last_frame?:string|null;video_audio?:string[]};
export type Params = {
  h3?: H3Options|null;
  h3_refs?: string[];
  model: string;
  ratio: string;
  quality: 480 | 768;
  seconds: number;
  flow_source_job?: number | null;
  seed: number | null;
  sampling_steps: 16 | 20 | 32 | 50;
  fast_mode: boolean;
  resolution: "1K" | "2K" | "4K";
  image_quality: "low" | "medium" | "high";
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
export type CanvasNode = {
  narration_text?:string;
  narration_instruction?:string;
  narration_model?:string;
  narration_job?:number|null;
  narration_pending?:number|null;
  audio_strategy?: "replace" | "keep_original" | "mix";
  original_audio_gain?: number;
  tail_inherited?: boolean;
  dialogue_lines?: DialogueLine[];
  parent_id?: string | null;
  generation_mode?: CanvasGenerationMode;
  grid_layout?: "2x2" | "3x3" | null;
  cinematography?: CinematographySpec | null;
  extra_params?: Record<string, unknown> | null;
  asset_packs?: {id:string;revision:number;name?:string}[];
  id: string;
  type: Kind;
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
  use_media?: boolean;
  params: Params;
};
export type CanvasEdge = { id: string; source: string; target: string; sourcePort?:string; targetPort?:string };
export type Doc = {
  schemaVersion: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  shots?: string[];
  bgm?: CanvasBgm | null;
  bgm_applied_job?: number | null;
  loudnorm?: boolean;
};
export type Draft = { title: string; document: Doc };
export type Project = Draft & {
  workspace: number;
  id: string;
  revision: number;
  owner: number;
  last_editor: number;
  created: number;
  updated: number;
  archived_at: number | null;
  can_delete: boolean;
  count?: number;
  covers?: { id: string; type: string }[];
};
export type Job = {
  model_label?: string;
  batch?:{uid:string;index:number;count:number}|null;
  inputs?: {instruction?:string;prompt?:string;refs?:string[];params?:Params;asset_packs?:{id:string;revision:number}[]};
  actual?: {width:number;height:number;duration?:number;flow_media_id?:string;flow_source_job?:number};
  id: number;
  canvas_node?: string;
  uid?: string;
  owner: number;
  kind: "image" | "video" | "audio";
  status: string;
  result: string | null;
  result_mime?: string;
  note: string;
  prompt: string;
  refs: string[];
  width: number;
  height: number;
  created: number;
  seconds: number;
  sampling_steps?: number;
  seed?: number | null;
  quality: number;
  ratio: string;
  image_quality: string;
  model: string;
  eta?: any;
  timing?: any;
};
export type Asset = {kind?:string;mime?:string;seconds?:number;has_audio?:boolean;name?:string; id: string; w: number; h: number; owner: number };
export type FlowModel = {kind:string;label:string;provider?:string;family?:string;family_label?:string;hidden?:boolean;mode?:string;ratio?:string;seconds?:number;resolution?:string;min_refs?:number;max_refs?:number};
export type Studio = {
  studio_plugins?: boolean;
  model_groups?: Record<string, { kind: string; label: string; models: string[] }>;
  team_model_policies?: Record<string, { revision: number; enabled: Record<string, boolean> }>;
  canvas_nodes?: CanvasNodeEntry[];
  canvas_speech_models?: string[];
  canvas_speech_default_models?: string[];
  model_forms: Record<string, import("@fumiao/plugin-sdk/model-form").ModelForm>;
  model_catalog: Record<string,FlowModel>;
  video_models: Record<string,string>;
  flow?: {configured:boolean;ready:boolean};
  model_policy: {revision:number;enabled:Record<string,boolean>};
  model_access: Record<string,boolean>;
  credits: {available:number;reserved:number;exact?:{available:string;balance:string;reserved:string}};
  pricing: {revision:number;published?:{model:string;price:{kind:string}}[];items:{key:string;amount:number|null}[]};
  workspace_id: number;
  workspaces: {id:number;name:string;kind:string}[];
  me: {
    id: number;
    role: string;
    name: string;
    nickname: string;
    avatar_url?: string;
  };
  jobs: Job[];
  assets: Asset[];
  images: {
    models: Record<string,string>;
    configured: boolean;
    enabled: boolean;
    default_model: string;
    sizes: Record<string, number[]>;
  };
  ratios: string[];
  sizes: Record<string, number[]>;
};
export const defaults: Params = {
  model: "",
  ratio: "16:9",
  quality: 480,
  seconds: 5,
  seed: null,
  sampling_steps: 20,
  fast_mode: false,
  resolution: "1K",
  image_quality: "medium",
};
export const names: Record<Kind, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  sticky: "便签",
  plugin: "插件",
  group: "工作流组",
};
export const newNode = (
  type: Kind,
  x: number,
  y: number,
  count: number,
): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  title: names[type] + " " + count,
  x,
  y,
  width: type === "group" ? 720 : 320,
  height: type === "group" ? 440 : 240,
  text: "",
  prompt: "",
  color: type === "sticky" ? "yellow" : type === "group" ? "blue" : "none",
  media_id: null,
  active_job: null,
  params: { ...defaults },
});
export function resolveNode(node: CanvasNode, runs: Job[]) {
  const list = runs.filter((j) => j.canvas_node === node.id);
  const latest = list[0];
  const run = node.use_media
    ? undefined
    : node.active_job
      ? list.find((j) => j.id === node.active_job)
      : latest;
  return {
    run,
    latest,
    list,
    media: run ? (run.status === "done" ? run.result : null) : node.media_id,
  };
}
export function linkedValue(node: CanvasNode, edge: CanvasEdge, runs: Job[]) {
  const kind = canvasSourceKind(node, edge.sourcePort);
  const value = node.extension
    ? node.extension.result?.[edge.sourcePort!]
    : kind === "text"
      ? node.text
      : resolveNode(node, runs).media;
  return { kind, value };
}
export function connectionError(
  doc: Doc,
  source: string,
  target: string,
  from?: string | null,
  to?: string | null,
): string {
  const a = doc.nodes.find((n) => n.id === source),
    b = doc.nodes.find((n) => n.id === target);
  if (!a || !b || source === target || !acceptsCanvasEdge(a, b, from, to))
    return "这两个节点不能连接";
  if (
    b.type === "plugin" &&
    doc.edges.some((e) => e.target === target && e.targetPort === to)
  )
    return "插件输入端口已连接";
  if (
    doc.edges.some(
      (e) =>
        e.source === source &&
        e.target === target &&
        e.sourcePort === (from ?? undefined) &&
        e.targetPort === (to ?? undefined),
    )
  )
    return "已经连接";
  if (
    canvasSourceKind(a, from) === "image" &&
    doc.edges.filter(
      (e) =>
        e.target === target &&
        canvasSourceKind(
          doc.nodes.find((n) => n.id === e.source)!,
          e.sourcePort,
        ) === "image",
    ).length >= 9
  )
    return "最多连接 9 张参考图片";
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return "连线不能形成循环";
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(
      ...doc.edges.filter((e) => e.source === id).map((e) => e.target),
    );
  }
  return "";
}

export function videoSeconds(job?:Job){
  if(job?.actual?.duration)return job.actual.duration;
  if(job?.model==='MiniMax H3')return ({5:124,10:243,15:362}[job.seconds]||job.seconds*24)/24;
  return job?.seconds||0;
}

export const PASTE_OFFSET = 56;

export type CanvasClipboard = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  pasteCount: number;
  anchor?: { x: number; y: number };
};

export function createClipboardSnapshot(
  doc: Doc,
  selectedIds: string[],
): CanvasClipboard | null {
  if (!selectedIds.length) return null;
  const ids = new Set(selectedIds);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  if (!nodes.length) return null;
  const matched = new Set(nodes.map((n) => n.id));
  const edges = doc.edges.filter(
    (e) => matched.has(e.source) && matched.has(e.target),
  );
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
    pasteCount: 0,
  };
}

export function resolvePasteOffset(
  nodes: CanvasNode[],
  options: {
    duplicate?: boolean;
    point?: { x: number; y: number };
    pasteCount?: number;
    anchor?: { x: number; y: number };
  } = {},
): {
  dx: number;
  dy: number;
  nextPasteCount: number;
  nextAnchor?: { x: number; y: number };
} {
  if (options.duplicate || !nodes.length) {
    return {
      dx: PASTE_OFFSET,
      dy: PASTE_OFFSET,
      nextPasteCount: options.pasteCount ?? 0,
      nextAnchor: options.anchor,
    };
  }
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  if (options.point) {
    return {
      dx: options.point.x - minX,
      dy: options.point.y - minY,
      nextPasteCount: 0,
      nextAnchor: { x: options.point.x, y: options.point.y },
    };
  }
  const nextPasteCount = (options.pasteCount ?? 0) + 1;
  const baseX = options.anchor ? options.anchor.x : minX;
  const baseY = options.anchor ? options.anchor.y : minY;
  return {
    dx: baseX - minX + nextPasteCount * PASTE_OFFSET,
    dy: baseY - minY + nextPasteCount * PASTE_OFFSET,
    nextPasteCount,
    nextAnchor: options.anchor,
  };
}

export function nextContextSelection(
  selectedIds: string[],
  nodeId: string,
): string[] {
  return selectedIds.includes(nodeId) ? selectedIds : [nodeId];
}

export function collectDownloadTargets(nodes: CanvasNode[], runs: Job[]) {
  const media = nodes
    .map((n) => resolveNode(n, runs).media)
    .filter((id): id is string => Boolean(id));
  const text = nodes.filter((n) => n.type === "text" || n.type === "sticky");
  return {
    media,
    text,
    hasDownloadable: media.length > 0 || text.length > 0,
  };
}

export function hasDownloadableNodes(nodes: CanvasNode[], runs: Job[]): boolean {
  return collectDownloadTargets(nodes, runs).hasDownloadable;
}

export function textDownloadFilename(
  currentTitle: string | null | undefined,
  fallbackTitle: string,
): string {
  const base = currentTitle?.trim()
    ? currentTitle
    : fallbackTitle || "未命名画布";
  return base + ".txt";
}

export function canvasMediaDownloadFilename(
  key: string,
  options: {
    runs?: readonly Job[];
    studio?: Pick<Studio, "jobs" | "assets">;
    node?: Pick<CanvasNode, "type"> | null;
    run?: Job;
  } = {},
): string | undefined {
  const asset = options.studio?.assets.find((a) => a.id === key);
  if (asset) {
    const mime =
      normalizeMediaMime(asset.mime) ||
      (asset.kind === "ref_video"
        ? "video/mp4"
        : asset.kind === "ref_audio"
          ? "audio/wav"
          : undefined);
    if (mime || asset.name)
      return mediaDownloadFilename(key, mime, asset.name);
  }
  const job =
    (options.run?.result === key ? options.run : undefined) ??
    options.runs?.find((j) => j.result === key) ??
    options.studio?.jobs.find((j) => j.result === key);
  if (job) {
    const mime =
      normalizeMediaMime(job.result_mime) ||
      (job.kind === "video"
        ? "video/mp4"
        : job.kind === "audio"
          ? "audio/wav"
          : undefined);
    if (mime) return mediaDownloadFilename(key, mime);
  }
  if (options.node?.type === "video") {
    return mediaDownloadFilename(key, "video/mp4");
  }
  return undefined;
}

export function shouldRedirectRunsError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403 || status === 404;
}

export function formatRunsError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "加载生成历史失败，请重试";
}

export type HistoryModalState =
  | { kind: "list"; items: Job[]; error: string }
  | { kind: "error"; items: []; error: string }
  | { kind: "loading"; items: []; error: "" }
  | { kind: "empty"; items: []; error: "" };

export function resolveHistoryModalState(input: {
  runs: readonly Job[];
  loading: boolean;
  loaded: boolean;
  error: string;
}): HistoryModalState {
  const items = input.runs.filter((j) => j.kind !== "audio");
  const error = input.error.trim();
  if (items.length > 0) {
    return { kind: "list", items, error };
  }
  if (error) {
    return { kind: "error", items: [], error };
  }
  if (input.loading || !input.loaded) {
    return { kind: "loading", items: [], error: "" };
  }
  return { kind: "empty", items: [], error: "" };
}

export function resolveFocusTargets(
  nodes: readonly Pick<CanvasNode, "id">[],
  ids: readonly string[],
): string[] {
  if (!ids.length) return [];
  const existing = new Set(nodes.map((n) => n.id));
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (existing.has(id) && !seen.has(id)) {
      seen.add(id);
      targets.push(id);
    }
  }
  return targets;
}

export type ViewportFocusShortcut = "fit-all" | "fit-selected" | null;

export function matchViewportFocusShortcut(event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  code?: string;
  key: string;
}): ViewportFocusShortcut {
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }
  if (event.code === "Digit1") return "fit-all";
  if (event.code === "Digit2") return "fit-selected";
  if (event.key === "!") return "fit-all";
  if (event.key === "@") return "fit-selected";
  return null;
}

export function isCanvasComposerOpen(
  single: Pick<CanvasNode, "type"> | null,
  editing: string | null,
): boolean {
  return Boolean(
    single && !editing && ["image", "video", "text", "plugin"].includes(single.type),
  );
}

export function hasCanvasSelectionToolbar(
  single: Pick<CanvasNode, "id"> | null,
  editing: string | null,
): boolean {
  return Boolean(single && !editing);
}

export type BatchShotPlan = {
  videoIds: string[];
  addedIds: string[];
  nextShots: string[];
  allInShots: boolean;
};

export function resolveBatchShots(
  nodes: readonly Pick<CanvasNode, "id" | "type">[],
  selectedIds: readonly string[],
  existingShots: readonly string[] = [],
): BatchShotPlan {
  const selectedSet = new Set(selectedIds);
  const videoIds: string[] = [];
  const seenVideos = new Set<string>();
  for (const node of nodes) {
    if (
      node.type === "video" &&
      selectedSet.has(node.id) &&
      !seenVideos.has(node.id)
    ) {
      seenVideos.add(node.id);
      videoIds.push(node.id);
    }
  }
  const inShots = new Set(existingShots);
  const addedIds = videoIds.filter((id) => !inShots.has(id));
  return {
    videoIds,
    addedIds,
    nextShots: addedIds.length
      ? [...existingShots, ...addedIds]
      : [...existingShots],
    allInShots: videoIds.length > 0 && addedIds.length === 0,
  };
}

export function videoModelAcceptsSingleFirstFrame(
  studio: Pick<Studio, "video_models" | "model_catalog" | "model_forms">,
  modelId: string,
  availableModel: (model: string) => boolean,
): boolean {
  if (!modelId || !availableModel(modelId)) return false;
  const inVideoModels = Boolean(
    studio.video_models && Object.hasOwn(studio.video_models, modelId),
  );
  const spec = studio.model_catalog?.[modelId];
  if (!inVideoModels && spec?.kind !== "video") return false;
  if (spec?.mode === "extend") return false;
  if (typeof spec?.min_refs === "number" && spec.min_refs > 1) return false;
  if (typeof spec?.max_refs === "number" && spec.max_refs < 1) return false;
  const form = studio.model_forms?.[modelId];
  if (!form) return false;
  if (form.references.min > 1 || form.references.max < 1) return false;
  if (form.references.counts && form.references.counts.image < 1) return false;
  return true;
}

function flowVideoStem(modelId: string): string {
  if (!modelId.startsWith("flow:")) return "";
  return modelId
    .replace(/-(?:i2v|r2v|t2v|extend|omni)(?=-|$)/g, "")
    .replace(/-\d+s-(?:landscape|portrait|square|four-three|three-four).*$/, "");
}

export function resolveNextShotVideoModel(
  studio: Pick<Studio, "video_models" | "model_catalog" | "model_forms">,
  sourceModel: string | undefined,
  want: { ratio?: string; seconds?: number },
  availableModel: (model: string) => boolean,
): string {
  if (
    sourceModel &&
    videoModelAcceptsSingleFirstFrame(studio, sourceModel, availableModel)
  ) {
    return sourceModel;
  }
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const id of [
    ...Object.keys(studio.video_models || {}),
    ...Object.keys(studio.model_catalog || {}),
  ]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (videoModelAcceptsSingleFirstFrame(studio, id, availableModel)) {
      candidates.push(id);
    }
  }
  if (!candidates.length) return "";

  const srcFamily = sourceModel
    ? studio.model_catalog?.[sourceModel]?.family || ""
    : "";
  const srcStem = sourceModel ? flowVideoStem(sourceModel) : "";
  const modeRank = (mode?: string) =>
    mode === "i2v" ? 0 : mode === "omni" ? 1 : mode === "r2v" ? 2 : 3;

  const indexed = candidates.map((id, index) => {
    const spec = studio.model_catalog?.[id];
    const form = studio.model_forms?.[id];
    const sameGroup =
      (srcFamily && spec?.family === srcFamily) ||
      (srcStem && flowVideoStem(id) === srcStem)
        ? 0
        : 1;
    const ratioMatches =
      want.ratio &&
      (spec?.ratio === want.ratio ||
        form?.fields?.ratio?.enum?.includes(want.ratio))
        ? 0
        : 1;
    const secDiff =
      want.seconds && typeof spec?.seconds === "number" && spec.seconds > 0
        ? Math.abs(spec.seconds - want.seconds)
        : 0;
    return {
      id,
      index,
      sameGroup,
      modeScore: sameGroup === 0 ? modeRank(spec?.mode) : 0,
      ratioMatches,
      secDiff,
    };
  });

  indexed.sort(
    (a, b) =>
      a.sameGroup - b.sameGroup ||
      a.modeScore - b.modeScore ||
      a.ratioMatches - b.ratioMatches ||
      a.secDiff - b.secDiff ||
      a.index - b.index,
  );
  return indexed[0].id;
}

export type NextShotContinuation = {
  model: string;
  label: string;
  switched: boolean;
  shotTitle: string;
  previewHint: string;
  previewButtonLabel: string;
};

export function resolveNextShotContinuation(
  studio: Pick<Studio, "video_models" | "model_catalog" | "model_forms">,
  sourceModel: string | undefined,
  want: { ratio?: string; seconds?: number },
  availableModel: (model: string) => boolean,
  resolveLabel: (model: string) => string,
): NextShotContinuation | null {
  const model = resolveNextShotVideoModel(
    studio,
    sourceModel,
    want,
    availableModel,
  );
  if (!model) return null;
  const label = resolveLabel(model) || model;
  const switched = Boolean(sourceModel && sourceModel !== model);
  return {
    model,
    label,
    switched,
    shotTitle: switched
      ? `抽取尾帧并用 ${label} 续接下一镜`
      : `抽取尾帧续接下一镜（${label}）`,
    previewHint: `，或设为 ${label} 下一镜头的首帧。`,
    previewButtonLabel: switched
      ? `用作 ${label} 下一镜头首帧`
      : "用作下一镜头首帧",
  };
}

export type CinePopoverSide =
  | "right"
  | "left"
  | "top"
  | "bottom"
  | "viewport";

export type CinePopoverPlacement = {
  side: CinePopoverSide;
  verticalAlign: "top" | "bottom";
  maxHeight: number;
  fixedTop?: number;
  fixedRight?: number;
};

export type CinePopoverInput = {
  composerLeft: number;
  composerTop?: number;
  composerWidth?: number;
  composerHeight?: number;
  windowWidth: number;
  windowHeight?: number;
  headerBottom?: number;
  dockedWidth?: number;
  viewMode?: "canvas" | "split" | "list";
  agentDock?: boolean;
  agentDockedWidth?: number;
};

export function resolveCinePopoverPlacement(
  input: CinePopoverInput,
): CinePopoverPlacement {
  const composerWidth = input.composerWidth ?? 520;
  const composerHeight = input.composerHeight ?? 240;
  const windowHeight = input.windowHeight ?? 840;
  const headerBottom = Math.max(56, input.headerBottom ?? 60);
  const safeTop = headerBottom + 8;
  const safeBottom = Math.max(safeTop + 120, windowHeight - 12);
  const dockedWidth =
    input.dockedWidth ??
    (input.viewMode === "split" ? Math.min(520, input.windowWidth * 0.46) : 0) +
      (input.agentDockedWidth ?? (input.agentDock ? 400 : 0));
  const rightLimit = input.windowWidth - dockedWidth - 12;
  const leftLimit = 76;
  const composerTop =
    input.composerTop ?? Math.max(safeTop, windowHeight - composerHeight - 32);
  const composerBottom = composerTop + composerHeight;

  const sideVertical = (): Pick<
    CinePopoverPlacement,
    "verticalAlign" | "maxHeight"
  > => {
    const upHeight = composerBottom - safeTop;
    const downHeight = safeBottom - composerTop;
    if (upHeight < 240 && downHeight > upHeight) {
      return {
        verticalAlign: "top",
        maxHeight: Math.min(360, Math.max(150, downHeight)),
      };
    }
    return {
      verticalAlign: "bottom",
      maxHeight: Math.min(360, Math.max(150, upHeight)),
    };
  };

  if (input.composerLeft + composerWidth + 352 <= rightLimit) {
    return { side: "right", ...sideVertical() };
  }
  if (input.composerLeft - 352 >= leftLimit) {
    return { side: "left", ...sideVertical() };
  }

  if (input.composerTop === undefined) {
    return {
      side: "top",
      verticalAlign: "bottom",
      maxHeight: Math.min(360, Math.max(160, safeBottom - safeTop)),
    };
  }

  const spaceAbove = composerTop - 10 - safeTop;
  const spaceBelow = safeBottom - (composerBottom + 10);
  if (spaceAbove >= 200 && (spaceAbove >= spaceBelow || spaceBelow < 200)) {
    return {
      side: "top",
      verticalAlign: "bottom",
      maxHeight: Math.min(360, Math.floor(spaceAbove)),
    };
  }
  if (spaceBelow >= 200) {
    return {
      side: "bottom",
      verticalAlign: "top",
      maxHeight: Math.min(360, Math.floor(spaceBelow)),
    };
  }

  return {
    side: "viewport",
    verticalAlign: "top",
    fixedTop: safeTop,
    fixedRight: Math.max(12, Math.round(dockedWidth + 16)),
    maxHeight: Math.min(360, Math.max(140, Math.floor(safeBottom - safeTop))),
  };
}

export function resolveCinePopoverSide(
  input: CinePopoverInput,
): CinePopoverSide {
  return resolveCinePopoverPlacement(input).side;
}

export type OptionMenuFloatingRect = {
  direction: "up" | "down";
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function resolveOptionMenuFloatingRect(input: {
  triggerRect: {
    top: number;
    bottom: number;
    left: number;
    width: number;
  };
  windowWidth: number;
  windowHeight: number;
  preferredDirection?: "down" | "up";
  safeTop?: number;
  safeBottomMargin?: number;
}): OptionMenuFloatingRect {
  const safeTop = input.safeTop ?? 8;
  const safeBottomMargin = input.safeBottomMargin ?? 8;
  const safeBottom = input.windowHeight - safeBottomMargin;
  const gap = 5;
  const spaceBelow = Math.floor(safeBottom - (input.triggerRect.bottom + gap));
  const spaceAbove = Math.floor(input.triggerRect.top - gap - safeTop);
  const pref = input.preferredDirection ?? "down";

  const direction: "up" | "down" =
    (pref === "up" && (spaceAbove >= 150 || spaceAbove >= spaceBelow)) ||
    (pref === "down" && spaceBelow < 150 && spaceAbove > spaceBelow)
      ? "up"
      : "down";

  const available = direction === "up" ? spaceAbove : spaceBelow;
  const maxHeight = Math.min(320, Math.max(96, available));
  const { left, width } = matchChoiceMenuRect(input.triggerRect, input.windowWidth);

  if (direction === "up") {
    return {
      direction: "up",
      bottom: Math.round(
        Math.max(safeBottomMargin, input.windowHeight - (input.triggerRect.top - gap)),
      ),
      left,
      width,
      maxHeight,
    };
  }

  return {
    direction: "down",
    top: Math.round(Math.max(safeTop, input.triggerRect.bottom + gap)),
    left,
    width,
    maxHeight,
  };
}

export function reconcileCanvasRightDocks(input: {
  prevWindowWidth: number;
  windowWidth: number;
  viewMode: "canvas" | "split" | "list";
  agentDock: boolean;
  prevAgentDockedWidth: number;
  agentDockedWidth: number;
}): { closeAgentDock: boolean; switchSplitToCanvas: boolean } {
  if (
    input.windowWidth <= 1100 &&
    input.viewMode !== "canvas" &&
    input.agentDock
  ) {
    if (input.prevWindowWidth > 1100) {
      return { closeAgentDock: true, switchSplitToCanvas: false };
    }
    if (input.prevAgentDockedWidth === 0 && input.agentDockedWidth > 0) {
      return { closeAgentDock: false, switchSplitToCanvas: true };
    }
  }
  return { closeAgentDock: false, switchSplitToCanvas: false };
}

export function resolveCanvasWorkspaceTop(input: {
  rootTop: number;
  headerBottom: number;
  switcherTop?: number | null;
  switcherBottom?: number | null;
  switcherHeight?: number | null;
}): { headerBottom: number; workspaceTop: number } {
  const headerBottom = Math.max(
    52,
    Math.ceil(input.headerBottom - input.rootTop),
  );
  let workspaceTop = headerBottom;
  if (
    typeof input.switcherTop === "number" &&
    typeof input.switcherBottom === "number" &&
    (input.switcherHeight ?? 0) > 0 &&
    input.switcherTop >= input.headerBottom - 4
  ) {
    workspaceTop = Math.max(
      headerBottom,
      Math.ceil(input.switcherBottom - input.rootTop + 6),
    );
  }
  return { headerBottom, workspaceTop };
}

export function resolveEffectiveNarrationModel(input: {
  requestedModel?: string | null;
  activeModel?: string;
  audioModels?: readonly { id: string }[];
}): string {
  const requested = input.requestedModel?.trim() || "";
  const requestedAvailable = Boolean(
    requested && input.audioModels?.some((m) => m.id === requested),
  );
  if (requestedAvailable) return requested;
  if (input.activeModel) return input.activeModel;
  if (input.audioModels?.length === 1) return input.audioModels[0].id;
  return requested;
}

export function resolveCanvasSpeechModels(
  studio: Pick<
    Studio,
    | "canvas_speech_models"
    | "model_catalog"
    | "model_access"
    | "model_policy"
  >,
): { id: string; label: string }[] {
  if (Array.isArray(studio.canvas_speech_models)) {
    return studio.canvas_speech_models
      .filter((id) => {
        if (!id) return false;
        const spec = studio.model_catalog?.[id];
        if (spec && spec.kind !== "audio") return false;
        return !isBgmMusicModel(id, spec);
      })
      .map((id) => ({
        id,
        label: studio.model_catalog?.[id]?.label || id,
      }));
  }
  const access = studio.model_access || studio.model_policy?.enabled;
  const isPolicyAllowed = (id: string) => !access || access[id] === true;
  return Object.entries(studio.model_catalog ?? {})
    .filter(
      ([id, spec]) =>
        spec.kind === "audio" &&
        !spec.hidden &&
        !isBgmMusicModel(id, spec) &&
        isPolicyAllowed(id),
    )
    .map(([id, spec]) => ({ id, label: spec.label || id }));
}

function quoteSingleSpeechModel(
  studio: Pick<Studio, "pricing" | "credits">,
  modelId: string,
): {
  cost: number | null;
  costIndeterminate: boolean;
  unavailableReason: string;
} {
  if (!modelId) {
    return {
      cost: null,
      costIndeterminate: false,
      unavailableReason: "当前空间未开放语音模型",
    };
  }
  const modelPrices = (studio.pricing?.items ?? []).filter((p) =>
    p.key.startsWith(modelId + "|"),
  );
  if (modelPrices.length === 0) {
    if (modelId === "edge-tts") {
      return { cost: 0, costIndeterminate: false, unavailableReason: "" };
    }
    return {
      cost: null,
      costIndeterminate: false,
      unavailableReason: "语音生成尚未定价",
    };
  }
  if (modelPrices.length === 1) {
    const cost = modelPrices[0].amount;
    if (cost === null) {
      return {
        cost: null,
        costIndeterminate: false,
        unavailableReason: "语音生成尚未定价",
      };
    }
    if ((studio.credits?.available ?? 0) < cost) {
      return {
        cost,
        costIndeterminate: false,
        unavailableReason: "当前空间积分不足",
      };
    }
    return { cost, costIndeterminate: false, unavailableReason: "" };
  }

  const pricedAmounts = modelPrices
    .map((p) => p.amount)
    .filter((amount): amount is number => amount !== null);
  if (pricedAmounts.length === 0) {
    return {
      cost: null,
      costIndeterminate: false,
      unavailableReason: "语音生成尚未定价",
    };
  }
  const uniqueAmounts = new Set(pricedAmounts);
  if (
    pricedAmounts.length === modelPrices.length &&
    uniqueAmounts.size === 1
  ) {
    const cost = pricedAmounts[0];
    if ((studio.credits?.available ?? 0) < cost) {
      return {
        cost,
        costIndeterminate: false,
        unavailableReason: "当前空间积分不足",
      };
    }
    return { cost, costIndeterminate: false, unavailableReason: "" };
  }
  // Multi-tier speech models depend on plugin-prepared parameters; defer exact
  // amount & balance enforcement to server precheck/submit rather than guessing.
  return { cost: null, costIndeterminate: true, unavailableReason: "" };
}

export function quoteCanvasSpeechPlan(input: {
  studio: Partial<Pick<Studio, "workspace_id">> &
    Pick<
      Studio,
      | "canvas_speech_models"
      | "canvas_speech_default_models"
      | "model_catalog"
      | "model_access"
      | "model_policy"
      | "pricing"
      | "credits"
    >;
  node: Pick<CanvasNode, "narration_model" | "dialogue_lines">;
  packs?: readonly SpeechPackCandidate[];
}): {
  speechModels: { id: string; label: string }[];
  narration: {
    activeModel: string;
    cost: number | null;
    costIndeterminate: boolean;
    unavailableReason: string;
  };
  dialogue: {
    lineModels: Record<string, string>;
    lineCosts: Record<string, number | null>;
    lineReasons: Record<string, string>;
    batchCost: number | null;
    costIndeterminate: boolean;
    unavailableReason: string;
  };
} {
  const speechModels = resolveCanvasSpeechModels(input.studio);
  const availableSpeechIds = speechModels.map((m) => m.id);
  const defaultModelIds = input.studio.canvas_speech_default_models;

  const narrationActive = pickSpeechAudioModel({
    preferredModel: input.node.narration_model?.trim(),
    availableSpeechIds,
    defaultModelIds,
  });
  const narrationQuote = quoteSingleSpeechModel(input.studio, narrationActive);

  const lineModels: Record<string, string> = {};
  const lineCosts: Record<string, number | null> = {};
  const lineReasons: Record<string, string> = {};

  let batchSum = 0;
  let batchUnpriced = false;
  let batchIndeterminate = false;
  let batchNoModel = false;
  let nonEmptyCount = 0;

  for (const line of input.node.dialogue_lines ?? []) {
    const resolvedVoice = resolveDialogueVoiceProfile({
      workspaceId: input.studio.workspace_id,
      packs: input.packs,
      line,
    });
    const resolvedModel = pickSpeechAudioModel({
      preferredModel: resolvedVoice.model,
      availableSpeechIds,
      defaultModelIds,
    });
    const lineQuote = quoteSingleSpeechModel(input.studio, resolvedModel);
    lineModels[line.id] = resolvedModel;
    lineCosts[line.id] = lineQuote.cost;
    lineReasons[line.id] = lineQuote.unavailableReason;

    if (line.text.trim()) {
      nonEmptyCount++;
      if (!resolvedModel) {
        batchNoModel = true;
      } else if (lineQuote.costIndeterminate) {
        batchIndeterminate = true;
      } else if (lineQuote.cost === null) {
        batchUnpriced = true;
      } else {
        batchSum += lineQuote.cost;
      }
    }
  }

  let dialogueReason = "";
  let batchCost: number | null = batchIndeterminate ? null : batchSum;
  if (availableSpeechIds.length === 0 || batchNoModel) {
    batchCost = null;
    dialogueReason = "当前空间未开放语音模型";
  } else if (nonEmptyCount === 0) {
    batchCost = narrationQuote.cost;
    dialogueReason =
      narrationQuote.cost === null && !narrationQuote.costIndeterminate
        ? "语音生成尚未定价"
        : "";
  } else if (batchUnpriced) {
    batchCost = null;
    dialogueReason = "语音生成尚未定价";
  } else if ((input.studio.credits?.available ?? 0) < batchSum) {
    dialogueReason = "当前空间积分不足";
  }

  return {
    speechModels,
    narration: {
      activeModel: narrationActive,
      cost: narrationQuote.cost,
      costIndeterminate: narrationQuote.costIndeterminate,
      unavailableReason: narrationQuote.unavailableReason,
    },
    dialogue: {
      lineModels,
      lineCosts,
      lineReasons,
      batchCost,
      costIndeterminate: batchIndeterminate,
      unavailableReason: dialogueReason,
    },
  };
}
