import { NextRequest, NextResponse } from "next/server";
import { originalHeaders } from "@fumiao/web-compat/ui";
import { canvasLoginPath, canvasReturnPath } from "./auth/return-path";
import { backend } from "./proxy-backend";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function unavailableHtml(request: NextRequest) {
  const retryHref = escapeHtml(
    request.nextUrl.pathname + request.nextUrl.search || "/studio",
  );
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="5"><title>弗淼 AIGC</title>' +
    "<style>" +
    ":root{--bg:#f8f9fa;--surface:#ffffff;--text:#09090b;--secondary:#52525b;--line:#e4e4e7;--blue:#3686ad;--blue-hover:#2d7396;--accent-soft:rgba(54,134,173,0.12);--btn-fg:#ffffff;--shadow:0 1px 3px rgba(9,9,11,0.06)}" +
    "@media (prefers-color-scheme: dark){:root{--bg:#111111;--surface:#1e1e1e;--text:#f4f5f7;--secondary:#a1a8b3;--line:rgba(255,255,255,0.09);--blue:#68a8db;--blue-hover:#7bb5e3;--accent-soft:rgba(104,168,219,0.15);--btn-fg:#0b141c;--shadow:0 8px 24px rgba(0,0,0,0.36)}}" +
    "*{box-sizing:border-box}" +
    'body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif}' +
    ".card{width:100%;max-width:420px;padding:28px 26px;border-radius:12px;border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow);display:flex;flex-direction:column;gap:14px}" +
    ".head{display:flex;align-items:center;justify-content:space-between;gap:12px}" +
    ".brand{display:inline-flex;align-items:center;gap:9px;font-size:14px;font-weight:600}" +
    ".badge{padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--blue);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}" +
    "h1{margin:2px 0 0;font-size:18px;font-weight:600;line-height:1.4}" +
    "p{margin:0;font-size:13.5px;line-height:1.6;color:var(--secondary)}" +
    ".actions{margin-top:6px;display:flex;align-items:center}" +
    ".btn{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 16px;border-radius:8px;background:var(--blue);color:var(--btn-fg);font-size:13.5px;font-weight:600;text-decoration:none}" +
    ".btn:hover{background:var(--blue-hover)}" +
    ".btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}" +
    "</style></head><body>" +
    '<main class="card"><div class="head"><span class="brand">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path fill="#a9eee4" d="M7 33 18 7h8L15 33z"/><path fill="#6db6fb" d="m18 39 12-29h8L26 39z"/><path fill="#b7a9fc" d="m31 36 6-15h7l-6 15z"/></svg>' +
    '<span>弗淼 AIGC</span></span><span class="badge">503</span></div>' +
    "<h1>服务暂时不可用</h1>" +
    "<p>服务暂时不可用，页面会自动重试。</p>" +
    `<div class="actions"><a class="btn" href="${retryHref}">刷新重试</a></div>` +
    "</main></body></html>"
  );
}

// The pages below need the API; reload until it answers again.
const unavailable = (request: NextRequest) =>
  new NextResponse(
    request.method === "HEAD" ? null : unavailableHtml(request),
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "retry-after": "5",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
const redirect = (request: NextRequest, location: string) => {
  const response = NextResponse.redirect(new URL(location, request.url), 307);
  response.headers.set("cache-control", "private, no-store");
  return response;
};

/** React pages need framework scripts and per-response nonces. */
export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  if (
    pathname === "/compat-auth" ||
    pathname === "/compat-canvas" ||
    pathname === "/compat-canvas-editor" ||
    pathname === "/compat-studio"
  )
    return new NextResponse(null, { status: 404 });
  const read = ["GET", "HEAD"].includes(request.method);
  const auth = pathname === "/studio";
  const canvas = pathname === "/canvas";
  const editor = /^\/canvas\/[^/]+$/.test(pathname);
  const compat = auth || canvas || editor;
  if (!compat && pathname !== "/") return NextResponse.next();
  if (compat && !read) return new NextResponse(null, { status: 405 });
  let studio = false;
  if (auth || canvas) {
    // React auth requires a definite guest, and the authenticated React pages
    // require a definite member.
    try {
      const headers = new Headers();
      const cookie = request.headers.get("cookie");
      if (cookie) headers.set("cookie", cookie);
      const state = await fetch(new URL("/api/workspaces", backend()), {
        headers,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
      });
      await state.body?.cancel();
      studio = auth && state.ok;
      if (!state.ok && state.status !== 401) return unavailable(request);
      if (canvas && !state.ok)
        return redirect(request, canvasLoginPath(pathname, searchParams));
      if (studio) {
        const destination = canvasReturnPath(searchParams);
        if (destination) return redirect(request, destination);
      }
    } catch {
      return unavailable(request);
    }
  }
  if (!compat && (searchParams.has("workspace") || searchParams.has("recharge")))
    return redirect(request, "/studio" + search);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const security = originalHeaders("text/html; charset=utf-8");
  const csp = security
    .get("content-security-policy")!
    .replace(
      "script-src 'self'",
      `script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-fumiao-home", compat ? "0" : "1");
  headers.set("x-fumiao-auth", auth && !studio ? "1" : "0");
  headers.set("x-fumiao-canvas", canvas ? "1" : "0");
  headers.set("x-fumiao-canvas-editor", editor ? "1" : "0");
  headers.set("x-fumiao-studio", studio ? "1" : "0");
  headers.set("Content-Security-Policy", csp);
  const destination = studio
    ? "/compat-studio"
    : auth
      ? "/compat-auth"
      : editor
        ? "/compat-canvas-editor"
        : "/compat-canvas";
  const response = compat
    ? NextResponse.rewrite(new URL(destination + search, request.url), {
        request: { headers },
      })
    : NextResponse.next({ request: { headers } });
  for (const [key, value] of security)
    if (key !== "content-type") response.headers.set(key, value);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
export const config = {
  matcher: [
    "/",
    "/studio",
    "/canvas",
    "/canvas/:project",
    "/compat-auth",
    "/compat-canvas",
    "/compat-canvas-editor",
    "/compat-studio",
  ],
};
