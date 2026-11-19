export function browserOrigins(publicUrl: string) {
  const origins = new Set([publicUrl]);
  const extra = process.env.ADDITIONAL_BROWSER_ORIGINS || "";
  for (const entry of extra.split(",")) {
    const origin = entry.trim();
    if (!origin) continue;
    const url = URL.parse(origin);
    if (
      !url ||
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin
    )
      throw new Error(
        "ADDITIONAL_BROWSER_ORIGINS must contain comma-separated HTTP(S) origins without paths or trailing slashes",
      );
    origins.add(origin);
  }
  return origins;
}

export function secureSessionCookie(origin: string | undefined) {
  return (origin || process.env.PUBLIC_URL || "").startsWith("https:");
}
