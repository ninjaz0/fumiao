/** Bounded read-only provider health probe. Never follows a redirect or exposes
 * the raw response in the platform's public queue snapshot. */
export async function healthJson(
  config: Record<string, unknown>,
  path: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    new URL(path, String(config.baseUrl).replace(/\/$/, "") + "/"),
    {
      signal,
      redirect: "error",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  );
  if (!response.ok || !response.body)
    throw Error("Provider health unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Error("Provider health exceeds limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Original provider readiness uses Python truthiness on JSON values. */
export function healthTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return !!value;
}
/** Keep int()'s distinction between numeric 2.5 and the invalid string "2.5". */
export function healthInteger(value: unknown): number {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string" && /^[+-]?\d(?:_?\d)*$/.test(value.trim()))
    return Number(value.trim().replaceAll("_", ""));
  if (typeof value === "number" && Number.isFinite(value))
    return Math.trunc(value);
  throw Error("Invalid provider capacity");
}
