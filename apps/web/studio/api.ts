import { ApiError } from "../canvas/api";

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
    throw new ApiError(
      typeof value.detail === "string"
        ? value.detail
        : "请求未完成，请检查输入后重试",
      response.status,
    );
  }
  return value;
}
