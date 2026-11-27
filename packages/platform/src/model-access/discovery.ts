import { isDeepStrictEqual } from "node:util";

import { hostLimits, httpChunks, type HttpTransport } from "../plugin-host.js";

export type Purpose = "chat" | "image" | "video";
export type Directory = "models" | "images/models" | "videos/models";
export type DirectoryStatus =
  | "ok"
  | "empty"
  | "partial"
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
  /** Listed by the gateway, but lacking a usable parameter constraint. */
  unconfirmed_parameters?: string[];
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
  output_format_default?: string;
  output_token_parameter?: "max_tokens" | "max_completion_tokens";
}
export function chatOutputParameter(caps: DeclaredParameters) {
  return (
    caps.output_token_parameter ??
    (caps.names?.includes("max_completion_tokens") &&
    !caps.names.includes("max_tokens")
      ? "max_completion_tokens"
      : "max_tokens")
  );
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
type ContainsCredential = (text: string) => boolean;
const decimalNotation = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumSignificantDigits: 21,
});
function safeNumber(
  value: unknown,
  containsCredential: ContainsCredential,
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const text = String(value);
  // JSONB expands scientific notation on disk; check both persisted and wire spellings.
  return (
    !containsCredential(text) &&
    (!text.includes("e") || !containsCredential(decimalNotation.format(value)))
  );
}
function strings(value: unknown, containsCredential: ContainsCredential) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (item): item is string =>
        safeText(item, 128) && !containsCredential(item),
    )
    .slice(0, 128);
}
const descriptorFields = new Map<string, readonly string[]>([
  ["enum", ["type", "values"]],
  ["range", ["type", "min", "max"]],
  ["boolean", ["type"]],
]);
function parameterDefinition(
  value: unknown,
  containsCredential: ContainsCredential,
): Descriptor | undefined {
  const item = obj(value);
  if (!Array.isArray(value)) {
    const fields =
      typeof item.type === "string"
        ? descriptorFields.get(item.type)
        : undefined;
    if (
      !fields ||
      Object.keys(item).some((key) => {
        if (
          (key === "description" || key === "title") &&
          typeof item[key] === "string"
        )
          return false;
        return !fields.includes(key);
      })
    )
      return;
  }
  if (item.type === "boolean") return { type: "boolean" };
  if (
    item.type === "range" &&
    safeNumber(item.min, containsCredential) &&
    safeNumber(item.max, containsCredential) &&
    item.min <= item.max
  )
    return { type: "range", min: item.min, max: item.max };

  const options = Array.isArray(value)
    ? value
    : item.type === "enum"
      ? item.values
      : undefined;
  if (!Array.isArray(options) || !options.length || options.length > 128)
    return;
  if (
    !options.every(
      (v) =>
        (safeText(v, 128) && !containsCredential(v)) ||
        safeNumber(v, containsCredential),
    )
  )
    return;
  return { type: "enum", values: options };
}
function declaredOptions(
  value: unknown,
  containsCredential: ContainsCredential,
): DeclaredParameters {
  if (Array.isArray(value))
    return { names: strings(value, containsCredential) };
  if (!value || typeof value !== "object") return {};
  const names: string[] = [];
  const unconfirmed: string[] = [];
  const definitions: Record<string, Descriptor> = Object.create(null);
  let outputFormatDefault: string | undefined;
  for (const [key, raw] of Object.entries(value).slice(0, 128)) {
    if (!safeText(key, 128) || containsCredential(key)) continue;
    names.push(key);
    let constraint = raw;
    if (key === "output_format" && Object.hasOwn(obj(raw), "default")) {
      const { default: preferred, ...rest } = obj(raw);
      // The default is a hint. Keep every other restriction on this enum.
      if (safeText(preferred, 128) && !containsCredential(preferred))
        outputFormatDefault = preferred;
      constraint = rest;
    }
    const descriptor = parameterDefinition(constraint, containsCredential);
    if (descriptor) definitions[key] = descriptor;
    else unconfirmed.push(key);
  }
  return {
    names,
    definitions: { ...definitions },
    ...(outputFormatDefault && { output_format_default: outputFormatDefault }),
    ...(unconfirmed.length ? { unconfirmed_parameters: unconfirmed } : {}),
  };
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
function parseEntry(
  id: string,
  raw: unknown,
  source: Directory,
  containsCredential: ContainsCredential,
): Entry {
  const row = obj(raw);
  const architecture = obj(row.architecture);
  const outputs = architecture.output_modalities ?? row.output_modalities;
  const parameters: DeclaredParameters = {
    ...declaredOptions(row.supported_parameters, containsCredential),
    input_modalities: strings(
      architecture.input_modalities,
      containsCredential,
    ),
    output_modalities: strings(outputs, containsCredential),
    resolutions: strings(row.supported_resolutions, containsCredential),
    aspect_ratios: strings(row.supported_aspect_ratios, containsCredential),
    sizes: strings(row.supported_sizes, containsCredential),
    frame_images: strings(
      row.supported_frame_images,
      containsCredential,
    )?.filter((v) => ["first_frame", "last_frame"].includes(v)),
  };
  const limit = obj(row.top_provider).max_completion_tokens;
  if (
    safeNumber(row.context_length, containsCredential) &&
    Number.isSafeInteger(row.context_length) &&
    row.context_length > 0
  )
    parameters.context_length = row.context_length;
  if (
    safeNumber(limit, containsCredential) &&
    Number.isSafeInteger(limit) &&
    limit > 0
  )
    parameters.max_completion_tokens = limit;
  if (Array.isArray(row.supported_durations)) {
    parameters.durations = [
      ...new Set(
        row.supported_durations.filter(
          (d) =>
            safeNumber(d, containsCredential) &&
            Number.isSafeInteger(d) &&
            d > 0,
        ),
      ),
    ].slice(0, 256);
    parameters.automatic_duration = row.supported_durations.includes(-1);
  }
  if (row.upscale_factor != null) parameters.upscale_only = true;
  // Keep only supplied fields so merging dedicated and general directory data is lossless.
  for (const key of Object.keys(parameters) as (keyof DeclaredParameters)[])
    if (parameters[key] === undefined) delete parameters[key];
  return {
    upstream_id: id,
    name: safeText(row.name) && !containsCredential(row.name) ? row.name : id,
    // A removed or malformed second modality must not turn an ambiguous entry into a single-purpose model.
    ...modelPurpose(
      source,
      Array.isArray(outputs) &&
        parameters.output_modalities?.length === outputs.length
        ? parameters.output_modalities
        : undefined,
    ),
    parameters,
  };
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
    for await (const chunk of httpChunks(response.body, signal, 8 * 1024 * 1024))
      chunks.push(chunk);
    const data: unknown = obj(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    ).data;
    if (!Array.isArray(data) || data.length > 10000)
      return { path, status: "unavailable" as const };
    const entries = new Map<string, Entry>();
    let malformed = false;
    for (const value of data) {
      const id = typeof value === "string" ? value : obj(value).id;
      if (!safeText(id)) {
        malformed = true;
        continue;
      }
      if (!containsCredential(id) && !entries.has(id))
        entries.set(id, parseEntry(id, value, path, containsCredential));
    }
    if (data.length && !entries.size)
      return { path, status: "unavailable" as const };
    const status: DirectoryStatus = malformed
      ? "partial"
      : entries.size
        ? "ok"
        : "empty";
    return { path, status, entries: [...entries.values()] };
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
function mergeParameters(
  prior: DeclaredParameters | undefined,
  entry: DeclaredParameters,
) {
  if (!prior) return entry;
  const merged = { ...prior, ...entry };
  if (prior.names && entry.names)
    merged.names = [...new Set([...prior.names, ...entry.names])];
  if (prior.definitions && entry.definitions)
    merged.definitions = { ...prior.definitions, ...entry.definitions };
  if (prior.unconfirmed_parameters || entry.unconfirmed_parameters) {
    // An unsupported constraint is not an executable option, even if another
    // directory lists the same parameter without mentioning that constraint.
    merged.unconfirmed_parameters = [
      ...new Set([
        ...(prior.unconfirmed_parameters ?? []),
        ...(entry.unconfirmed_parameters ?? []),
      ]),
    ];
    merged.definitions = { ...merged.definitions };
    for (const name of merged.unconfirmed_parameters)
      delete merged.definitions[name];
  }
  return merged;
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
  const observedInPartial = new Map<Directory, Set<string>>();
  for (const read of reads) {
    directories[read.path] = read.status;
    if (read.status === "partial" && read.entries) {
      const saved = new Map(
        snapshots[read.path]?.map((row) => [row.upstream_id, row]),
      );
      for (const row of read.entries) saved.set(row.upstream_id, row);
      snapshots[read.path] = [...saved.values()];
      observedInPartial.set(
        read.path,
        new Set(read.entries.map((row) => row.upstream_id)),
      );
    } else if (read.entries) snapshots[read.path] = read.entries;
    for (const entry of snapshots[read.path] ?? []) {
      const prior = merged.get(entry.upstream_id);
      merged.set(entry.upstream_id, {
        ...entry,
        purpose: entry.purpose ?? prior?.purpose ?? null,
        purpose_source: entry.purpose_source ?? prior?.purpose_source ?? null,
        name:
          entry.name === entry.upstream_id && prior ? prior.name : entry.name,
        parameters: mergeParameters(prior?.parameters, entry.parameters),
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
      !!item.parameters.unconfirmed_parameters?.length ||
      (isOpenRouter(base) &&
        item.purpose === "image" &&
        !item.directories.includes("images/models")) ||
      (item.purpose === "video" &&
        (!item.parameters.durations?.length || item.parameters.upscale_only));
    const stale = item.directories.some(
      (d) =>
        !usable(directories[d]) &&
        !observedInPartial.get(d)?.has(item.upstream_id),
    );
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
