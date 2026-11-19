import { proxy as studioProxy, proxyAdvanced } from "../../../proxy-backend";
export const dynamic = "force-dynamic";
function proxy(request: Request) {
  return new URL(request.url).pathname.startsWith("/agent/v2/")
    ? proxyAdvanced(request)
    : studioProxy(request);
}
export const GET = proxy,
  POST = proxy,
  PUT = proxy,
  PATCH = proxy,
  DELETE = proxy,
  HEAD = proxy;
