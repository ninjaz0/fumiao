export type DirectorShotState = {
  node_id: string;
  source?: Record<string, string>;
  story_basis?: string;
  material_basis?: string;
  adoption_basis?: string;
};

export type DirectorProduction = {
  script_id: string;
  script_revision: number;
  shot_ids: string[];
  order_basis?: string;
  shots?: DirectorShotState[];
};

export type DirectorTarget = {
  node_id: string;
  stage: "image" | "video" | "narration" | "dialogue";
  line_id?: string;
};

export function directorTargetKey(target: DirectorTarget) {
  return [target.node_id, target.stage, target.line_id].filter(Boolean).join(":");
}

export type DirectorBatchSelection = {
  script_revision: number;
  use_confirmed_script?: boolean;
  targets: DirectorTarget[];
};

export type DirectorAudioInputs = Record<string, {
  basis: string;
  model: string;
  pack_id: string | null;
  voice_id: string | null;
  instruction: string;
  params?: Record<string, unknown>;
}>;

export type DirectorShotInputs = {
  revision: number;
  description: string;
  story_basis: string | null;
  material_basis: string | null;
  adoption_input_basis?: string;
  references: { id: string; mime: string; role?: "continuation" }[];
  pack_texts: { id: string; text: string }[];
  visual_issues: string[];
  material_issues: string[];
  audio_input_bases: Record<string, string>;
  audio_inputs: DirectorAudioInputs;
  voices: {
    speaker: string;
    model: string;
    pack_id?: string;
    voice?: string;
    rate?: string;
    pitch?: string;
    instruction?: string;
  }[];
};

export const directorBatchUnclaimed = "本次提交未创建回执。";
export const directorScriptConflict = "主剧本已更新，请重新预览后同步。";
export const episodeMaxShots = 30;
export const episodeMaxSeconds = 300;

export type DirectorVideoSelection = { media_id: string } | { job_id: number };

export function directorVideoSelection(node: {
  media_id: string | null;
  active_job: number | null;
  use_media?: boolean;
}): DirectorVideoSelection | null {
  if (node.use_media) return node.media_id ? { media_id: node.media_id } : null;
  return node.active_job ? { job_id: node.active_job } : null;
}

export function directorAdoptionBasis(inputs: string, selection: DirectorVideoSelection) {
  return directorBasis({ inputs, selection });
}

export function directorAudioEvidenceMismatch(
  recorded: Record<string, unknown>,
  current?: DirectorAudioInputs[string],
) {
  if (typeof recorded.director_basis === "string")
    return recorded.director_basis !== current?.basis;
  const fields = ["model", "pack_id", "voice_id", "instruction"] as const;
  if (!current) return fields.some((key) => typeof recorded[key] === "string" && recorded[key].trim());
  const normalize = (value: unknown) => typeof value === "string" ? value.trim() || null : value;
  for (const key of fields) {
    if (recorded[key] === undefined) continue;
    if (normalize(recorded[key]) !== normalize(current[key])) return true;
  }
  if (recorded.params && typeof recorded.params === "object") {
    const params = recorded.params as Record<string, unknown>;
    for (const key of ["voice", "rate", "pitch"])
      if (params[key] !== undefined && current.params?.[key] !== undefined && params[key] !== current.params[key]) return true;
  }
  return false;
}

export function directorShotIds(
  shots: readonly string[],
  director: DirectorProduction,
): string[] {
  const members = new Set(director.shot_ids);
  return shots.filter((id) => members.has(id));
}

export function canvasTailSourceId(
  document: {
    shots?: readonly string[];
    nodes: readonly { id: string; type: string; x: number; y: number }[];
    edges: readonly { source: string; target: string }[];
  },
  nodeId: string,
): string | null {
  const videos = document.nodes.filter((node) => node.type === "video");
  const order = document.shots?.length ? document.shots : videos
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((node) => node.id);
  const index = order.indexOf(nodeId);
  return index > 0 ? order[index - 1] : document.edges.find((edge) =>
    edge.target === nodeId && videos.some((node) => node.id === edge.source),
  )?.source ?? null;
}

export function directorAudioTargets(node: {
  id: string;
  audio_strategy?: string;
  narration_text?: string;
  dialogue_lines?: readonly { id: string; text: string }[];
}): DirectorTarget[] {
  if (node.audio_strategy === "keep_original") return [];
  const hasWords = /[^\p{White_Space}\u001c-\u001f]/u;
  const lines = node.dialogue_lines?.filter((line) => hasWords.test(line.text)) ?? [];
  if (lines.length) return lines.map((line) => ({ node_id: node.id, stage: "dialogue", line_id: line.id }));
  return hasWords.test(node.narration_text ?? "") ? [{ node_id: node.id, stage: "narration" }] : [];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key]));
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value);
}

export async function directorBasis(value: unknown): Promise<string> {
  const jsonValue: unknown = JSON.parse(JSON.stringify(value) ?? "null");
  const bytes = new TextEncoder().encode(canonicalJson(jsonValue));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
