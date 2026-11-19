export type Kind = "text" | "image" | "video" | "sticky";
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
export type CanvasNode = {
  narration_text?:string;
  narration_instruction?:string;
  narration_job?:number|null;
  narration_pending?:number|null;
  asset_packs?: {id:string;revision:number;name?:string}[];
  id: string;
  type: Kind;
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
export type CanvasEdge = { id: string; source: string; target: string };
export type Doc = {
  schemaVersion: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  shots?: string[];
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
export type Asset = {kind?:string;seconds?:number;has_audio?:boolean;name?:string; id: string; w: number; h: number; owner: number };
export type FlowModel = {kind:string;label:string;provider?:string;family?:string;family_label?:string;hidden?:boolean;mode?:string;ratio?:string;seconds?:number;resolution?:string;min_refs?:number;max_refs?:number};
export type Studio = {
  model_forms: Record<string, import("../../../packages/plugin-sdk/src/model-form").ModelForm>;
  model_catalog: Record<string,FlowModel>;
  video_models: Record<string,string>;
  flow?: {configured:boolean;ready:boolean};
  model_policy: {revision:number;enabled:Record<string,boolean>};
  model_access: Record<string,boolean>;
  credits: {available:number;reserved:number};
  pricing: {revision:number;items:{key:string;amount:number|null}[]};
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
  width: 320,
  height: type === "text" || type === "sticky" ? 240 : 240,
  text: "",
  prompt: "",
  color: type === "sticky" ? "yellow" : "none",
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
export function connectionError(
  doc: Doc,
  source: string,
  target: string,
): string {
  const a = doc.nodes.find((n) => n.id === source),
    b = doc.nodes.find((n) => n.id === target);
  if (
    !a ||
    !b ||
    source === target ||
    !["text", "image"].includes(a.type) ||
    !["image", "video"].includes(b.type)
  )
    return "这两个节点不能连接";
  if (doc.edges.some((e) => e.source === source && e.target === target))
    return "已经连接";
  if (
    a.type === "image" &&
    doc.edges.filter(
      (e) =>
        e.target === target &&
        doc.nodes.find((n) => n.id === e.source)?.type === "image",
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
