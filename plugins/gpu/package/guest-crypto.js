import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
export function sha(text) {
  const bytes = Uint8Array.from(
    unescape(encodeURIComponent(text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD"))),
    (c) => c.charCodeAt(0),
  );
  return bytesToHex(sha256(bytes));
}
// The host passes fresh entropy to each preparation invocation.
export function newSeed() {
  throw Error("缺少任务随机种子");
}
