import { forward } from "../../packages/web-compat/src/proxy";
export const originalMode = () => process.env.STUDIO_MODE !== "advanced";
export const originalBackend = () =>
  process.env.LEGACY_API_INTERNAL_URL || "";
export function proxy(request: Request) {
  return forward(
    request,
    originalMode()
      ? originalBackend()
      : process.env.API_INTERNAL_URL || "http://127.0.0.1:4000",
    originalMode(),
  );
}
export function proxyAdvanced(request: Request) {
  return forward(
    request,
    process.env.API_INTERNAL_URL || "http://127.0.0.1:4000",
  );
}
