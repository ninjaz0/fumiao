import type { Request } from "express";
import { decodePythonJson, pythonJsonText } from "../../plugin-sdk/src/json.js";
import { DomainError } from "../../platform/src/security.js";
import { ValidationError } from "./validation.js";
import { parseCanvasRunJson } from "./canvas-values.js";

const parseError = () =>
  new DomainError(400, "There was an error parsing the body");
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Only walk malformed JSON, to return CPython's error position and message. */
function rejectMalformedJson(source: string): never {
  let pos = 0;
  const space = /[ \t\r\n]*/y;
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const literal = /true|false|null|NaN|-?Infinity/y;
  const read = (pattern: RegExp) => {
    pattern.lastIndex = pos;
    const match = pattern.exec(source);
    if (match) pos = pattern.lastIndex;
    return match?.[0];
  };
  function invalid(error: string, at = pos): never {
    throw new ValidationError([
      {
        type: "json_invalid",
        loc: ["body", [...source.slice(0, at)].length],
        msg: "JSON decode error",
        input: {},
        ctx: { error },
      },
    ]);
  }
  function string() {
    const start = pos++;
    while (pos < source.length) {
      const char = source[pos++];
      if (char === '"') return;
      if (char.charCodeAt(0) < 32)
        invalid("Invalid control character at", pos - 1);
      if (char !== "\\") continue;
      if (pos === source.length) break;
      if (source[pos] === "u") {
        if (!/^[0-9a-fA-F]{4}$/.test(source.slice(pos + 1, pos + 5)))
          invalid("Invalid \\uXXXX escape");
        pos += 5;
      } else {
        if (!'"\\/bfnrt'.includes(source[pos]))
          invalid("Invalid \\escape", pos - 1);
        pos++;
      }
    }
    invalid("Unterminated string starting at", start);
  }
  function value() {
    read(space);
    const char = source[pos];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      const object = char === "{";
      const end = object ? "}" : "]";
      pos++;
      read(space);
      if (source[pos] === end) {
        pos++;
        return;
      }
      for (;;) {
        if (object) {
          if (source[pos] !== '"')
            invalid("Expecting property name enclosed in double quotes");
          string();
          read(space);
          if (source[pos] !== ":") invalid("Expecting ':' delimiter");
          pos++;
        }
        value();
        read(space);
        if (source[pos] === end) {
          pos++;
          return;
        }
        if (source[pos] !== ",") invalid("Expecting ',' delimiter");
        pos++;
        read(space);
      }
    }
    if (!read(literal) && !read(number)) invalid("Expecting value");
  }
  value();
  read(space);
  if (pos !== source.length) invalid("Extra data");
  throw parseError();
}

export function readCanvasBody(
  req: Request,
  exactIntegers: boolean,
  limit?: number,
) {
  return readOriginalBody(
    req,
    exactIntegers ? parseCanvasRunJson : pythonJsonText,
    false,
    limit,
  );
}

export async function readOriginalBody(
  req: Request,
  parse: (source: string) => unknown,
  jsonWithoutContentType = false,
  limit?: number,
) {
  let bytes: Buffer;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (limit !== undefined && size > limit) {
        req.resume();
        throw new DomainError(413, "Request body too large");
      }
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw parseError();
  }
  if (!bytes.length) return undefined;
  const type = req.headers["content-type"]?.split(";")[0].trim().toLowerCase();
  if (
    type
      ? !/^application\/(?:json|[^/]+\+json)$/.test(type)
      : !jsonWithoutContentType
  )
    // FastAPI passes raw bytes to Pydantic, then decodes them when sending an error.
    return utf8.decode(bytes);
  let source: string;
  try {
    source = decodePythonJson(bytes);
  } catch {
    throw parseError();
  }
  try {
    return parse(source);
  } catch {
    try {
      rejectMalformedJson(source);
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw parseError();
    }
  }
}
