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
  { id: "payments" },
  { id: "example-extension" },
  { id: "example-asset-tags" },
  { id: "example-review-notes" },
  { id: "example-node-pool", program: true, clientBuild: "client/pack.py" },
];
async function packContributions(root, contributes) {
  for (const page of [...(contributes.settingsPages ?? []), ...(contributes.events ?? []), ...(contributes.actions ?? []), ...(contributes.exporters ?? []), ...(contributes.paymentMethods ?? [])]) {
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
for (const { id, archive, archiveDigest, program, sandboxBuild, clientBuild } of releases) {
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
    if (!sandboxBuild) {
      if (file.version !== legacy.version || file.adapterVersion !== legacy.adapterVersion)
        throw Error("New releases require a sandbox or remote service: " + id);
      Object.assign(file, legacy);
    }
    if (id === "gpu") {
      const archived = await readFile(
        join(root, "package/provider-" + legacy.adapterVersion + ".js.gz"),
      );
      if (!archived.equals(bytes))
        throw Error("Published GPU adapter digest mismatch");
    }
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
  if (program) file.program = await expression(root + "/package/program.js");
  if (id === "gpu")
    file.nodeClient = JSON.parse(
      execFileSync("python3", [join(root, "package/build-client.py")], {
        encoding: "utf8",
      }),
    );
  else if (file.contributes?.nodePools) {
    if (clientBuild) execFileSync("python3", [join(root, clientBuild)]);
    file.nodeClient = {};
    for (const name of ["agent.tgz", "install.sh", "agent.tgz.sha256"])
      file.nodeClient[name] = (
        await readFile(root + "/distribution/" + name)
      ).toString("base64");
  }
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
          ? "对话请求和流式回复由沙箱处理"
          : id === "gpu"
            ? "节点池协议升级，排空任务后重新接入实例"
            : id === "muse" || id === "flow"
              ? "图片和视频生成请求迁入沙箱，服务地址须使用公网 HTTPS"
              : "首次发布",
      package: path,
      sha256: hash(data),
    }),
  );
}
