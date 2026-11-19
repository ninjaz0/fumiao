/** SQLite UTF-8 text can contain NUL; PostgreSQL text cannot. Bytea preserves it.
 * Reject lone surrogates, as Python's SQLite UTF-8 binding does. */
export function chatBytes(value: string) {
  const bytes = Buffer.from(value);
  if (bytes.toString("utf8") !== value)
    throw new Error("Invalid UTF-8 chat text");
  return bytes;
}
export const chatText = (value: Uint8Array): string =>
  Buffer.from(value).toString("utf8");
/** Exact separators/ASCII escaping for original context and integer usage strings. */
export function chatJson(value: unknown, ascii = true): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    const text = JSON.stringify(value);
    return ascii
      ? text.replace(
          /[\x7f-\uffff]/g,
          (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
        )
      : text;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (Array.isArray(value))
    return "[" + value.map((v) => chatJson(v, ascii)).join(", ") + "]";
  if (typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .map(([k, v]) => chatJson(k, ascii) + ": " + chatJson(v, ascii))
        .join(", ") +
      "}"
    );
  throw new Error("Unsupported chat JSON value");
}
