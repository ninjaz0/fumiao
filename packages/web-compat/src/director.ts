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

export type DirectorShotInputs = {
  revision: number;
  description: string;
  story_basis: string | null;
  material_basis: string | null;
  references: { id: string; mime: string }[];
  visual_issues: string[];
  material_issues: string[];
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

export const directorScriptConflict = "主剧本已更新，请重新预览后同步。";

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
  const lines = node.dialogue_lines?.filter((line) => line.text.trim()) ?? [];
  if (lines.length) return lines.map((line) => ({ node_id: node.id, stage: "dialogue", line_id: line.id }));
  return node.narration_text?.trim() ? [{ node_id: node.id, stage: "narration" }] : [];
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
