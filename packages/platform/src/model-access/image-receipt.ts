import { jsonParser } from "stream-json/parser.js";
import { httpChunks, requirePublicHttps } from "../plugin-host.js";
import { DomainError } from "../security.js";

export const maxImageBytes = 64 << 20;
const maxEncoded = 4 * Math.ceil(maxImageBytes / 3);
export type ImageOutput =
  { inline: true } | { url: string } | { b64: string } | null;
export class DefiniteImageFailure extends Error {}
class InterruptedReceipt extends Error {}

export function decodeInline(value: string) {
  if (
    !value ||
    value.length > maxEncoded ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return null;
  const bytes = Buffer.from(value, "base64");
  return bytes.length <= maxImageBytes ? bytes : null;
}

function publicOutput(
  url: string,
  containsCredential: (value: string) => boolean,
): ImageOutput {
  try {
    const target = new URL(url);
    requirePublicHttps(target);
    if (
      !containsCredential(target.href) &&
      !containsCredential(decodeURIComponent(target.href))
    )
      return { url: target.href };
  } catch {
    /* A malformed URL affects only its output. */
  }
  return null;
}

/** Flatten short streamed fragments in fixed-size blocks. Escaped input may
 * produce one token per character and must not accumulate millions of ropes. */
class ReceiptField {
  private blocks: string[] = [];
  private fragments: string[] = [];
  private size = 0;
  private blockSize = 0;
  constructor(private limit: number) {}
  append(fragment: string) {
    this.size += fragment.length;
    if (this.size > this.limit) return false;
    this.fragments.push(fragment);
    this.blockSize += fragment.length;
    if (this.blockSize >= 16384) {
      this.blocks.push(this.fragments.join(""));
      this.fragments = [];
      this.blockSize = 0;
    }
    return true;
  }
  finish() {
    this.blocks.push(this.fragments.join(""));
    return this.blocks.join("");
  }
}

/** Apply backpressure while spooling each inline item. Ignore other fields at
 * token level, so memory depends on a single output even for sixteen images. */
export async function readImageReceipt(
  body: Buffer | ReadableStream<Uint8Array>,
  count: number,
  accepted: boolean,
  signal: AbortSignal,
  containsCredential: (value: string) => boolean,
  save: (index: number, bytes: Buffer) => Promise<void>,
) {
  if (!Number.isInteger(count) || count < 1 || count > 16)
    throw new DefiniteImageFailure();
  const outputs: ImageOutput[] = [];
  let found = false;
  async function* chunks() {
    try {
      for await (const bytes of httpChunks(
        body,
        signal,
        maxEncoded * count + (1 << 20),
      ))
        for (let i = 0; i < bytes.length; i += 65536)
          yield bytes.subarray(i, i + 65536);
    } catch (err) {
      if (err instanceof DomainError && err.status === 413)
        throw new DefiniteImageFailure();
      throw new InterruptedReceipt();
    }
  }
  const tokenize = jsonParser({
    packValues: false,
    packKeys: true,
    streamKeys: false,
    maxPackedLength: 1024,
    maxDepth: 64,
  });
  // Parse actual bytes incrementally. A parser error while consuming bytes is
  // different from reaching HTTP EOF before the receipt's root object closes.
  async function* batches() {
    const decoder = new TextDecoder();
    for await (const bytes of chunks()) {
      const batch = tokenize(decoder.decode(bytes, { stream: true }));
      if (typeof batch !== "symbol") yield batch.values;
    }
    const tail = tokenize(decoder.decode());
    if (typeof tail !== "symbol") yield tail.values;
  }
  let closed = false;
  try {
    let depth = 0,
      key = "",
      inData = false,
      item = false,
      index = -1;
    let capture: "url" | "b64_json" | null = null,
      value: ReceiptField | null = null,
      url = "",
      b64 = "";
    for await (const batch of batches())
      for (const token of batch) {
        if (depth === 0 && token.name !== "startObject")
          throw new DefiniteImageFailure();
        switch (token.name) {
          case "keyValue":
            key = token.value;
            break;
          case "startArray":
          case "startObject": {
            if (depth === 2 && inData) {
              index++;
              item = index < count && token.name === "startObject";
              url = b64 = "";
              if (index < count) outputs.push(null);
            }
            if (depth === 1 && key === "data" && token.name === "startArray") {
              if (found) throw new DefiniteImageFailure();
              inData = found = true;
            }
            depth++;
            key = "";
            break;
          }
          case "endObject":
          case "endArray":
            if (depth === 3 && item) {
              const bytes =
                b64 && !containsCredential(b64) ? decodeInline(b64) : null;
              b64 = "";
              if (bytes) {
                try {
                  await save(index, bytes);
                } catch (error) {
                  throw new InterruptedReceipt("spool", { cause: error });
                }
                outputs[index] = { inline: true };
              } else if (url)
                outputs[index] = publicOutput(url, containsCredential);
              item = false;
            }
            if (depth === 2) inData = false;
            depth--;
            if (depth === 0) closed = true;
            key = "";
            break;
          case "startString":
          case "startNumber":
          case "trueValue":
          case "falseValue":
          case "nullValue":
            if (depth === 2 && inData) {
              index++;
              if (index < count) outputs.push(null);
            }
            capture =
              token.name === "startString" &&
              depth === 3 &&
              item &&
              (key === "url" || key === "b64_json")
                ? key
                : null;
            value = capture
              ? new ReceiptField(capture === "url" ? 8192 : maxEncoded)
              : null;
            key = "";
            break;
          case "stringChunk":
            if (value && !value.append(token.value)) value = null;
            break;
          case "endString":
            if (capture === "url") url = value?.finish() ?? "";
            if (capture === "b64_json") b64 = value?.finish() ?? "";
            capture = null;
            value = null;
            break;
        }
      }
  } catch (error) {
    if (accepted || error instanceof InterruptedReceipt)
      throw new InterruptedReceipt();

    throw new DefiniteImageFailure();
  }
  if (!closed || (accepted && (!found || !outputs.length)))
    throw new InterruptedReceipt();
  if (!found) throw new DefiniteImageFailure();
  return { outputs };
}
