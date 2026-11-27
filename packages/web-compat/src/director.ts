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

export const directorScriptConflict = "主剧本已更新，请重新预览后同步。";

export function directorShotIds(
  shots: readonly string[],
  director: DirectorProduction,
): string[] {
  const members = new Set(director.shot_ids);
  return shots.filter((id) => members.has(id));
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
