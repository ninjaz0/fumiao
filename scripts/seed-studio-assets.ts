import { pathToFileURL } from "node:url";
import sharp from "sharp";

export async function seedStudioAssets(
  origin: string,
  cookie: string,
  workspace: string,
  count = 205,
) {
  const url = new URL("/api/assets", origin);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !url.hostname.endsWith(".localhost")
  )
    throw new Error("Only local development instances may be seeded");
  const bytes = await sharp({
    create: { width: 17, height: 13, channels: 3, background: "#7a3f9d" },
  })
    .png()
    .toBuffer();
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "X-Workspace-Id": workspace,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok)
      throw new Error(`Upload ${i + 1} failed: HTTP ${response.status}`);
    keys.push("asset:" + (await response.json()).id);
  }
  return keys;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { STUDIO_URL, STUDIO_COOKIE, STUDIO_WORKSPACE } = process.env;
  if (!STUDIO_URL || !STUDIO_COOKIE || !STUDIO_WORKSPACE)
    throw new Error(
      "Set STUDIO_URL, STUDIO_COOKIE and STUDIO_WORKSPACE for a local test instance",
    );
  const keys = await seedStudioAssets(
    STUDIO_URL,
    STUDIO_COOKIE,
    STUDIO_WORKSPACE,
  );
  console.log(`Seeded ${keys.length} image assets`);
}
