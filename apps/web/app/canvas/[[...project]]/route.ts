import {
  originalHeaders,
  originalUI,
} from "../../../../../packages/web-compat/src/ui";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ project?: string[] }> },
) {
  if (((await context.params).project || []).length > 1)
    return new Response(null, { status: 404 });
  const html = await originalUI().html("canvas.html");
  return new Response(request.method === "HEAD" ? null : html, {
    headers: originalHeaders("text/html; charset=utf-8"),
  });
}
export const HEAD = GET;
