/** Preserve literal netloc/path semantics before WHATWG URL normalization. */
export function splitArtifactUrl(value: string) {
  const clean = value.replace(/^[\u0000-\u0020]+/, "").replace(/[\t\r\n]/g, "");
  const parts =
    /^(?:([a-z][a-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
      clean,
    );
  if (!parts) throw new Error("Invalid artifact URL");
  return {
    scheme: (parts[1] || "").toLowerCase(),
    netloc: parts[2] || "",
    path: parts[3],
    query: parts[4] || "",
    fragment: parts[5] || "",
  };
}
