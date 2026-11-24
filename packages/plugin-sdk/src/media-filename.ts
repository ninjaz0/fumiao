export type ContentDispositionType = "attachment" | "inline";

const MEDIA_EXTENSIONS: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const KNOWN_AV_EXT_RE =
  /\.(?:mp4|mov|webm|m4v|mkv|avi|flv|wmv|mpe?g|3gp|ogv|m2?ts|ts|qt|wav|mp3|m4a|aac|ogg|oga|opus|flac|wma|aiff?|amr|weba)$/i;

const KNOWN_IMAGE_EXT_RE =
  /\.(?:png|jpe?g|webp|gif|avif|hei[cf]|bmp|tiff?)$/i;

function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let bytes = 0;
  let out = "";
  for (const ch of text) {
    const len = encoder.encode(ch).length;
    if (bytes + len > maxBytes) break;
    bytes += len;
    out += ch;
  }
  return out;
}

export function mediaExtension(mime?: string | null): string {
  return (
    (mime && Object.hasOwn(MEDIA_EXTENSIONS, mime) && MEDIA_EXTENSIONS[mime]) ||
    ""
  );
}

export function mediaDownloadFilename(
  key: string,
  mime?: string | null,
  originalName?: string | null,
): string {
  const ext = mediaExtension(mime);
  const fallback = "弗淼-" + key.slice(0, 8) + ext;
  if (!originalName) return fallback;
  const cleaned = originalName
    .replace(/[\u0000-\u001f\u007f-\u009f"]+/g, "")
    .trim()
    .replace(/^(?:\.+[/\\])+/g, "")
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .replace(/[/\\]+/g, "_")
    .replace(/\.+$/g, "");
  if (!cleaned) return fallback;
  const withoutKnownExt = mime?.startsWith("image/")
    ? cleaned.replace(KNOWN_IMAGE_EXT_RE, "").replace(KNOWN_AV_EXT_RE, "")
    : cleaned.replace(KNOWN_AV_EXT_RE, "");
  const stem = truncateUtf8(
    withoutKnownExt.replace(/^[.\s]+|[.\s]+$/g, ""),
    200,
  ).replace(/^[.\s]+|[.\s]+$/g, "");
  if (!stem) return fallback;
  return stem + ext;
}

function sanitizeDispositionValue(filename: string): string {
  return (
    filename
      .replace(/[\u0000-\u001f\u007f-\u009f"]+/g, "")
      .replace(/^[/\\]+|[/\\]+$/g, "")
      .replace(/[/\\]+/g, "_")
      .trim() || "fumiao"
  );
}

export function asciiDispositionFilename(filename: string): string {
  const clean = sanitizeDispositionValue(filename);
  const extMatch = clean.match(/(\.[A-Za-z0-9]{1,10})$/);
  const ext = extMatch ? extMatch[1] : "";
  const rawStem = ext ? clean.slice(0, -ext.length) : clean;
  const stem = rawStem
    .replaceAll("弗淼", "fumiao")
    .replace(/[^\x20-\x7e]+/g, "")
    .replace(/["\\/;]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/\s{2,}/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return (stem || "fumiao") + ext;
}

export function contentDisposition(
  filename: string,
  type: ContentDispositionType = "attachment",
): string {
  const clean = sanitizeDispositionValue(filename);
  const ascii = asciiDispositionFilename(clean);
  const encoded = encodeURIComponent(clean).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
