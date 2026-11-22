import { randomBytes, createHash } from "node:crypto";
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newSeed = (audio: boolean) =>
  audio
    ? randomBytes(4).readUInt32BE() & 0x7fffffff
    : Number(randomBytes(8).readBigUInt64BE() & ((1n << 53n) - 1n));
