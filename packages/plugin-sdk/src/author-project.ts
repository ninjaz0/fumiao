import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { packageFile } from "./package-file.js";

export async function createProject(kind: string, path?: string) {
  const projectTypes = (
    await readdir(new URL("../templates/", import.meta.url))
  )
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
  if (!projectTypes.includes(kind))
    throw Error("可选扩展点：" + projectTypes.join("、"));
  const target = resolve(path ?? "my-" + kind.toLowerCase()),
    id = basename(target);
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id))
    throw Error("目录名须为 2–40 位小写字母、数字或连字符，以字母开头");
  const template = JSON.parse(
    await readFile(
      new URL("../templates/" + kind + ".json", import.meta.url),
      "utf8",
    ),
  ) as {
    sourceId: string;
    files: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const sdk = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  // mkdir is exclusive. A failure never cleans up a pre-existing directory.
  await mkdir(target);
  try {
    for (const [name, original] of Object.entries(template.files)) {
      const dest = join(target, name);
      await mkdir(dirname(dest), { recursive: true });
      let source = original.replaceAll(template.sourceId, id);
      if (name === "package/release.json") {
        const release = JSON.parse(source);
        release.version = "1.0.0";
        delete release.updateUrl;
        if (release.remote)
          release.remote.manifest.models[0].id = id + "-image";
        if (kind === "paymentMethods")
          release.contributes.paymentMethods[0].id = id.slice(0, 32);
        source = JSON.stringify(release, null, 2) + "\n";
      }
      await writeFile(dest, source, { flag: "wx" });
    }
    if (kind === "nodePools")
      execFileSync("python3", ["client/pack.py"], { cwd: target });
    const scripts = {
      dev: "fumiao-plugin dev .",
      test: "fumiao-plugin test .",
      build: "fumiao-plugin build .",
      ...(kind === "providers" ? { provider: "node server.mjs" } : {}),
      ...(kind === "nodePools" ? { client: "python3 client/pack.py" } : {}),
    };
    await writeFile(
      join(target, "package.json"),
      JSON.stringify(
        {
          name: id,
          private: true,
          type: "module",
          scripts,
          ...(template.dependencies
            ? { dependencies: template.dependencies }
            : {}),
          devDependencies: { "@fumiao/plugin-sdk": "^" + sdk.version },
        },
        null,
        2,
      ) + "\n",
    );
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function expression(root: string, name: string) {
  const actual = await realpath(resolve(root, name));
  const path = relative(root, actual);
  if (
    path === ".." ||
    path.startsWith(".." + sep) ||
    !(await stat(actual)).isFile()
  )
    throw Error("程序文件须位于插件 package 目录内");
  const code = (await readFile(actual, "utf8")).trim();
  if (!/^export default\s+/.test(code))
    throw Error("程序文件须导出默认对象或函数：" + name);
  return code.replace(/^export default\s+/, "").replace(/;$/, "");
}
export async function buildProject(directory: string) {
  const root = await realpath(join(directory, "package"));
  const release = JSON.parse(
    await readFile(join(root, "release.json"), "utf8"),
  );
  if (release.signature)
    throw Error("请用未签名的源码构建，再签署生成的发行包");
  for (const slot of ["program", "studioProgram"]) {
    if (release[slot + "File"]) {
      release[slot] = await expression(root, release[slot + "File"]);
      delete release[slot + "File"];
    }
  }
  const c = release.contributes;
  if (c) {
    for (const type of [
      "settingsPages",
      "pages",
      "importers",
      "canvasNodes",
      "actions",
      "events",
      "chatTools",
      "exporters",
      "paymentMethods",
    ]) {
      for (const entry of c[type] ?? []) {
        if (!entry.programFile) continue;
        entry.program = await expression(root, entry.programFile);
        delete entry.programFile;
      }
    }
    if (c.settings?.migrateFile) {
      c.settings.migrate = await expression(root, c.settings.migrateFile);
      delete c.settings.migrateFile;
    }
    if (c.nodePools) {
      release.program ??= await expression(root, "program.js");
      release.nodeClient = {};
      for (const name of ["agent.tgz", "install.sh", "agent.tgz.sha256"]) {
        release.nodeClient[name] = (
          await readFile(join(directory, "distribution", name))
        ).toString("base64");
      }
      const archive = Buffer.from(release.nodeClient["agent.tgz"], "base64");
      const checksum = Buffer.from(
        release.nodeClient["agent.tgz.sha256"],
        "base64",
      )
        .toString()
        .trim();
      if (
        !archive.length ||
        /^([0-9a-f]{64})(?:[ \t]+\*?agent\.tgz)?$/.exec(checksum)?.[1] !==
          createHash("sha256").update(archive).digest("hex")
      )
        throw Error("节点客户端归档校验失败");
    }
  }
  packageFile.parse(release);
  return release as Record<string, any>;
}
export async function writeRelease(directory: string) {
  const file = await buildProject(directory),
    dist = join(directory, "dist");
  await mkdir(dist, { recursive: true });
  const path = join(dist, file.id + ".fmplugin.json");
  const staging = await mkdtemp(join(dist, ".pack-"));
  try {
    await writeFile(
      join(staging, "release"),
      JSON.stringify(file, null, 2) + "\n",
    );
    await rename(join(staging, "release"), path);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return resolve(path);
}
