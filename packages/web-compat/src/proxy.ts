/** Streaming, single-attempt transport. Translation belongs in explicit adapters. */
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
function clean(headers: Headers) {
  for (const name of (headers.get("connection") || "").split(",")) {
    if (name.trim()) headers.delete(name.trim());
  }
  for (const name of hopHeaders) headers.delete(name);
  headers.delete("content-length");
}
export async function forward(request: Request, backend: string) {
  const incoming = new URL(request.url);
  // The Python comparison backend also exposes these old namespaces.
  // End requests at the public gateway before forwarding credentials or a body.
  const pathname = incoming.pathname.replace(/%([\da-f]{2})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  if (/^\/(?:api\/(?:admin\/)?)?fmworker(?:\/|$)/i.test(pathname)) {
    return new Response(
      request.method === "HEAD" ? null : JSON.stringify({ detail: "贡献服务已停用" }),
      {
        status: 410,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-fumiao-web": "next",
        },
      },
    );
  }
  const headers = new Headers(request.headers);
  clean(headers);
  headers.delete("host");
  for (const name of [...headers.keys()])
    if (name === "forwarded" || name.startsWith("x-forwarded-"))
      headers.delete(name);
  headers.set("accept-encoding", "identity");
  try {
    const url = new URL(backend);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Invalid internal API URL");
    url.pathname = incoming.pathname;
    url.search = incoming.search;
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      cache: "no-store",
      signal: request.signal,
      duplex: "half",
    } as RequestInit);
    const out = new Headers(response.headers);
    clean(out);
    out.delete("content-encoding");
    out.delete("set-cookie");
    for (const cookie of response.headers.getSetCookie())
      out.append("set-cookie", cookie);
    out.set("x-fumiao-web", "next");
    const privateMedia =
      incoming.pathname.startsWith("/media/") &&
      ["GET", "HEAD"].includes(request.method) &&
      [200, 206, 304].includes(response.status) &&
      out.get("cache-control") === "private, no-cache";
    if (privateMedia) {
      // A byte range must keep the length of the identity representation.
      const length = response.headers.get("content-length");
      if (length && !response.headers.has("content-encoding"))
        out.set("content-length", length);
    } else if (
      incoming.pathname.startsWith("/api/") ||
      incoming.pathname.startsWith("/media/")
    )
      out.set("cache-control", "private, no-store");
    return new Response(
      request.method === "HEAD" || [204, 205, 304].includes(response.status)
        ? null
        : response.body,
      { status: response.status, headers: out },
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      { detail: "后端暂时不可用" },
      {
        status: 502,
        headers: {
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-fumiao-web": "next",
        },
      },
    );
  }
}
