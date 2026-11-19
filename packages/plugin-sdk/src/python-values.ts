// Python string/JSON behavior used by the pinned original contracts.
export const pythonWhitespace =
  "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const ends = new RegExp(
  "^[" + pythonWhitespace + "]+|[" + pythonWhitespace + "]+$",
  "g",
);
export const pythonStrip = (s: string) => s.replace(ends, "");
export const pythonTruthy = (v: unknown): boolean =>
  v != null &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length > 0);
