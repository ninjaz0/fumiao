import { ApiError } from "../canvas/api";

type ValidationIssue = {
  type?: unknown;
  loc?: unknown;
  msg?: unknown;
  ctx?: unknown;
};

const fieldLabels: Record<string, string> = {
  name: "名称",
  nickname: "昵称",
  password: "密码",
  current_password: "当前密码",
  expires: "到期时间",
  initial_credits: "赠送积分",
  amount: "数量",
  note: "原因",
  members: "成员",
  team_id: "团队",
  code: "邀请码",
};

function issueField(loc: unknown): string {
  if (!Array.isArray(loc)) return "";
  const parts = loc.filter(
    (part, index) =>
      !(
        index === 0 &&
        (part === "body" || part === "query" || part === "path")
      ),
  );
  const last = parts.at(-1);
  if (typeof last === "string") return fieldLabels[last] ?? last;
  const first = parts.find((part): part is string => typeof part === "string");
  return first ? (fieldLabels[first] ?? first) : "";
}

function formatIssue(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const { type, loc, msg, ctx } = entry as ValidationIssue;
  const field = issueField(loc);
  const context =
    ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : {};
  if (type === "missing") return field ? `${field}不能为空` : "缺少必填项";
  if (type === "string_too_short") {
    const min = context.min_length;
    if (min === 1) return field ? `${field}不能为空` : "输入内容不能为空";
    if (typeof min === "number")
      return `${field || "输入内容"}至少需要 ${min} 个字符`;
  }
  if (type === "string_too_long" && typeof context.max_length === "number")
    return `${field || "输入内容"}最多 ${context.max_length} 个字符`;
  if (
    type === "int_from_float" ||
    type === "int_type" ||
    type === "int_parsing"
  )
    return `${field || "数值"}需为整数`;
  if (type === "greater_than_equal" && typeof context.ge === "number")
    return `${field || "数值"}不能小于 ${context.ge}`;
  if (type === "greater_than" && typeof context.gt === "number")
    return `${field || "数值"}必须大于 ${context.gt}`;
  if (type === "less_than_equal" && typeof context.le === "number")
    return `${field || "数值"}不能大于 ${context.le}`;
  if (typeof msg === "string" && msg.trim()) {
    const text = msg.trim().replace(/^Value error,\s*/i, "");
    return field ? `${field}：${text}` : text;
  }
  return "";
}

export function errorDetail(detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = [...new Set(detail.map(formatIssue).filter(Boolean))];
    if (messages.length) return messages.join("；");
  }
  return "请求未完成，请检查输入后重试";
}

export async function api<T>(
  workspace: string | null,
  path: string,
  body?: object,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const raw = body instanceof File;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(workspace ? { "X-Workspace-Id": workspace } : {}),
      ...(body && !raw ? { "Content-Type": "application/json" } : {}),
      ...(raw && body.name
        ? { "X-File-Name": encodeURIComponent(body.name) }
        : {}),
    },
    body: raw ? body : body && JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(errorDetail(value.detail), response.status);
  }
  return value;
}
