import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { packageFile } from "./package-file.js";
import {
  signPackage,
  publisherFingerprint,
  verifyPackageSignature,
} from "./package-signing.js";

export async function publisherCommand(command: string, args: string[]) {
  if (command === "keygen") {
    if (args.length !== 1)
      throw Error("用法：fumiao-plugin keygen <私钥输出文件>");
    const { privateKey } = generateKeyPairSync("ed25519");
    await writeFile(
      args[0],
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { flag: "wx", mode: 0o600 },
    );
    return "已创建 Ed25519 私钥文件。";
  }
  if (command === "verify") {
    if (args.length !== 1)
      throw Error("用法：fumiao-plugin verify <已签名插件包>");
    const signature = verifyPackageSignature(
      JSON.parse(await readFile(args[0], "utf8")),
    );
    return (
      signature.publisher +
      " · SHA-256 " +
      publisherFingerprint(signature.publicKey)
    );
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      key: { type: "string" },
      publisher: { type: "string" },
      out: { type: "string" },
    },
  });
  if (
    command !== "sign" ||
    positionals.length !== 1 ||
    !values.key ||
    !values.publisher ||
    !values.out
  )
    throw Error(
      "用法：fumiao-plugin sign <插件包> --key <私钥文件> --publisher <发布者> --out <新文件>",
    );
  const file = JSON.parse(await readFile(positionals[0], "utf8"));
  if (!packageFile.safeParse(file).success)
    throw Error("请选择格式 1 的插件发行包");
  const key = createPrivateKey(await readFile(values.key));
  const signed = signPackage(file, values.publisher, key);
  await writeFile(values.out, JSON.stringify(signed, null, 2) + "\n", {
    flag: "wx",
  });
  return (
    "已签名 " +
    file.id +
    " " +
    file.version +
    " · SHA-256 " +
    publisherFingerprint(signed.signature.publicKey)
  );
}
