export type ContentDispositionType = "attachment" | "inline";

const MEDIA_EXTENSIONS: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/zip": ".zip",
  "application/xml": ".fcpxml",
  "text/plain": ".edl",
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

export function normalizeMediaMime(mime?: string | null): string {
  if (!mime) return "";
  return mime.split(";", 1)[0].trim().toLowerCase();
}

export function mediaExtension(mime?: string | null): string {
  const normalized = normalizeMediaMime(mime);
  return (
    (normalized &&
      Object.hasOwn(MEDIA_EXTENSIONS, normalized) &&
      MEDIA_EXTENSIONS[normalized]) ||
    ""
  );
}

export function mediaDownloadFilename(
  key: string,
  mime?: string | null,
  originalName?: string | null,
): string {
  const normalizedMime = normalizeMediaMime(mime);
  const ext = mediaExtension(normalizedMime);
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
  const withoutKnownExt = !ext
    ? cleaned
    : normalizedMime.startsWith("image/")
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
  // Preserve intentional ASCII runs (such as "take..02") and only collapse
  // separators adjacent to removed non-ASCII segments.
  const stem = rawStem
    .replaceAll("弗淼", "fumiao")
    .replace(/[^\x20-\x7e]+/g, "\0")
    .replace(/["\\/;]+/g, "_")
    .replace(/^[\0.\s-]+|[\0.\s-]+$/g, "")
    .replace(/([.\s-])[\0.\s-]*\0[\0.\s-]*/g, "$1")
    .replace(/[\0.\s-]*\0[\0.\s-]*([.\s-])/g, "$1")
    .replaceAll("\0", "")
    .replace(/^[.\s]+|[.\s]+$/g, "");
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
