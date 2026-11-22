import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
export const paymentConfig = z.object({
  gateway: z
    .url()
    .refine(
      (s) =>
        new URL(s).protocol === "https:" &&
        !new URL(s).username &&
        !new URL(s).password &&
        !new URL(s).search &&
        !new URL(s).hash,
    ),
  pid: z.string().min(1),
  key: z.string().min(1),
  cid: z.string().optional(),
});
export type PaymentConfig = z.infer<typeof paymentConfig>;
export type PaymentOrder = {
  id: string;
  method: string;
  amount: number;
  credits: number;
  trade_id?: string | null;
};
function signedScalar(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Invalid signed value");
  return String(value);
}
export function sign(
  values: Record<string, unknown>,
  key: string,
  epusdt = false,
  scalar = signedScalar,
  compareKeys?: (left: string, right: string) => number,
) {
  const excluded = epusdt ? ["signature"] : ["sign", "sign_type"];
  const text = Object.keys(values)
    .sort(compareKeys)
    .filter(
      (k) => !excluded.includes(k) && values[k] !== "" && values[k] != null,
    )
    .map((k) => k + "=" + scalar(values[k]))
    .join("&");
  return epusdt
    ? createHmac("sha256", key).update(text).digest("hex")
    : createHash("md5")
        .update(text + key)
        .digest("hex");
}
export async function gatewayBytes(
  url: string,
  body?: URLSearchParams | string,
  original = false,
) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    body,
    headers: {
      Accept: "*/*",
      ...(original ? { "User-Agent": "Fumiao-Payments/1.0" } : {}),
      ...(original && body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(original ? 4000 : 10000),
  });
  if (!response.ok || !response.body) throw new Error("Gateway unavailable");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > 131072) throw new Error("Gateway response too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
