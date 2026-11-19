import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export async function passwordRecord(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = (await derive(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${digest.toString("hex")}`;
}
export async function verifyPassword(password: string, record: string) {
  const [algorithm, salt, expected] = record.split(":");
  if (!["scrypt", "legacy-scrypt"].includes(algorithm) || !salt || !expected)
    return false;
  const actual =
    algorithm === "legacy-scrypt"
      ? await new Promise<Buffer>((resolve, reject) =>
          scrypt(
            password,
            Buffer.from(salt, "hex"),
            64,
            { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
            (error, key) => (error ? reject(error) : resolve(key)),
          ),
        )
      : ((await derive(password, salt, 64)) as Buffer);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}
export class Vault {
  private key: Buffer;
  constructor(encoded: string) {
    this.key = Buffer.from(encoded, "base64");
    if (this.key.length !== 32)
      throw new Error("ENCRYPTION_KEY 必须为 base64 编码的 32 字节密钥");
  }
  seal(value: unknown) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  open(value: string): Record<string, any> {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
}
export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new DomainError(status, message);
}
