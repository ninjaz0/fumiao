import { Readable } from "node:stream";
import type { PluginMedia } from "./plugin-media.js";
import { lookup as resolve } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { z } from "zod";
import {
  hostFunctions,
  type HostCapability,
  type HostFunction,
  type ResolvedContributions,
  type SettingsScope,
} from "@fumiao/plugin-sdk/contributions.js";
import { one, type Sql } from "./db.js";
import type { HostCall } from "./plugin-program.js";
import { DomainError, requireValue } from "./security.js";

export const hostLimits = {
  httpTimeoutMs: 10_000,
  httpRequestBytes: 256 * 1024,
  httpResponseBytes: 1024 * 1024,
  dataValueBytes: 256 * 1024,
  dataPluginBytes: 16 * 1024 * 1024,
  dataPluginKeys: 2000,
  dataListKeys: 200,
};

// Addresses a plugin must never reach through the host: loopback, private
// and link-local ranges (cloud metadata lives there), CGNAT and multicast.
const internal = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  internal.addSubnet(net, prefix, "ipv4");
// Use global unicast for IPv6. The IANA special-purpose registry lists
// exceptions within 2000::/3, including documentation and transition ranges.
const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");
for (const [net, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  internal.addSubnet(net, prefix, "ipv6");
const reachableAssignments = new BlockList();
for (const [net, prefix] of [
  ["2001:1::1", 128],
  ["2001:1::2", 128],
  ["2001:1::3", 128],
  ["2001:3::", 32],
  ["2001:4:112::", 48],
  ["2001:20::", 28],
  ["2001:30::", 28],
] as const)
  reachableAssignments.addSubnet(net, prefix, "ipv6");

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !internal.check(address, "ipv4");
  if (family !== 6 || address.includes("%")) return false;
  // Retain the existing dotted IPv4-mapped spelling for ordinary public IPv4.
  const mapped = /^::ffff:(.*)$/i.exec(address);
  if (mapped) return isIP(mapped[1]) === 4 && publicAddress(mapped[1]);
  return (
    globalUnicast.check(address, "ipv6") &&
    (!internal.check(address, "ipv6") ||
      reachableAssignments.check(address, "ipv6"))
  );
}
// Checked on the address the socket connects to, so a name cannot resolve
// to a public address for the check and a private one for the request.
export const guardedLookup: LookupFunction = (hostname, options, callback) =>
  resolve(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as { address: string; family: number }[];
    if (!list.length || !list.every((a) => publicAddress(a.address)))
      return callback(
        Object.assign(new Error("Internal address"), { code: "EINTERNAL" }),
        "",
        0,
      );
    if ((options as { all?: boolean }).all)
      return (callback as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });

export function requirePublicHttps(url: URL) {
  requireValue(
    url.protocol === "https:" && !url.username && !url.password,
    403,
    "服务地址必须是无内嵌凭据的 HTTPS 地址",
  );
  // Node does not resolve an address literal, so the lookup guard never
  // sees it.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  requireValue(
    !isIP(literal) || publicAddress(literal),
    502,
    "请求地址指向内部网络",
  );
}

export type HttpTransport<Body extends string | Uint8Array = string> = (
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: Body },
  signal: AbortSignal,
) => Promise<{
  status: number;
  contentType: string;
  body: Buffer | ReadableStream<Uint8Array>;
}>;
export const guardedTransport: HttpTransport<string | Uint8Array> = (url, init, signal) =>
  new Promise((done, fail) => {
    requirePublicHttps(url);
    const req = httpsRequest(
      url,
      {
        method: init.method,
        headers: init.headers,
        lookup: guardedLookup,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(hostLimits.httpTimeoutMs),
        ]),
      },
      (res) =>
        done({
          status: res.statusCode ?? 0,
          contentType: String(res.headers["content-type"] ?? ""),
          body: Readable.toWeb(res, {
            strategy: {
              highWaterMark: 64 * 1024,
              size: (chunk: Uint8Array) => chunk.byteLength,
            },
          }) as ReadableStream<Uint8Array>,
        }),
    );
    req.on("error", fail);
    req.end(init.body);
  });

/** Read the entity body once. Count raw bytes before any text conversion. */
export async function* httpChunks(
  body: Buffer | ReadableStream<Uint8Array>,
  signal: AbortSignal,
  limit = hostLimits.httpResponseBytes,
) {
  if (Buffer.isBuffer(body)) {
    requireValue(body.length <= limit, 413, "上游响应过大");
    yield body;
    return;
  }
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return;
      bytes += chunk.value.byteLength;
      requireValue(bytes <= limit, 413, "上游响应过大");
      yield Buffer.from(chunk.value);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, "上游响应中断");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function approvedURL(target: string, origins: readonly string[]) {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new DomainError(400, "请求地址无效");
  }
  requireValue(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      origins.includes(url.origin),
    403,
    "请求地址不在插件声明的范围内",
  );
  requirePublicHttps(url);
  return url;
}

// Downloads use the same pinned DNS lookup and origin grant as sandbox HTTP.
// The host consumes binary data directly so it never crosses the JS bridge.
export async function* importBody(
  target: string,
  origins: readonly string[],
  limit: number,
  signal: AbortSignal,
  http: HttpTransport = guardedTransport,
) {
  signal.throwIfAborted();
  const url = approvedURL(target, origins);
  let response: Awaited<ReturnType<HttpTransport>>;
  try {
    response = await http(url, { method: "GET", headers: {} }, signal);
  } catch {
    throw new DomainError(502, "导入素材下载失败");
  }
  if (response.status !== 200) {
    if (!Buffer.isBuffer(response.body))
      await response.body.cancel().catch(() => {});
    throw new DomainError(502, "素材来源未返回完整文件");
  }
  yield* httpChunks(response.body, signal, limit);
}

const fetchInput = z.tuple([
  z.string().max(2048),
  z
    .object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      headers: z
        .record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), z.string().max(2048))
        .default({}),
      json: z.unknown().optional(),
      body: z.string().optional(),
    })
    .strict()
    .default({ method: "GET", headers: {} }),
]);
// The host speaks for the plugin; it does not lend it identities or routing.
const hostHeaders = new Set([
  "host",
  "cookie",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "forwarded",
]);
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
// An omitted trailing argument crosses the JSON bridge as null.
const scope = z.preprocess(
  (value) => value ?? {},
  z
    .object({ scope: z.enum(["workspace", "global"]).default("workspace") })
    .strict(),
);

export type HostGrant = {
  pluginId: string;
  workspace: string;
  contributions: ResolvedContributions;
  /** Views read; only actions write or leave the host. */
  mode: "read" | "write";
  /** Members see their workspace's data, never installation-wide values. */
  scopes: readonly SettingsScope[];
};

/** The host side of `host.*` for one program invocation. */
export class PluginHost {
  readonly used: Partial<Record<HostFunction, number>> = {};
  constructor(
    private readonly sql: Sql,
    private readonly grant: HostGrant,
    private readonly http: HttpTransport = guardedTransport,
    private readonly media?: { session: PluginMedia; actor: string },
  ) {}

  /** Function names this invocation may call. */
  get granted(): HostFunction[] {
    const caps = new Set<HostCapability>(
      this.grant.contributions.hostCapabilities,
    );
    return (Object.keys(hostFunctions) as HostFunction[]).filter(
      (name) =>
        caps.has(hostFunctions[name].capability) &&
        (this.grant.mode === "write" || hostFunctions[name].access === "read"),
    );
  }

  /** The last limit a call ran into; the guest only sees that it failed. */
  limit?: DomainError;
  readonly call: HostCall = async (name, args, signal) => {
    try {
      return await this.dispatch(name, args, signal);
    } catch (error) {
      if (error instanceof DomainError && [413, 429].includes(error.status))
        this.limit = error;
      throw error;
    }
  };
  private readonly dispatch: HostCall = async (name, args, signal) => {
    const fn = name as HostFunction;
    requireValue(this.granted.includes(fn), 403, "插件未声明此宿主能力");
    this.used[fn] = (this.used[fn] ?? 0) + 1;
    switch (fn) {
      case "media.probe":
      case "media.transcode":
      case "media.concat":
      case "media.extractFrame":
        requireValue(this.media, 403, "无法访问工作区媒体");
        return this.media.session.call(
          this.sql,
          this.grant.workspace,
          this.media.actor,
          fn,
          args,
          signal,
        );
      case "http.openStream":
        requireValue(!this.streamOpened, 400, "本次调用已打开响应流");
        this.streamOpened = true;
        return this.fetch(args, signal, true);
      case "http.readStream":
        return this.readStream(args, signal);
      case "http.fetch":
        return this.fetch(args, signal);
      case "data.get":
      case "data.put":
      case "data.delete":
      case "data.list":
        return this.data(fn, args);
    }
  };

  private streamOpened = false;
  private streamReading = false;
  private stream?: AsyncGenerator<Buffer>;
  private decoder = new TextDecoder();
  private async readStream(args: unknown[], signal: AbortSignal) {
    requireValue(
      args.length === 0 && this.stream && !this.streamReading,
      400,
      "流式读取状态无效",
    );
    const stream = this.stream;
    this.streamReading = true;
    try {
      signal.throwIfAborted();
      const { done, value } = await stream.next();
      if (done) this.stream = undefined;
      return {
        done: !!done,
        text: this.decoder.decode(value, { stream: !done }),
      };
    } catch (error) {
      this.stream = undefined;
      throw error;
    } finally {
      this.streamReading = false;
    }
  }
  private async fetch(args: unknown[], signal: AbortSignal, streaming = false) {
    const parsed = fetchInput.safeParse(
      args.length === 1 ? [args[0], {}] : args,
    );
    requireValue(parsed.success, 400, "请求参数无效");
    const [target, init] = parsed.data;
    const url = approvedURL(
      target,
      this.grant.contributions.http?.origins ?? [],
    );
    requireValue(
      init.json === undefined || init.body === undefined,
      400,
      "json 与 body 只能提供一个",
    );
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init.headers)) {
      requireValue(
        !hostHeaders.has(name.toLowerCase()) && !/[\r\n]/.test(value),
        400,
        "请求头无效：" + name,
      );
      headers[name] = value;
    }
    const body =
      init.json === undefined ? init.body : JSON.stringify(init.json);
    if (init.json !== undefined && !("content-type" in lower(headers)))
      headers["Content-Type"] = "application/json";
    requireValue(
      body === undefined || !["GET", "DELETE"].includes(init.method),
      400,
      "此请求方法不带正文",
    );
    requireValue(
      Buffer.byteLength(body ?? "") <= hostLimits.httpRequestBytes,
      413,
      "请求正文过大",
    );
    let response: Awaited<ReturnType<HttpTransport>>;
    try {
      response = await this.http(
        url,
        { method: init.method, headers, body },
        signal,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        502,
        (error as { code?: string }).code === "EINTERNAL"
          ? "请求地址指向内部网络"
          : "上游请求失败",
      );
    }
    // A redirect would leave the declared origins; hand it back unfollowed.
    const chunks = httpChunks(response.body, signal);
    if (streaming) {
      this.stream = chunks;
      // The invocation can return before reading the first chunk.
      const close = () => {
        if (response.body instanceof ReadableStream && !response.body.locked)
          void response.body.cancel().catch(() => {});
        void chunks.return(undefined).catch(() => {});
      };
      if (signal.aborted) {
        close();
        signal.throwIfAborted();
      }
      signal.addEventListener("abort", close, { once: true });
      return {
        status: response.status,
        ok: response.status >= 200 && response.status < 300,
        contentType: response.contentType,
      };
    }
    const parts: Buffer[] = [];
    for await (const chunk of chunks) parts.push(chunk);
    const text = Buffer.concat(parts).toString("utf8");
    let json: unknown;
    if (/\bjson\b/i.test(response.contentType))
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      contentType: response.contentType,
      text,
      json: json ?? null,
    };
  }

  private async data(fn: HostFunction, args: unknown[]) {
    const { pluginId, workspace } = this.grant;
    const options = scope.safeParse(args[fn === "data.put" ? 2 : 1]);
    requireValue(options.success, 400, "存储参数无效");
    const target = options.data.scope;
    requireValue(
      this.grant.scopes.includes(target),
      403,
      "此页面不能访问全站插件数据",
    );
    const where =
      target === "global"
        ? { clause: "plugin_id=$1 AND scope='global'", params: [pluginId] }
        : {
            clause: "plugin_id=$1 AND scope='workspace' AND workspace_id=$2",
            params: [pluginId, workspace],
          };
    const n = where.params.length;
    if (fn === "data.list") {
      const prefix = z
        .string()
        .max(200)
        .safeParse(args[0] ?? "");
      requireValue(prefix.success, 400, "存储键无效");
      const { rows } = await this.sql.query(
        `SELECT key FROM studio_plugin_data WHERE ${where.clause} AND starts_with(key,$${n + 1}) ORDER BY key LIMIT ${hostLimits.dataListKeys + 1}`,
        [...where.params, prefix.data],
      );
      return {
        keys: rows.slice(0, hostLimits.dataListKeys).map((r) => r.key),
        more: rows.length > hostLimits.dataListKeys,
      };
    }
    const name = key.safeParse(args[0]);
    requireValue(name.success, 400, "存储键无效");
    if (fn === "data.get")
      return (
        (
          await one(
            this.sql,
            `SELECT value FROM studio_plugin_data WHERE ${where.clause} AND key=$${n + 1}`,
            [...where.params, name.data],
          )
        )?.value ?? null
      );
    if (fn === "data.delete") {
      const { rows } = await this.sql.query(
        `DELETE FROM studio_plugin_data WHERE ${where.clause} AND key=$${n + 1} RETURNING 1`,
        [...where.params, name.data],
      );
      return rows.length > 0;
    }
    requireValue(args[1] !== undefined, 400, "缺少要保存的值");
    const value = JSON.stringify(args[1]);
    const bytes = Buffer.byteLength(value);
    requireValue(
      bytes <= hostLimits.dataValueBytes,
      413,
      "保存的值超过 256 KB",
    );
    // The installation lock serializes independent transactions. Within the
    // same invocation, parallel puts must check and change quota in one statement.
    const conflict =
      target === "global"
        ? "(plugin_id,key) WHERE scope='global'"
        : "(plugin_id,workspace_id,key) WHERE scope='workspace'";
    const stored = await one(
      this.sql,
      `WITH usage AS (
         SELECT coalesce(sum(bytes),0) AS bytes,count(*) AS keys,
           max(bytes) FILTER (WHERE ${where.clause} AND key=$${n + 1}) AS previous
         FROM studio_plugin_data WHERE plugin_id=$1
       )
       INSERT INTO studio_plugin_data(plugin_id,scope,workspace_id,key,value,bytes)
       SELECT $1,'${target}',${target === "global" ? "NULL" : "$2::uuid"},$${n + 1},$${n + 2}::jsonb,$${n + 3}::int FROM usage
       WHERE bytes-coalesce(previous,0)+$${n + 3}::int <= $${n + 4}
         AND keys+(previous IS NULL)::int <= $${n + 5}
       ON CONFLICT ${conflict} DO UPDATE SET value=excluded.value,bytes=excluded.bytes,updated_at=now()
       RETURNING 1`,
      [
        ...where.params,
        name.data,
        value,
        bytes,
        hostLimits.dataPluginBytes,
        hostLimits.dataPluginKeys,
      ],
    );
    requireValue(stored, 413, "插件数据超过容量上限");
    return true;
  }

  /** e.g. `http.fetch×2 data.put×1`, for the audit row. No arguments. */
  summary() {
    return Object.entries(this.used)
      .map(([name, count]) => name + "×" + count)
      .join(" ");
  }
}
const lower = (headers: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );

/** Removal completed: plugin data does not survive a later reinstall. */
export async function purgePluginData(sql: Sql, pluginId: string) {
  await sql.query("DELETE FROM studio_plugin_data WHERE plugin_id=$1", [
    pluginId,
  ]);
}
