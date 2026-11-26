import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  createGunzip,
  createInflate,
  createInflateRaw,
  constants,
} from "node:zlib";
import type { IncomingMessage } from "node:http";
import { Transform, type Readable, type TransformCallback } from "node:stream";
export class ChatTransportError extends Error {}
export class ProviderBodyTooLarge extends ChatTransportError {}
/** httpx retries raw deflate only when the first compressed chunk fails. */
class Deflate extends Transform {
  private decoder = createInflate({ finishFlush: constants.Z_SYNC_FLUSH });
  private first = true;
  private pending: ((error?: Error | null) => void) | undefined;
  constructor() {
    super();
    this.attach();
  }
  private attach() {
    this.decoder.on("data", (chunk) => this.push(chunk));
    this.decoder.on("error", (error) => this.pending?.(error));
  }
  override _transform(
    chunk: Buffer,
    _: BufferEncoding,
    callback: TransformCallback,
  ) {
    const first = this.first;
    this.first = false;
    let done = false;
    const complete = (error?: Error | null) => {
      if (done) return;
      done = true;
      this.pending = undefined;
      callback(error);
    };
    let attempted = false;
    const accept = (error?: Error | null) => {
      if (done || attempted) return;
      if (error && first) {
        attempted = true;
        this.decoder.destroy();
        this.decoder = createInflateRaw({
          finishFlush: constants.Z_SYNC_FLUSH,
        });
        this.attach();
        this.pending = complete;
        this.decoder.write(chunk, complete);
      } else complete(error);
    };
    this.pending = accept;
    this.decoder.write(chunk, accept);
  }
  override _flush(callback: TransformCallback) {
    let done = false;
    const complete = (error?: Error | null) => {
      if (done) return;
      done = true;
      this.pending = undefined;
      callback(error);
    };
    this.pending = complete;
    this.decoder.once("end", complete);
    this.decoder.end();
  }
  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) {
    this.decoder.destroy();
    callback(error);
  }
}
const forbiddenExtraHeaders = new Set([
  "authorization",
  "host",
  "cookie",
  "content-length",
  "content-type",
  "accept-encoding",
  "connection",
  "transfer-encoding",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "idempotency-key",
]);

/** One request, no replay/redirect; connect and read-idle budgets match httpx.
 * Closing the consumer closes every decoder and the underlying socket. */
export async function chatHttp(
  url: URL,
  options: {
    method: "GET" | "POST";
    key?: string;
    forwarded?: { host: string; scheme: string };
    extraHeaders?: Record<string, string>;
    body?: unknown;
    signal: AbortSignal;
    connectMs: number;
    readMs: number;
    lookup?: import("node:net").LookupFunction;
    idempotencyKey?: string;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
  },
) {
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Unsupported provider protocol");
  const body =
    options.body === undefined
      ? undefined
      : Buffer.from(JSON.stringify(options.body));
  if (body && body.length > (options.maxRequestBytes ?? Infinity))
    throw new ChatTransportError("Provider request exceeds byte limit");
  const safeExtra: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.extraHeaders ?? {})) {
    const lower = name.toLowerCase();
    if (
      forbiddenExtraHeaders.has(lower) ||
      !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) ||
      /[\r\n\0]/.test(value)
    )
      continue;
    safeExtra[name] = value;
  }
  const headers: Record<string, string | number> = {
    ...safeExtra,
    ...(options.key === undefined
      ? {}
      : { Authorization: "Bearer " + options.key }),
    ...(options.forwarded
      ? {
          "X-Forwarded-Host": options.forwarded.host,
          "X-Forwarded-Proto": options.forwarded.scheme,
        }
      : {}),
    Accept: "*/*",
    ...(options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : {}),
    "Accept-Encoding": "gzip, deflate",
    ...(body
      ? { "Content-Type": "application/json", "Content-Length": body.length }
      : {}),
  };
  const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
    method: options.method,
    headers,
    signal: options.signal,
    agent: false,
    lookup: options.lookup,
  });
  const connectionTimer = setTimeout(
    () => req.destroy(new Error("Provider connect timeout")),
    options.connectMs,
  );
  const connected = () => clearTimeout(connectionTimer);
  req.on("socket", (socket) => {
    if (socket.connecting)
      socket.once(
        url.protocol === "https:" ? "secureConnect" : "connect",
        connected,
      );
    else connected();
  });
  req.setTimeout(options.readMs, () =>
    req.destroy(new Error("Provider read timeout")),
  );
  let source: IncomingMessage;
  try {
    source = await new Promise<IncomingMessage>((resolve, reject) => {
      req.once("response", resolve);
      req.once("error", reject);
      req.end(body);
    });
  } catch {
    req.destroy();
    throw new ChatTransportError("Provider request failed");
  } finally {
    connected();
  }
  const streams: Readable[] = [source];
  const close = () => {
    for (const stream of streams) stream.destroy();
    req.destroy();
  };
  let decoded: Readable = source;
  for (const coding of String(source.headers["content-encoding"] || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .reverse()) {
    const decoder =
      coding === "gzip"
        ? createGunzip({ finishFlush: constants.Z_SYNC_FLUSH })
        : coding === "deflate"
          ? new Deflate()
          : undefined;
    if (!decoder) continue;
    decoded.on("error", (error) => decoder.destroy(error));
    decoded = decoded.pipe(decoder);
    streams.push(decoder);
  }
  for (const stream of streams) stream.on("error", () => {});
  async function* bytes() {
    try {
      let received = 0;
      for await (const chunk of decoded) {
        received += chunk.length;
        if (received > (options.maxResponseBytes ?? Infinity))
          throw new ProviderBodyTooLarge(
            "Provider response exceeds byte limit",
          );
        yield chunk as Buffer;
      }
    } catch (error) {
      if (error instanceof ProviderBodyTooLarge) throw error;
      throw new ChatTransportError("Provider response interrupted");
    }
  }
  return {
    status: source.statusCode!,
    headers: source.headers,
    body: bytes(),
    close,
  };
}

/** Python/httpx splitlines, including CR across chunks and Unicode separators.
 * Keep at most one permitted line: oversized incomplete lines are discarded,
 * but fail only at their original newline/EOF boundary (disconnect still wins). */
export async function* chatLines(
  body: AsyncIterable<Uint8Array>,
  contentType: string,
) {
  const charset = (
    /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]?.toLowerCase() ||
    "utf-8"
  ).replaceAll("_", "-");
  const decode = textDecoder(charset);
  let pieces: string[] = [],
    length = 0,
    trailingCr = false;
  const append = (text: string) => {
    if (length > 1024 * 1024) return;
    for (const _ of text) length++;
    if (length > 1024 * 1024) pieces = [];
    else if (text) pieces.push(text);
  };
  const finish = () => {
    if (length > 1024 * 1024) throw new Error("chat-line-too-long");
    const result = pieces.join("");
    pieces = [];
    length = 0;
    return result;
  };
  function* lines(text: string) {
    if (trailingCr) {
      text = "\r" + text;
      trailingCr = false;
    }
    if (text.endsWith("\r")) {
      trailingCr = true;
      text = text.slice(0, -1);
    }
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (![10, 11, 12, 13, 28, 29, 30, 133, 8232, 8233].includes(code))
        continue;
      append(text.slice(start, i));
      yield finish();
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
    append(text.slice(start));
  }
  for await (const bytes of body) {
    const text = decode(bytes);
    if (text) yield* lines(text);
  }
  const flushed = decode(new Uint8Array(), true);
  if (flushed) yield* lines(flushed);
  if (length || trailingCr) yield finish();
}

// Python distinguishes ISO-8859-1 from Windows-1252 and explicit-endian codecs
// from BOM-selected UTF-16/32. WHATWG labels alone do not preserve these rules.
function textDecoder(charset: string) {
  const label = charset.replace(/[-_ ]/g, "");
  if (
    [
      "iso88591",
      "iso88591987",
      "latin1",
      "latin",
      "l1",
      "cp819",
      "ibm819",
    ].includes(label)
  )
    return (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
  if (["ascii", "usascii", "646", "iso646us", "ansix3.41968"].includes(label))
    return (bytes: Uint8Array) =>
      Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : "�")).join(
        "",
      );
  const unicode = /^utf(16|32)(le|be)?$/.exec(label);
  let decoder: TextDecoder | undefined,
    pending = Buffer.alloc(0),
    little = unicode?.[2] !== "be",
    started = !!unicode?.[2];
  if (!unicode) {
    try {
      decoder = new TextDecoder(
        label === "utf8sig" || label === "cp65001" ? "utf-8" : charset,
        { ignoreBOM: label !== "utf8sig" },
      );
    } catch {
      decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    }
  } else if (unicode[1] === "16" && started)
    decoder = new TextDecoder(little ? "utf-16le" : "utf-16be", {
      ignoreBOM: true,
    });
  return (bytes: Uint8Array, final = false) => {
    if (!unicode || decoder) return decoder!.decode(bytes, { stream: !final });
    pending = Buffer.concat([pending, bytes]);
    const width = Number(unicode[1]) / 8;
    if (!started) {
      if (pending.length < width && !final) return "";
      if (!pending.length) return "";
      const bom = pending.subarray(0, width).toString("hex");
      if (bom === (width === 2 ? "fffe" : "fffe0000")) little = true;
      else if (bom === (width === 2 ? "feff" : "0000feff")) little = false;
      else throw new Error("Unicode stream requires BOM");
      started = true;
      pending = pending.subarray(width);
      if (width === 2) {
        decoder = new TextDecoder(little ? "utf-16le" : "utf-16be", {
          ignoreBOM: true,
        });
        const text = decoder.decode(pending, { stream: !final });
        pending = Buffer.alloc(0);
        return text;
      }
    }
    const parts: string[] = [];
    let i = 0;
    for (; i + 4 <= pending.length; i += 4) {
      const code = little ? pending.readUInt32LE(i) : pending.readUInt32BE(i);
      parts.push(
        code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
          ? "�"
          : String.fromCodePoint(code),
      );
    }
    pending = pending.subarray(i);
    if (final && pending.length) {
      parts.push("�");
      pending = Buffer.alloc(0);
    }
    return parts.join("");
  };
}
