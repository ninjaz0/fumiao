import {
  originalHeaders,
  originalUI,
} from "@fumiao/web-compat/ui";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  if (
    !/^(alpine|flower|forest|island|leaf|moon|orange|planet|rainbow|sail|sunrise|waves)\.svg$/.test(
      file,
    )
  )
    return Response.json({ detail: "头像不存在" }, { status: 404 });
  const bytes = await originalUI().file("avatars/" + file);
  return new Response(
    request.method === "HEAD" ? null : new Uint8Array(bytes),
    { headers: originalHeaders("image/svg+xml") },
  );
}
export const HEAD = GET;
