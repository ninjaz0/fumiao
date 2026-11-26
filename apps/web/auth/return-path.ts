const canvasPath = /^\/canvas(?:\/[a-f0-9]{32})?$/;

function withParams(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? path + "?" + query : path;
}

function copyParams(search: URLSearchParams, keys: readonly string[]) {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = search.get(key);
    if (value && (key !== "workspace" || /^[1-9]\d*$/.test(value)))
      params.set(key, value);
  }
  return params;
}

const spaceParams = ["workspace", "studio_ui"] as const;

function canvasParams(path: string, search: URLSearchParams) {
  const params = copyParams(search, spaceParams);
  if (path === "/canvas" && search.getAll("view").at(-1) === "archived")
    params.set("view", "archived");
  return params;
}

export function canvasLoginPath(path: string, search: URLSearchParams) {
  const params = canvasParams(path, search);
  if (canvasPath.test(path)) params.set("next", path);
  return withParams("/studio", params);
}

export function canvasReturnPath(search: URLSearchParams) {
  const next = search.get("next");
  return next && canvasPath.test(next)
    ? withParams(next, canvasParams(next, search))
    : undefined;
}

export function studioLoginDestination(search: URLSearchParams) {
  return canvasReturnPath(search) ?? withParams("/studio", copyParams(search, [
    ...spaceParams, "recharge", "settings", "scope", "page",
  ]));
}
