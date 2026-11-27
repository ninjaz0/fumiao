import type {
  ChatPrices,
  DirectoryStatus,
  DraftOverrides,
  ModelCandidate,
  ModelConnection,
  ModelDraft,
  ModelPurpose,
  PublishedPrice,
  SaveModelDraft,
  VideoProtocol,
} from "@fumiao/web-compat/model-access.js";

export const directoryLabels: Record<DirectoryStatus, string> = {
  ok: "目录已读取",
  empty: "目录为空，可手动补录",
  partial: "目录部分读取，保留上次结果",
  invalid_credentials: "密钥无效",
  forbidden: "密钥没有目录读取权限",
  timeout: "读取超时",
  unavailable: "目录不可用，保留上次结果",
};

export const purposes = { chat: "对话", image: "图片", video: "视频" };
export const formats = {
  "new-api-videos": "New API（OpenAI 视频兼容）",
  "openrouter-videos": "OpenRouter 视频",
  "openai-chat": "OpenAI 兼容对话",
  "openai-images": "OpenAI 兼容图片",
  "openrouter-images": "OpenRouter 图片",
};
export type Rates = {
  unit?: string;
  input?: string;
  output?: string;
  cache_read?: string;
  cache_write?: string;
};
export type EditorRow = Rates & {
  upstream: string;
  purpose: ModelPurpose | "";
  label?: string;
  target?: string;
  id?: string;
  revision?: number;
  protocol?: VideoProtocol | "openrouter-images" | "";
  durations?: string;
  minSeconds?: string;
  maxSeconds?: string;
  sizes?: string;
  resolutions?: string;
  ratios?: string;
  frames?: "" | "none" | "optional" | "required";
  minRefs?: string;
  maxRefs?: string;
  tools?: boolean;
  response?: "json" | "stream";
};
export function ratesOf(price: PublishedPrice): Rates {
  return price.kind === "chat"
    ? {
        input: price.input,
        output: price.output,
        cache_read: price.cache_read ?? "",
        cache_write: price.cache_write ?? "",
      }
    : { unit: price.unit };
}
export const listValues = (s?: string) =>
  s
    ?.trim()
    .split(/[\s,，、]+/)
    .filter(Boolean) ?? [];
const nullable = (s?: string) => s?.trim() || null;
export function chatRates(r: Rates): ChatPrices {
  return {
    input: nullable(r.input),
    output: nullable(r.output),
    cache_read: nullable(r.cache_read),
    cache_write: nullable(r.cache_write),
  };
}
export function newRow(
  upstream: string,
  c?: ModelCandidate,
  d?: ModelDraft,
): EditorRow {
  const o = d?.overrides;
  return {
    upstream,
    label: d?.publication
      ? (d.publication.label ?? upstream)
      : c?.name && c.name !== upstream
        ? c.name.slice(0, 128)
        : upstream,
    target:
      d?.publication?.action === "standby"
        ? d.publication.catalog_id
        : d?.publication?.action === "create"
          ? ""
          : d?.publication?.action,
    purpose: d?.purpose ?? c?.purpose ?? "",
    id: d?.id,
    revision: d?.revision,
    unit: d?.price ?? "",
    input: d?.chat_prices?.input ?? "",
    output: d?.chat_prices?.output ?? "",
    cache_read: d?.chat_prices?.cache_read ?? "",
    cache_write: d?.chat_prices?.cache_write ?? "",
    protocol: o?.protocol ?? "",
    durations: o?.durations?.join(", "),
    minSeconds: o?.duration_range?.min.toString(),
    maxSeconds: o?.duration_range?.max.toString(),
    sizes: o?.sizes?.join(", "),
    resolutions: o?.resolutions?.join(", "),
    ratios: o?.aspect_ratios?.join(", "),
    frames: o?.requires_first_frame
      ? "required"
      : o?.frame_images?.includes("first_frame")
        ? "optional"
        : o?.frame_images
          ? "none"
          : "",
    minRefs: o?.input_references?.min.toString(),
    maxRefs: o?.input_references?.max.toString(),
    tools: o?.tools,
    response: o?.chat_response,
  };
}
export function draftPayload(
  row: EditorRow,
  connection: Pick<ModelConnection, "id" | "revision">,
  defaultVideo: VideoProtocol | "",
): SaveModelDraft & { overrides: DraftOverrides } {
  const overrides: DraftOverrides = {};
  if (row.purpose === "video") {
    const protocol = row.protocol || defaultVideo;
    if (protocol && protocol !== "openrouter-images")
      overrides.protocol = protocol;
    if (row.durations?.trim())
      overrides.durations = listValues(row.durations).map(Number);
    if (row.minSeconds || row.maxSeconds) {
      if (!row.minSeconds || !row.maxSeconds)
        throw Error("请同时填写最短和最长时长");
      overrides.duration_range = {
        min: Number(row.minSeconds),
        max: Number(row.maxSeconds),
      };
    }
    if (row.frames) {
      overrides.frame_images = row.frames === "none" ? [] : ["first_frame"];
      overrides.requires_first_frame = row.frames === "required";
    }
  }
  if (row.purpose === "image") {
    if (row.protocol === "openrouter-images") overrides.protocol = row.protocol;
    if (row.minRefs || row.maxRefs) {
      if (!row.maxRefs) throw Error("请填写参考图数量上限");
      overrides.input_references = {
        min: Number(row.minRefs || 0),
        max: Number(row.maxRefs),
      };
    }
  }
  if (row.purpose === "image" || row.purpose === "video") {
    if (row.sizes?.trim()) overrides.sizes = listValues(row.sizes);
    if (row.resolutions?.trim())
      overrides.resolutions = listValues(row.resolutions);
    if (row.ratios?.trim()) overrides.aspect_ratios = listValues(row.ratios);
  }
  if (row.purpose === "chat") {
    if (row.tools !== undefined) overrides.tools = row.tools;
    if (row.response) overrides.chat_response = row.response;
  }
  const name = row.label?.trim();
  const label = name && name !== row.upstream ? name : undefined;
  return {
    expected_revision: row.revision ?? 0,
    connection_revision: connection.revision,
    connection_id: connection.id,
    upstream_id: row.upstream,
    publication:
      row.target && !["adopt", "draft"].includes(row.target)
        ? {
            action: "standby",
            catalog_id: row.target,
            label,
          }
        : {
            action:
              row.target === "adopt"
                ? "adopt"
                : row.target === "draft"
                  ? "draft"
                  : "create",
            label,
          },
    purpose: row.purpose || null,
    ...(row.purpose === "chat"
      ? { chat_prices: chatRates(row) }
      : { price: nullable(row.unit) }),
    overrides,
  };
}
export function priceText(p: PublishedPrice) {
  return p.kind === "chat"
    ? `输入 ${p.input} · 输出 ${p.output} 积分 / 百万 Token`
    : `${p.unit} 积分 / ${p.kind === "image" ? "张" : "秒"}`;
}
export function sampleCost(r: Rates) {
  if (!r.input || !r.output) return null;
  const prices = [
    r.input,
    r.cache_read || r.input,
    r.cache_write || r.input,
    r.output,
  ];
  if (prices.some((p) => !/^\d{1,19}(?:\.\d{1,6})?$/.test(p))) return null;
  const counts = [2000n, 7000n, 1000n, 500n];
  const sum = prices.reduce((n, p, i) => {
    const [whole, part = ""] = p.split(".");
    return n + BigInt(whole + part.padEnd(6, "0")) * counts[i];
  }, 0n);
  const s = sum.toString().padStart(13, "0");
  return (s.slice(0, -12) + "." + s.slice(-12)).replace(/\.?0+$/, "") || "0";
}

type RouteVersion = {
  draft_id: string;
  draft_revision: number;
  route_revision_id: string;
};

/** Publication snapshots stay immutable; the switcher offers one latest version per source. */
export function groupRoutes<T extends RouteVersion>(
  routes: readonly T[],
  activeId: string,
) {
  const groups = new Map<string, { active?: T; latest: T }>();
  for (const route of routes) {
    const group = groups.get(route.draft_id) ?? { latest: route };
    if (route.draft_revision > group.latest.draft_revision)
      group.latest = route;
    if (route.route_revision_id === activeId) group.active = route;
    groups.set(route.draft_id, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(!!b.active) - Number(!!a.active),
  );
}
