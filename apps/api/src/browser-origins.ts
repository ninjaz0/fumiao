/** Extra first-party browser entry points. PUBLIC_URL remains canonical for callbacks. */
export function additionalBrowserOrigins(
  config = process.env.STUDIO_ADDITIONAL_ORIGINS,
) {
  const origins = new Set<string>();
  for (const value of (config || "").split(",")) {
    const origin = value.trim();
    if (!origin) continue;
    const url = new URL(origin);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.hostname.includes("*")
    ) {
      throw new Error(
        "STUDIO_ADDITIONAL_ORIGINS requires exact HTTP(S) origins",
      );
    }
    origins.add(origin);
  }
  return origins;
}
