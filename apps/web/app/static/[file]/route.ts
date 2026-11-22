import {
  originalHeaders,
  originalUI,
  publicAssets,
} from "@fumiao/web-compat/ui";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  if (!publicAssets.has(file))
    return Response.json({ detail: "文件不存在" }, { status: 404 });
  const ui = originalUI();
  const bytes = await ui.file(file);
  const headers = originalHeaders(
    file.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : file.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "image/svg+xml",
  );
  if (new URL(request.url).searchParams.get("v") === (await ui.version(file))) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("cloudflare-cdn-cache-control", "public, max-age=86400");
  }
  return new Response(
    request.method === "HEAD" ? null : new Uint8Array(bytes),
    { headers },
  );
}
export const HEAD = GET;
