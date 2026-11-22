import { forward } from "../../packages/web-compat/src/proxy";
export const backend = () =>
  process.env.API_INTERNAL_URL || "";
export function proxy(request: Request) {
  return forward(request, backend());
}
