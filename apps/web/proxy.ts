import { NextRequest, NextResponse } from "next/server";
import { originalHeaders } from "../../packages/web-compat/src/ui";
import { backend } from "./proxy-backend";

// The pages below need the API; reload until it answers again.
const unavailable = (request: NextRequest) =>
  new NextResponse(
    request.method === "HEAD"
      ? null
      : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>弗淼 AIGC</title><p>服务暂时不可用，页面会自动重试。</p></html>',
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "retry-after": "5",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
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
      if (canvas && !state.ok) return redirect(request, "/studio");
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
