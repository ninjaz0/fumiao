import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

export const publicAssets = new Set([
  "studio.js",
  "studio.css",
  "mark.svg",
  "theme.js",
  "canvas.js",
  "canvas.css",
  "chat.js",
  "chat.css",
  "flowpicker.js",
  "home.js",
  "home.css",
]);
type Manifest = { files: Record<string, { sha256: string; size: number }> };
export class OriginalUI {
  private manifest?: Promise<Manifest>;
  private cache = new Map<string, Promise<Buffer>>();
  constructor(readonly root: string) {}
  private metadata() {
    return (this.manifest ||= readFile(
      join(this.root, "baseline/production/manifest.json"),
      "utf8",
    ).then(JSON.parse));
  }
  async file(name: string): Promise<Buffer> {
    const manifest = await this.metadata();
    const expected = manifest.files["static/" + name];
    if (!expected || !/^(?:avatars\/)?[a-zA-Z0-9.-]+$/.test(name))
      throw new Error("Unknown public UI asset");
    let cached = this.cache.get(name);
    if (!cached) {
      cached = (async () => {
        const bytes = await readFile(
          join(this.root, "baseline/production/static", name),
        );
        if (
          bytes.length !== expected.size ||
          createHash("sha256").update(bytes).digest("hex") !== expected.sha256
        )
          throw new Error("Original UI hash mismatch: " + name);
        return bytes;
      })();
      this.cache.set(name, cached);
    }
    return cached;
  }
  async version(name: string) {
    if (!publicAssets.has(name)) throw new Error("Unknown fingerprinted asset");
    await this.file(name);
    return (await this.metadata()).files["static/" + name].sha256.slice(0, 20);
  }
  async html(name: "home.html" | "index.html" | "canvas.html", member = false) {
    const source = (await this.file(name)).toString("utf8");
    const versions = Object.fromEntries(
      await Promise.all(
        [...publicAssets].map(async (asset) => [
          asset,
          await this.version(asset),
        ]),
      ),
    );
    let html = source.replace(
      /(["'])\/static\/([a-z.]+)\1/g,
      (match, quote, asset) =>
        versions[asset]
          ? `${quote}/static/${asset}?v=${versions[asset]}${quote}`
          : match,
    );
    if (name === "home.html") {
      if (member)
        html = html.replace('data-session="guest"', 'data-session="member"');
    } else
      html = html.replace(
        "</head>",
        `<meta name="fm-chat-script" content="/static/chat.js?v=${versions["chat.js"]}"></head>`,
      );
    return html;
  }
  async verify() {
    const names = Object.keys((await this.metadata()).files)
      .filter((n) => n.startsWith("static/"))
      .map((n) => n.slice(7));
    await Promise.all(names.map((name) => this.file(name)));
    return names.length;
  }
}
let instance: OriginalUI | undefined;
export function originalUI() {
  if (!instance) {
    const root = [
      process.env.FUMIAO_REPOSITORY_ROOT,
      process.cwd(),
      resolve(process.cwd(), "../.."),
    ].find(
      (root) =>
        root && existsSync(join(root, "baseline/production/manifest.json")),
    );
    if (!root) throw new Error("Original UI baseline is not packaged");
    instance = new OriginalUI(root);
  }
  return instance;
}
export function originalHeaders(type: string) {
  const media = process.env.STUDIO_MEDIA_ORIGIN
    ? new URL(process.env.STUDIO_MEDIA_ORIGIN).origin
    : "";
  return new Headers({
    "content-type": type,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-fumiao-web": "next",
    "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: ${media}; media-src 'self' blob: ${media}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  });
}
