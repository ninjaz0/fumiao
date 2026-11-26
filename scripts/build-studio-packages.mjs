import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const json = (x) => JSON.stringify(x, null, 2) + "\n";
async function expression(path) {
  const source = await readFile(path, "utf8");
  if (!/^export default /m.test(source))
    throw Error("Missing default plugin expression in " + path);
  return source
    .replace(/^export default /m, "")
    .trim()
    .replace(/;$/, "");
}
// These packages were already distributed. Keep their inputs byte-for-byte
// stable when rebuilding the sandbox releases or restoring an old database.
const releases = [
  {
    id: "flow",
    sandboxBuild: "package/build.mjs",
    archive: "legacy-1.0.0.fmplugin.json",
    archiveDigest: "5aef66b00034c8dd5ad8c7ff8be8f51966f5dfb2bf770b8e63832175686faeb5",
  },
  {
    id: "muse",
    sandboxBuild: "package/build.mjs",
    archive: "legacy-1.0.0.fmplugin.json",
    archiveDigest: "ad67a5ecf101bfbdbb6dde80b94443348ac7c1304ec702b0a6114d8583933ac5",
  },
  {
    id: "gpu",
    archive: "legacy-1.0.0.fmplugin.json",
    archiveDigest: "89613b0db235ea2cd77aa8fe6b21e5d06f56a9c07b3b87c144aa157c6c5d0121",
    sandboxBuild: "package/build.mjs",
  },
  {
    id: "compatible-chat",
    archive: "legacy-1.2.1.fmplugin.json",
    archiveDigest: "f4c8134cc3d0928e16991d6159e0a31355dcda10a16555a33fdc0dfc4cba7970",
    sandboxBuild: "package/build.mjs",
  },
  { id: "storyboard" },
  { id: "jianying-exporter" },
  { id: "fcpxml-exporter" },
  { id: "openrouter-gateway", sandboxBuild: "package/build.mjs" },
  { id: "tts-commercial", sandboxBuild: "package/build.mjs" },
  { id: "bgm-generator", sandboxBuild: "package/build.mjs" },
  { id: "payments" },
  { id: "example-extension" },
  { id: "example-asset-tags" },
  { id: "example-review-board" },
  { id: "example-shot-prompt" },
  { id: "example-reading-time" },
  { id: "example-importers" },
  { id: "example-review-notes" },
];
async function packContributions(root, contributes) {
  for (const page of [
    ...(contributes.settingsPages ?? []),
    ...(contributes.pages ?? []),
    ...(contributes.canvasNodes ?? []),
    ...(contributes.chatTools ?? []),
    ...(contributes.events ?? []),
    ...(contributes.actions ?? []),
    ...(contributes.importers ?? []),
    ...(contributes.exporters ?? []),
    ...(contributes.paymentMethods ?? []),
  ]) {
    if (page.programFile) {
      page.program = await expression(join(root, page.programFile));
      delete page.programFile;
    }
  }
  if (contributes.settings?.migrateFile) {
    contributes.settings.migrate = await expression(
      join(root, contributes.settings.migrateFile),
    );
    delete contributes.settings.migrateFile;
  }
}
for (const { id, archive, archiveDigest, sandboxBuild } of releases) {
  const root = "plugins/" + id,
    file = JSON.parse(await readFile(root + "/package/release.json", "utf8"));
  if (archive) {
    const data = await readFile(join(root, "package", archive));
    if (hash(data) !== archiveDigest)
      throw Error("Published package digest mismatch: " + id);
    const legacy = JSON.parse(data);
    const bytes = Buffer.from(legacy.adapterModule, "base64");
    if (legacy.id !== id || !bytes.length)
      throw Error("Invalid historical package: " + id);
    if (!sandboxBuild)
      throw Error("Published native packages need a sandbox build: " + id);
    if (id === "gpu") {
      const archived = await readFile(
        join(root, "package/provider-" + legacy.adapterVersion + ".js.gz"),
      );
      if (!archived.equals(bytes))
        throw Error("Published GPU adapter digest mismatch");
    }
  }
  if (id === "compatible-chat") {
    const bytes = await readFile(join(root, "package/legacy-2.0.0.fmplugin.json"));
    if (hash(bytes) !== "2472ea9dae334bf15e9fee4c105bb2f2cbab8ed22913abad7ccf1b633932bd4d")
      throw Error("Published sandbox package digest mismatch: " + id);
  }
  if (id === "muse") {
    const bytes = await readFile(join(root, "package/legacy-2.0.0.fmplugin.json"));
    if (hash(bytes) !== "a332a61eb35e7d1f3dfb1070052a073e88729b0bf658d01da4665bbc097f7257")
      throw Error("Published sandbox package digest mismatch: " + id);
  }
  if (sandboxBuild) {
    Object.assign(
      file,
      JSON.parse(
        execFileSync(
          process.execPath,
          ["--import", "tsx", join(root, sandboxBuild), file.adapterVersion],
          { encoding: "utf8" },
        ),
      ),
    );
  }
  if (file.contributes)
    await packContributions(root + "/package", file.contributes);
  if (id === "gpu")
    file.nodeClient = JSON.parse(
      execFileSync("python3", [join(root, "package/build-client.py")], {
        encoding: "utf8",
      }),
    );
  const path = id + ".fmplugin.json",
    data = json(file);
  await writeFile(root + "/" + path, data);
  await writeFile(
    root + "/update.json",
    json({
      id,
      version: file.version,
      notes:
        id === "compatible-chat"
          ? "创作对话支持调用已启用的插件工具"
          : id === "gpu"
            ? "节点池协议升级，排空任务后重新接入实例"
            : id === "muse"
              ? "支持按 Muse2API 启用账号数回退并发派发（图片最多 8 路，总容量请结合上游 MUSE2API_CONCURRENCY 与共享占用评估）；存量连接保留原并行任务数量，如需扩容请手动调高"
              : id === "flow"
                ? "图片和视频生成请求迁入沙箱，服务地址须使用公网 HTTPS"
                : id === "bgm-generator"
                  ? "修复 BGM 原生任务计划校验、参数冻结与沙箱成品下载路径解析"
                  : id === "tts-commercial"
                    ? "修复商业 TTS 原生任务计划校验与参数冻结"
                    : id === "example-extension"
                      ? "修复工作区备注数量较多时无法打开的问题，自动整理旧备注"
                      : "首次发布",
      package: path,
      sha256: hash(data),
    }),
  );
}
