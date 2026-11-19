import { StreamableFile } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { Response } from "express";
const { rawJSON } = JSON as typeof JSON & { rawJSON(text: string): object };

/** Keep original JSON headers and avoid Express's automatic conditional 304 handling. */
export function originalJson(response: Response, body: unknown, status = 200) {
  const exactJson =
    response.locals.originalCanvas || response.locals.originalRecharge;
  let invalid = false;
  const serialized = JSON.stringify(body, (key, value) => {
    if (
      /[\uD800-\uDFFF]/u.test(key) ||
      (typeof value === "string" && /[\uD800-\uDFFF]/u.test(value)) ||
      (exactJson && typeof value === "number" && !Number.isFinite(value))
    )
      invalid = true;
    return exactJson && typeof value === "bigint"
      ? rawJSON(value.toString())
      : value;
  });
  // Starlette rejects lone surrogates and nonfinite numbers echoed by Pydantic.
  if (invalid) {
    response.status(500);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    return response.end("Internal Server Error");
  }
  const bytes = Buffer.from(serialized);
  response.status(status);
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Length", bytes.length);
  return response.end(bytes);
}
export class OriginalHttpAdapter extends ExpressAdapter {
  override reply(response: Response, body: any, statusCode?: number) {
    if (
      body !== null &&
      typeof body === "object" &&
      !(body instanceof StreamableFile)
    )
      return originalJson(response, body, statusCode ?? response.statusCode);
    return super.reply(response, body, statusCode);
  }
}
