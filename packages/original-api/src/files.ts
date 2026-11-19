/** Original FileResponse range semantics, with bounded streaming and private storage. */
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
export type PrivateFile = {
  size: number;
  mime: string;
  modified: number;
  open: (start?: number, end?: number) => Promise<Readable>;
};
export class RangeFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function integer(text: string): bigint | null {
  if (!/^[+-]?\d(?:_?\d)*$/.test(text)) return null;
  return BigInt(text.replaceAll("_", ""));
}
/** End offsets are exclusive, as in the pinned Starlette runtime. */
export function parseRanges(header: string, size: number): [number, number][] {
  const equal = header.indexOf("=");
  if (equal < 0) throw new RangeFailure(400, "Malformed range header.");
  if (header.slice(0, equal).trim().toLowerCase() !== "bytes")
    throw new RangeFailure(400, "Only support bytes range");
  const parts = header.slice(equal + 1).split(",");
  if (parts.length > 100) return [];
  const ranges: [bigint, bigint][] = [],
    limit = BigInt(size);
  for (let part of parts) {
    part = part.trim();
    if (!part || part === "-") continue;
    const dash = part.indexOf("-");
    if (dash < 0) continue;
    const first = part.slice(0, dash).trim(),
      last = part.slice(dash + 1).trim();
    const start = first ? integer(first) : null,
      end = last ? integer(last) : null;
    if (
      (first && start === null) ||
      (last && end === null) ||
      (!first && end === null)
    )
      continue;
    ranges.push([
      first ? start! : limit - end! > 0n ? limit - end! : 0n,
      first && last && end! < limit ? end! + 1n : limit,
    ]);
  }
  if (!ranges.length)
    throw new RangeFailure(400, "Range header: range must be requested");
  if (ranges.some(([start]) => start < 0 || start >= limit))
    throw new RangeFailure(416, "");
  if (ranges.some(([start, end]) => start >= end))
    throw new RangeFailure(400, "Range header: start must be less than end");
  ranges.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1,
  );
  const merged: [number, number][] = [];
  for (const [a, b] of ranges) {
    const start = Number(a),
      end = Number(b),
      last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
export function disposition(filename: string) {
  // urllib.parse.quote leaves slashes and unreserved characters intact.
  const encoded = encodeURIComponent(filename)
    .replaceAll("%2F", "/")
    .replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  return encoded === filename
    ? `attachment; filename="${filename}"`
    : `attachment; filename*=utf-8''${encoded}`;
}
export async function sendFile(
  req: Request,
  res: Response,
  file: PrivateFile,
  filename?: string,
) {
  const lastModified = new Date(Math.floor(file.modified) * 1000).toUTCString();
  const seconds = Number.isInteger(file.modified)
    ? file.modified.toFixed(1)
    : String(file.modified);
  const etag =
    '"' +
    createHash("md5")
      .update(seconds + "-" + file.size)
      .digest("hex") +
    '"';
  let ranges: [number, number][] = [];
  try {
    if (
      req.headers.range &&
      (!req.headers["if-range"] ||
        req.headers["if-range"] === etag ||
        req.headers["if-range"] === lastModified)
    )
      ranges = parseRanges(req.headers.range, file.size);
  } catch (error) {
    if (!(error instanceof RangeFailure)) throw error;
    if (error.status === 416)
      res.setHeader("Content-Range", `bytes */${file.size}`);
    res
      .status(error.status)
      .setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(error.message));
    res.end(error.message);
    return;
  }
  res.set({
    "Content-Type": file.mime,
    "Accept-Ranges": "bytes",
    "Last-Modified": lastModified,
    ETag: etag,
  });
  if (filename) res.setHeader("Content-Disposition", disposition(filename));
  let active: Readable | undefined,
    closed = false;
  async function* bytes(start: number, end: number) {
    if (start === end) return;
    active = await file.open(start, end - 1);
    if (closed) {
      active.destroy();
      active = undefined;
      return;
    }
    let sent = 0;
    try {
      for await (const chunk of active) {
        sent += chunk.length;
        if (sent > end - start) throw new Error("File size changed");
        yield chunk;
      }
      if (sent !== end - start) throw new Error("File is incomplete");
    } finally {
      active?.destroy();
      active = undefined;
    }
  }
  let body: AsyncGenerator<Buffer | Uint8Array>;
  if (ranges.length > 1) {
    const boundary = randomBytes(13).toString("hex");
    const header = (start: number, end: number) =>
      Buffer.from(
        `--${boundary}\r\nContent-Type: ${file.mime}\r\nContent-Range: bytes ${start}-${end - 1}/${file.size}\r\n\r\n`,
        "latin1",
      );
    const closing = Buffer.from(`--${boundary}--`);
    res
      .status(206)
      .setHeader("Content-Type", `multipart/byteranges; boundary=${boundary}`);
    res.setHeader(
      "Content-Length",
      ranges.reduce(
        (n, [a, b]) => n + header(a, b).length + b - a + 2,
        closing.length,
      ),
    );
    body = (async function* () {
      for (const [a, b] of ranges) {
        yield header(a, b);
        yield* bytes(a, b);
        yield Buffer.from("\r\n");
      }
      yield closing;
    })();
  } else {
    const [start, end] = ranges[0] || [0, file.size];
    if (ranges.length)
      res
        .status(206)
        .setHeader("Content-Range", `bytes ${start}-${end - 1}/${file.size}`);
    res.setHeader("Content-Length", end - start);
    body = bytes(start, end);
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const source = Readable.from(body),
    close = () => {
      closed = true;
      active?.destroy();
      source.destroy();
    };
  res.once("close", close);
  try {
    await pipeline(source, res);
  } catch (error) {
    if (!res.destroyed) res.destroy(error as Error);
  } finally {
    res.off("close", close);
    active?.destroy();
  }
}
