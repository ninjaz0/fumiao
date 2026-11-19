/** Python JSON wire compatibility shared by versioned provider adapters.
 * No eval: constants outside strings are replaced with collision-free markers. */
export function pythonJson(bytes: Buffer): any {
  return pythonJsonText(decodePythonJson(bytes));
}

/** Decode a JSON request without discarding the source needed for syntax diagnostics. */
export function decodePythonJson(bytes: Buffer): string {
  let width = 1,
    little = false,
    offset = 0;
  const starts = (...prefix: number[]) =>
    prefix.every((v, i) => bytes[i] === v);
  if (starts(0, 0, 254, 255)) {
    width = 4;
    offset = 4;
  } else if (starts(255, 254, 0, 0)) {
    width = 4;
    little = true;
    offset = 4;
  } else if (starts(254, 255)) {
    width = 2;
    offset = 2;
  } else if (starts(255, 254)) {
    width = 2;
    little = true;
    offset = 2;
  } else if (starts(239, 187, 191)) offset = 3;
  else if (bytes.length >= 4) {
    if (bytes[0] === 0) width = bytes[1] === 0 ? 4 : 2;
    else if (bytes[1] === 0) {
      width = bytes[2] || bytes[3] ? 2 : 4;
      little = true;
    }
  } else if (bytes.length === 2) {
    if (bytes[0] === 0) width = 2;
    else if (bytes[1] === 0) {
      width = 2;
      little = true;
    }
  }
  let text = "";
  if (width === 1) {
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(offset),
      );
    } catch {
      // Python uses surrogatepass. Preserve encoded lone surrogates while still
      // rejecting invalid continuations, overlong sequences and out-of-range code points.
      const chars: string[] = [];
      for (let i = offset; i < bytes.length;) {
        const first = bytes[i++];
        if (first < 128) {
          chars.push(String.fromCharCode(first));
          continue;
        }
        const size =
          first >= 194 && first <= 223
            ? 2
            : first >= 224 && first <= 239
              ? 3
              : first >= 240 && first <= 244
                ? 4
                : 0;
        if (!size || i + size - 1 > bytes.length)
          throw new Error("Invalid JSON encoding");
        let code = first & (127 >> size);
        for (let n = 1; n < size; n++) {
          const next = bytes[i++];
          if (next < 128 || next > 191)
            throw new Error("Invalid JSON encoding");
          code = (code << 6) | (next & 63);
        }
        if (
          code < (size === 2 ? 128 : size === 3 ? 2048 : 65536) ||
          code > 0x10ffff
        )
          throw new Error("Invalid JSON encoding");
        chars.push(String.fromCodePoint(code));
      }
      text = chars.join("");
    }
  } else {
    if ((bytes.length - offset) % width)
      throw new Error("Invalid JSON encoding");
    const chars: string[] = [];
    for (let i = offset; i < bytes.length; i += width) {
      const code =
        width === 2
          ? little
            ? bytes.readUInt16LE(i)
            : bytes.readUInt16BE(i)
          : little
            ? bytes.readUInt32LE(i)
            : bytes.readUInt32BE(i);
      if (code > 0x10ffff) throw new Error("Invalid JSON encoding");
      chars.push(String.fromCodePoint(code));
    }
    text = chars.join("");
  }
  return text;
}

type JsonReviver = (
  this: any,
  key: string,
  value: any,
  context: { source?: string },
) => any;
/** Python json.loads(str), including constants, without byte encoding/BOM detection.
 * Optional source metadata preserves Python's distinction between int and float. */
export function pythonJsonText(text: string, reviver?: JsonReviver): any {
  // The normal path includes multi-megabyte base64 images. Avoid a repeated
  // regex group over string contents: V8 exhausts its regex stack on these.
  try {
    return JSON.parse(text, reviver as any);
  } catch {
    /* Python also permits constants. */
  }
  const strings: string[] = [],
    constants: { start: number; end: number; value: number }[] = [];
  for (let i = 0; i < text.length;) {
    if (text.charCodeAt(i) === 34) {
      const start = i++;
      for (;;) {
        if (i >= text.length) throw new Error("Invalid JSON string");
        const char = text.charCodeAt(i++);
        if (char === 92) i++;
        else if (char === 34) break;
      }
      strings.push(JSON.parse(text.slice(start, i)));
    } else {
      const token = text.startsWith("-Infinity", i)
        ? "-Infinity"
        : text.startsWith("Infinity", i)
          ? "Infinity"
          : text.startsWith("NaN", i)
            ? "NaN"
            : null;
      if (token) {
        constants.push({
          start: i,
          end: i + token.length,
          value:
            token === "NaN" ? NaN : token === "Infinity" ? Infinity : -Infinity,
        });
        i += token.length;
      } else i++;
    }
  }
  let marker = "__muse_json_constant__";
  while (strings.some((value) => value.startsWith(marker))) marker += "_";
  const values: Record<string, number> = {},
    pieces: string[] = [];
  let copied = 0;
  for (const [index, token] of constants.entries()) {
    const key = marker + index;
    values[key] = token.value;
    // Arrays cannot become object keys, unlike a quoted marker token.
    pieces.push(
      text.slice(copied, token.start),
      "[" + JSON.stringify(key) + "]",
    );
    copied = token.end;
  }
  pieces.push(text.slice(copied));
  return JSON.parse(
    pieces.join(""),
    function (this: any, key, value, context: { source?: string } = {}) {
      if (
        Array.isArray(value) &&
        value.length === 1 &&
        typeof value[0] === "string" &&
        Object.hasOwn(values, value[0])
      ) {
        value = values[value[0]];
        context = {};
      }
      return reviver ? reviver.call(this, key, value, context) : value;
    },
  );
}
