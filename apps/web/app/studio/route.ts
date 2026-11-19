import {
  originalHeaders,
  originalUI,
} from "../../../../packages/web-compat/src/ui";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const html = await originalUI().html("index.html");
  return new Response(request.method === "HEAD" ? null : html, {
    headers: originalHeaders("text/html; charset=utf-8"),
  });
}
export const HEAD = GET;
