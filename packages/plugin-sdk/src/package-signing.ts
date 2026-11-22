import {
  createHash,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  packageSignatureSchema,
  type PackageSignature,
} from "./package-file.js";
export type { PackageSignature } from "./package-file.js";

type Fields = Record<string, unknown>;

// Sort JSON object keys by UTF-16 code unit; arrays retain their order.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + Array.from(value, canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw Error("插件签名只支持 JSON 对象");
    const obj = value as Fields;
    return (
      "{" +
      Object.keys(obj)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(obj[key]))
        .join(",") +
      "}"
    );
  }
  if (
    value !== null &&
    typeof value !== "boolean" &&
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    throw Error("插件签名只支持 JSON 值");
  return JSON.stringify(value);
}

function payload(file: Fields, identity: Omit<PackageSignature, "value">) {
  return Buffer.from(
    "fumiao.fmplugin.signature.v1\n" +
      canonicalJson({ ...file, signature: identity }),
    "utf8",
  );
}
export function publisherFingerprint(publicKey: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex");
}
export function signPackage<T extends Fields>(
  file: T,
  publisher: string,
  key: KeyObject,
): T & { signature: PackageSignature } {
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw Error("需要 Ed25519 发布者私钥");
  const publicKey = createPublicKey(key)
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const identity = { algorithm: "Ed25519" as const, publisher, publicKey };
  const value = sign(null, payload(file, identity), key).toString("base64");
  return {
    ...file,
    signature: packageSignatureSchema.parse({ ...identity, value }),
  };
}
export function verifyPackageSignature(file: Fields): PackageSignature {
  const signature = packageSignatureSchema.parse(file.signature);
  const { value, ...identity } = signature;
  const key = createPublicKey({
    format: "der",
    type: "spki",
    key: Buffer.from(identity.publicKey, "base64"),
  });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    key.export({ type: "spki", format: "der" }).toString("base64") !==
      identity.publicKey ||
    Buffer.from(value, "base64").toString("base64") !== value ||
    !verify(null, payload(file, identity), key, Buffer.from(value, "base64"))
  )
    throw Error("插件包签名校验失败");
  return signature;
}
