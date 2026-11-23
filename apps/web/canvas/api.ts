// Original canvas wire contract. Workspace selection comes from /api/state and
// is carried explicitly so the list shares the editor's session and URLs.
export type Studio = {
  workspace_id: number;
  plugin_importers?: import("@fumiao/plugin-sdk/importers.js").ImporterEntry[];
  me: { nickname?: string; name: string };
};

export function workspaceURL(path: string, workspace: string | null) {
  const url = new URL(path, location.origin);
  if (workspace) url.searchParams.set("workspace", workspace);
  if (new URLSearchParams(location.search).get("studio_ui") === "react")
    url.searchParams.set("studio_ui", "react");
  return url.pathname + url.search + url.hash;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  workspace: string | null,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(workspace ? { "X-Workspace-Id": workspace } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      typeof value.detail === "string" ? value.detail : "请求未完成，请重试",
      response.status,
    );
  return value;
}
