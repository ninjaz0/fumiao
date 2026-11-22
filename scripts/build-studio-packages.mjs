import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, join } from "node:path";
import { gzipSync } from "node:zlib";
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
const trusted = {};
const releases = [
  {
    id: "flow",
    entry: 'export { flowText as adapter } from "./src/text.js";',
    program: true,
  },
  {
    id: "muse",
    entry: 'export { museText as adapter } from "./src/text.js";',
    program: true,
  },
  {
    id: "gpu",
    // The published adapter is immutable. Its node controllers are now owned
    // by the host; retain these exact bytes for existing provider snapshots.
    pinnedAdapter:
      "b418dad85380eed9df512cac18d952dc550e616ebd32ff38aa17b09f840b2df6",
    program: true,
  },
  {
    id: "compatible-chat",
    entry: 'export { chatStreaming as adapter } from "../chat/src/stream.js";',
  },
  { id: "example-extension" },
  { id: "example-node-pool", program: true, clientBuild: "client/pack.py" },
];
async function buildAdapter(root, entry) {
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: resolve(root),
    },
    format: "esm",
    platform: "node",
    target: "node24",
    bundle: true,
    write: false,
    plugins: [
      {
        name: "studio-sdk",
        setup(b) {
          // Host modules stay external. Installed packages name them by
          // repository path, so that identifier is part of the format.
          b.onResolve(
            {
              filter:
                /^@fumiao\/(plugin-sdk|platform|original-api|image-import)\//,
            },
            (args) => {
              const [, name, ...rest] = args.path.split("/");
              return {
                path: `fumiao:packages/${name}/src/${rest.join("/")}`,
                external: true,
              };
            },
          );
          b.onLoad({ filter: /plugins\/.*\.ts$/ }, async ({ path }) => {
            let contents = await readFile(path, "utf8");
            for (const m of contents.matchAll(
              /readFileSync\(new URL\("([^"]+)", import\.meta\.url\), "utf8"\)/g,
            )) {
              const data = await readFile(join(dirname(path), m[1]), "utf8");
              contents = contents.replace(m[0], () => JSON.stringify(data));
            }
            return { contents, loader: "ts", resolveDir: dirname(path) };
          });
        },
      },
    ],
  });
  return gzipSync(result.outputFiles[0].contents);
}
async function packContributions(root, contributes) {
  for (const page of contributes.settingsPages ?? []) {
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
for (const { id, entry, program, pinnedAdapter, clientBuild } of releases) {
  const root = "plugins/" + id,
    file = JSON.parse(await readFile(root + "/package/release.json", "utf8"));
  if (pinnedAdapter) {
    const bytes = await readFile(
      root + "/package/provider-" + file.adapterVersion + ".js.gz",
    );
    if (hash(bytes) !== pinnedAdapter)
      throw Error("Published adapter digest mismatch: " + id);
    file.adapterModule = bytes.toString("base64");
    trusted[id + "@" + file.adapterVersion] = pinnedAdapter;
  }
  if (entry) {
    const packed = await buildAdapter(root, entry);
    trusted[id + "@" + file.adapterVersion] = hash(packed);
    file.adapterModule = packed.toString("base64");
  }
  if (file.contributes)
    await packContributions(root + "/package", file.contributes);
  if (program) file.program = await expression(root + "/package/program.js");
  if (id === "gpu") {
    file.settingsPage = {
      title: "GPU 节点",
      render: await expression(root + "/package/panel.js"),
    };
  }
  if (id === "gpu" || file.contributes?.nodePools) {
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
      notes: "首次发布",
      package: path,
      sha256: hash(data),
    }),
  );
}
await writeFile(
  "packages/platform/src/distribution/official-adapters.json",
  json(trusted),
);
