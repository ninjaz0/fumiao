import { isDeepStrictEqual } from "node:util";

import { hostLimits, httpChunks, type HttpTransport } from "../plugin-host.js";

export type Purpose = "chat" | "image" | "video";
export type Directory = "models" | "images/models" | "videos/models";
export type DirectoryStatus =
  | "ok"
  | "empty"
  | "invalid_credentials"
  | "forbidden"
  | "timeout"
  | "unavailable";
type Descriptor =
  | { type: "enum"; values: (string | number)[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };
export interface DeclaredParameters {
  names?: string[];
  definitions?: Record<string, Descriptor>;
  durations?: number[];
  automatic_duration?: boolean;
  resolutions?: string[];
  aspect_ratios?: string[];
  sizes?: string[];
  frame_images?: string[];
  upscale_only?: boolean;
  input_modalities?: string[];
  output_modalities?: string[];
  context_length?: number;
  max_completion_tokens?: number;
}
interface Entry {
  upstream_id: string;
  name: string;
  purpose: Purpose | null;
  purpose_source:
    "output_modalities" | "image_directory" | "video_directory" | null;
  parameters: DeclaredParameters;
}
export interface Candidate extends Entry {
  directories: Directory[];
  change: "added" | "changed" | "unchanged" | "missing";
  metadata_status: "declared" | "needs_confirmation" | "missing" | "stale";
}
export interface Discovery {
  directories: Partial<Record<Directory, DirectoryStatus>>;
  snapshots: Partial<Record<Directory, Entry[]>>;
  candidates: Candidate[];
}
export const isOpenRouter = (base: string) =>
  base === "https://openrouter.ai/api/v1";
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const safeText = (v: unknown, limit = 512): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= limit &&
  v.trim() === v &&
  !/[\u0000-\u001f\u007f]/.test(v);
const strings = (v: unknown) =>
  Array.isArray(v)
    ? (v.filter((x) => safeText(x, 128)).slice(0, 128) as string[])
    : undefined;
function definitions(input: Record<string, unknown>) {
  const valid: Record<string, Descriptor> = Object.create(null);
  for (const [key, value] of Object.entries(input).slice(0, 128)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) continue;
    const item = obj(value);
    if (item.type === "boolean") valid[key] = { type: "boolean" };
    if (
      item.type === "range" &&
      typeof item.min === "number" &&
      typeof item.max === "number" &&
      Number.isFinite(item.min) &&
      Number.isFinite(item.max) &&
      item.min <= item.max
    )
      valid[key] = { type: "range", min: item.min, max: item.max };
    if (item.type === "enum" && Array.isArray(item.values))
      valid[key] = {
        type: "enum",
        values: item.values
          .filter(
            (v) =>
              safeText(v, 128) || (typeof v === "number" && Number.isFinite(v)),
          )
          .slice(0, 128),
      };
  }
  return { ...valid };
}
function modelPurpose(
  directory: Directory,
  outputs: string[] | undefined,
): Pick<Entry, "purpose" | "purpose_source"> {
  if (directory === "images/models")
    return { purpose: "image", purpose_source: "image_directory" };
  if (directory === "videos/models")
    return { purpose: "video", purpose_source: "video_directory" };
  const single = outputs && new Set(outputs).size === 1 ? outputs[0] : null;
  if (single === "image" || single === "video")
    return { purpose: single, purpose_source: "output_modalities" };
  if (single === "text")
    return { purpose: "chat", purpose_source: "output_modalities" };
  return { purpose: null, purpose_source: null };
}
function parseEntry(value: unknown, source: Directory): Entry | undefined {
  const row = obj(value);
  if (!safeText(row.id)) return;
  const architecture = obj(row.architecture);
  const outputs = strings(
    architecture.output_modalities ?? row.output_modalities,
  );
  const parameters: DeclaredParameters = {
    input_modalities: strings(architecture.input_modalities),
    output_modalities: outputs,
    names: strings(row.supported_parameters),
    resolutions: strings(row.supported_resolutions),
    aspect_ratios: strings(row.supported_aspect_ratios),
    sizes: strings(row.supported_sizes),
    frame_images: strings(row.supported_frame_images)?.filter((v) =>
      ["first_frame", "last_frame"].includes(v),
    ),
  };
  const limit = obj(row.top_provider).max_completion_tokens;
  if (
    typeof row.context_length === "number" &&
    Number.isSafeInteger(row.context_length) &&
    row.context_length > 0
  )
    parameters.context_length = row.context_length;
  if (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0)
    parameters.max_completion_tokens = limit;
  if (row.supported_parameters && !Array.isArray(row.supported_parameters))
    parameters.definitions = definitions(obj(row.supported_parameters));
  if (Array.isArray(row.supported_durations)) {
    parameters.durations = [
      ...new Set(
        row.supported_durations.filter((d) => Number.isSafeInteger(d) && d > 0),
      ),
    ].slice(0, 256);
    parameters.automatic_duration = row.supported_durations.includes(-1);
  }
  if (row.upscale_factor != null) parameters.upscale_only = true;
  // Keep only supplied fields so merging dedicated and general directory data is lossless.
  for (const key of Object.keys(parameters) as (keyof DeclaredParameters)[])
    if (parameters[key] === undefined) delete parameters[key];
  return {
    upstream_id: row.id,
    name: safeText(row.name) ? row.name : row.id,
    ...modelPurpose(source, outputs),
    parameters,
  };
}

function reflectsCredential(entry: Entry, matches: (value: string) => boolean) {
  if (matches(entry.upstream_id) || matches(entry.name)) return true;
  for (const list of Object.values(entry.parameters))
    if (
      Array.isArray(list) &&
      list.some((v) => typeof v === "string" && matches(v))
    )
      return true;
  for (const [name, definition] of Object.entries(
    entry.parameters.definitions ?? {},
  ))
    if (
      matches(name) ||
      (definition.type === "enum" &&
        definition.values.some((v) => typeof v === "string" && matches(v)))
    )
      return true;
  return false;
}

type FetchDirectory = (
  directory: Directory,
  signal: AbortSignal,
) => ReturnType<HttpTransport>;
async function readDirectory(
  path: Directory,
  fetchDirectory: FetchDirectory,
  containsCredential: (text: string) => boolean,
) {
  const signal = AbortSignal.timeout(hostLimits.httpTimeoutMs);
  try {
    const response = await fetchDirectory(path, signal);
    if (response.status !== 200) {
      if (!Buffer.isBuffer(response.body))
        await response.body.cancel().catch(() => {});
      const failures: Partial<Record<number, DirectoryStatus>> = {
        401: "invalid_credentials",
        403: "forbidden",
        408: "timeout",
        504: "timeout",
      };
      const status = failures[response.status] ?? "unavailable";
      return { path, status };
    }
    const chunks: Buffer[] = [];
    for await (const chunk of httpChunks(response.body, signal))
      chunks.push(chunk);
    const data: unknown = obj(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    ).data;
    if (!Array.isArray(data) || data.length > 10000)
      return { path, status: "unavailable" as const };
    const entries = new Map<string, Entry>();
    for (const value of data) {
      const entry = parseEntry(value, path);
      if (
        entry &&
        !reflectsCredential(entry, containsCredential) &&
        !entries.has(entry.upstream_id)
      )
        entries.set(entry.upstream_id, entry);
    }
    return {
      path,
      status: entries.size ? ("ok" as const) : ("empty" as const),
      entries: [...entries.values()],
    };
  } catch (e) {
    return {
      path,
      status:
        signal.aborted ||
        (e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name))
          ? ("timeout" as const)
          : ("unavailable" as const),
    };
  }
}
const usable = (s?: DirectoryStatus) => s === "ok" || s === "empty";

export async function discoverModels(
  base: string,
  fetchDirectory: FetchDirectory,
  containsCredential: (text: string) => boolean,
  previous?: Discovery,
): Promise<Discovery> {
  const paths: Directory[] = isOpenRouter(base)
    ? ["models", "images/models", "videos/models"]
    : ["models"];
  const reads = await Promise.all(
    paths.map((path) =>
      readDirectory(path, fetchDirectory, containsCredential),
    ),
  );
  const snapshots = { ...previous?.snapshots };
  const directories: Discovery["directories"] = {};
  const merged = new Map<string, Candidate>();
  for (const read of reads) {
    directories[read.path] = read.status;
    if (read.entries) snapshots[read.path] = read.entries;
    for (const entry of snapshots[read.path] ?? []) {
      const prior = merged.get(entry.upstream_id);
      merged.set(entry.upstream_id, {
        ...entry,
        purpose: entry.purpose ?? prior?.purpose ?? null,
        purpose_source: entry.purpose_source ?? prior?.purpose_source ?? null,
        name:
          entry.name === entry.upstream_id && prior ? prior.name : entry.name,
        parameters: { ...prior?.parameters, ...entry.parameters },
        directories: [...(prior?.directories ?? []), read.path],
        change: "added",
        metadata_status: "declared",
      });
    }
  }
  const old = new Map(previous?.candidates.map((c) => [c.upstream_id, c]));
  for (const item of merged.values()) {
    const prev = old.get(item.upstream_id);
    // JSONB reorders object keys on read, so structural comparison matters.
    if (prev && prev.change !== "missing")
      item.change = isDeepStrictEqual(
        { ...prev, change: item.change, metadata_status: item.metadata_status },
        item,
      )
        ? "unchanged"
        : "changed";
    const incomplete =
      !item.purpose ||
      (isOpenRouter(base) &&
        item.purpose === "image" &&
        !item.directories.includes("images/models")) ||
      (item.purpose === "video" &&
        (!item.parameters.durations?.length || item.parameters.upscale_only));
    const stale = item.directories.some((d) => !usable(directories[d]));
    item.metadata_status = stale
      ? "stale"
      : incomplete
        ? "needs_confirmation"
        : "declared";
  }
  for (const [id, item] of old)
    if (!merged.has(id))
      merged.set(id, {
        ...item,
        change: "missing",
        metadata_status: "missing",
      });
  return {
    snapshots,
    directories,
    candidates: [...merged.values()].sort((a, b) =>
      a.upstream_id.localeCompare(b.upstream_id),
    ),
  };
}
