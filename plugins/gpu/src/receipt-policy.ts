import { sha } from "./policy-crypto.js";
import type {
  ArtifactJob,
  ArtifactReceipt,
} from "@fumiao/plugin-sdk/preparation.js";
export function checkReport(
  job: ArtifactJob,
  receipt: ArtifactReceipt,
  fail: (message: string) => never,
) {
  const report = receiptReport(receipt.report),
    params = job.params;
  if (job.model === "MiniMax H3") {
    const expected = inputFingerprint(params.h3_inputs),
      steps = params.sampling_steps ?? 20;
    if (expected && report.h3_input_fingerprint !== expected)
      fail("成片参考模式与任务不一致，请更新实例后重试");
    const observed = report.sampling_steps;
    if (
      (observed === undefined && steps !== 20) ||
      (observed !== undefined && observed !== steps)
    )
      fail("成片采样步数与任务不一致，请更新实例后重新生成");
    const fast = report.fast_mode;
    if (
      (steps === 4 && fast !== true) ||
      (fast !== undefined && fast !== (steps === 4))
    )
      fail("成片快速模式与任务不一致，请更新实例后重新生成");
  }
  return report;
}

/** All frozen H3 numeric fields are integers or decimal durations in [1.99, 15.05]. */
export function inputFingerprint(value: Record<string, any> | undefined) {
  if (!value || !Object.keys(value).length) return "";
  const sorted = (v: any): string =>
    Array.isArray(v)
      ? "[" + v.map(sorted).join(",") + "]"
      : v && typeof v === "object"
        ? "{" +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + sorted(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v);
  return sha(
    sorted(value).replace(
      /[\u007f-\uffff]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    ),
  );
}
const trimNumber = (value: string) =>
  value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
function integer(value: unknown) {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string") {
    const trimmed = trimNumber(value);
    if (!/^[+-]?\d(?:_?\d)*(?:\.0+)?$/.test(trimmed)) throw Error();
    value = Number(trimmed.replaceAll("_", ""));
  }
  if (typeof value !== "number" || !Number.isInteger(value)) throw Error();
  return value;
}
function boolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (["1", "t", "true", "y", "yes", "on"].includes(v)) return true;
    if (["0", "f", "false", "n", "no", "off"].includes(v)) return false;
  }
  if (value === 0 || value === 1) return !!value;
  throw Error();
}
/** The old endpoint discards the entire timing header when any known field is invalid. */
export function receiptReport(text: string | undefined): Record<string, any> {
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, any> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === null && key !== "recovered") continue;
      if (key === "h3_input_fingerprint") {
        if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw Error();
        result[key] = v;
      } else if (
        [
          "sampling_steps",
          "peak_vram_bytes",
          "peak_allocated_vram_bytes",
        ].includes(key)
      ) {
        const n = integer(v);
        if (
          n < (key === "sampling_steps" ? 1 : 0) ||
          n > (key === "sampling_steps" ? 100 : 2 ** 50)
        )
          throw Error();
        result[key] = n;
      } else if (["fast_mode", "cold", "recovered"].includes(key))
        result[key] = boolean(v);
      else if (["prepare_s", "generate_s", "finalize_s"].includes(key)) {
        if (
          typeof v !== "boolean" &&
          typeof v !== "number" &&
          typeof v !== "string"
        )
          throw Error();
        let number: unknown = v;
        if (typeof v === "string") {
          const trimmed = trimNumber(v);
          if (
            trimmed.startsWith("_") ||
            trimmed.endsWith("_") ||
            trimmed.includes("__")
          )
            throw Error();
          number = trimmed.replaceAll("_", "");
          if (
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
              number as string,
            )
          )
            throw Error();
        }
        const n = Number(number);
        if (!Number.isFinite(n) || n < 0 || n > 172800) throw Error();
        result[key] = n;
      }
    }
    return result;
  } catch {
    return {};
  }
}
