import { NextRequest, NextResponse } from "next/server";
import { originalHeaders } from "../../packages/web-compat/src/ui";
import { originalBackend, originalMode } from "./proxy-backend";

/** Migrated React pages need framework scripts and per-response nonces. */
export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  if (
    pathname === "/compat-canvas" ||
    pathname === "/compat-canvas-editor" ||
    pathname === "/compat-studio"
  )
    return new NextResponse(null, { status: 404 });
  const auth = pathname === "/studio";
  const canvas = pathname === "/canvas";
  const editor =
    /^\/canvas\/[^/]+$/.test(pathname) &&
    originalMode() &&
    process.env.STUDIO_CANVAS_EDITOR !== "legacy" &&
    searchParams.get("canvas_ui") !== "legacy" &&
    ["GET", "HEAD"].includes(request.method);
  const compat = auth || canvas || editor;
  if (!compat && pathname !== "/") return NextResponse.next();
  let studio = false;
  if (auth && originalMode() && searchParams.get("studio_ui") === "legacy")
    return NextResponse.next();
  if (canvas && !originalMode()) return NextResponse.next();
  if (auth || canvas) {
    if (!["GET", "HEAD"].includes(request.method)) return NextResponse.next();
    // React auth requires a definite guest, and the authenticated React pages
    // require a definite member. Let the pinned pages handle probe failures.
    try {
      const headers = new Headers();
      const cookie = request.headers.get("cookie");
      if (cookie) headers.set("cookie", cookie);
      const state = await fetch(new URL("/api/workspaces", originalBackend()), {
        headers,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
      });
      await state.body?.cancel();
      studio = auth && originalMode() && state.ok;
      if (auth ? !studio && state.status !== 401 : !state.ok)
        return NextResponse.next();
    } catch {
      return NextResponse.next();
    }
  }
  const location = compat
    ? null
    : process.env.STUDIO_MODE === "advanced"
      ? "/advanced"
      : searchParams.has("workspace") || searchParams.has("recharge")
        ? "/studio" + search
        : null;
  if (location) {
    const redirect = NextResponse.redirect(new URL(location, request.url), 307);
    redirect.headers.set("cache-control", "private, no-store");
    return redirect;
  }
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
    "/compat-canvas",
    "/compat-canvas-editor",
    "/compat-studio",
  ],
};
