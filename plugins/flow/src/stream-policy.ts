import { flowUnescape } from "./html.js";
import type { Receipt } from "@fumiao/plugin-sdk/index.js";
export const truthy = (v: any): boolean =>
  v !== null &&
  v !== undefined &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length > 0);
export const record = (v: any): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid Flow record");
  return v;
};
export class FlowFailure extends Error {}
export function flowSafeError(status: number, text: unknown = ""): string {
  if (typeof text !== "string") throw new Error("Invalid Flow error");
  const message = text.toLowerCase();
  if (message.includes("public_error_unusual_activity"))
    return "Google Flow 暂时拒绝生成（异常活动检查），请在官方页面核对账号状态后再试";
  if (status === 401) return "Flow 接口密钥失效，请管理员检查配置";
  if (message.includes("captcha"))
    return "Flow 验证码服务未通过，请管理员检查 YesCaptcha 配置与余额";
  if (
    [
      "no available",
      "no valid token",
      "没有可用",
      "无可用",
      "token is expired",
    ].some((x) => message.includes(x))
  )
    return "Flow 暂无可用账号，请管理员检查账号启用状态和 Google Flow 登录态";
  if (["quota", "credit", "余额", "额度"].some((x) => message.includes(x)))
    return "Flow 账号额度不足或当前模型不可用，请管理员检查账号";
  if (
    ["safety", "policy", "sensitive", "unsafe", "违规"].some((x) =>
      message.includes(x),
    )
  )
    return "Flow 未通过内容审核，请调整提示词或参考图";
  if (status === 429) return "Flow 请求频率受限，请稍后重新生成";
  if ([400, 403, 404].includes(status))
    return "Flow 未接受当前模型或参数，请检查账号权限与所选模型";
  return "Flow 生成失败，请稍后重试；详情可在 Flow 后台查看";
}
const whitespace =
  "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export function flowResult(
  kind: string,
  text: string,
  diagnostics: string[],
): Receipt {
  const video =
    /<video(?![\p{L}\p{N}_])[^>]*(?<![\p{L}\p{N}_])src=["']([^"']+)/u.exec(
      text,
    );
  const image = new RegExp(
    "!\\[[^\\]]*\\]\\(([^" + whitespace + ")]+)\\)",
    "u",
  ).exec(text);
  const match = kind === "video" ? video : image;
  const url = match
    ? flowUnescape(match[1])
    : text
        .match(new RegExp("https?://[^" + whitespace + "<>\"')]+", "gu"))
        ?.at(-1);
  if (!url)
    throw new FlowFailure(flowSafeError(502, text + diagnostics.join(" ")));
  const media =
    /(?<![\p{L}\p{N}_])data-media-id=["']([A-Za-z0-9_./:-]{1,300})["']/u.exec(
      text,
    );
  return {
    state: "completed",
    artifacts: [{ url }],
    usage: { flow_media_id: media?.[1] ?? null },
  };
}
export function collectFlowEvent(
  data: unknown,
  chunks: string[],
  diagnostics: string[],
) {
  const event = record(data);
  if (truthy(event.error)) {
    const err = event.error,
      message =
        typeof err === "object" && !Array.isArray(err)
          ? Object.hasOwn(err, "message")
            ? err.message
            : ""
          : typeof err === "string"
            ? err
            : JSON.stringify(err);
    throw new FlowFailure(flowSafeError(502, message));
  }
  const choices = Object.hasOwn(event, "choices") ? event.choices : [];
  const emptyIterable =
    choices === "" ||
    (choices &&
      typeof choices === "object" &&
      !Array.isArray(choices) &&
      Object.keys(choices).length === 0);
  if (!Array.isArray(choices) && !emptyIterable)
    throw new Error("Invalid Flow choices");
  for (const entry of emptyIterable ? [] : choices) {
    const choice = record(entry),
      delta = record(
        Object.hasOwn(choice, "delta")
          ? choice.delta
          : Object.hasOwn(choice, "message")
            ? choice.message
            : {},
      );
    if (typeof delta.reasoning_content === "string")
      diagnostics.push(delta.reasoning_content);
    if (typeof delta.content === "string") chunks.push(delta.content);
  }
}
