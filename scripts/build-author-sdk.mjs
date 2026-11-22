import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { writeAuthorTemplates } from "./author-templates.mjs";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../packages/plugin-sdk/", import.meta.url));
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const require = createRequire(join(root, "package.json"));
const target = join(root, "dist");
const output = await mkdtemp(join(root, ".sdk-build-"));
try {
  execFileSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "-p",
      join(root, "tsconfig.release.json"),
      "--outDir",
      join(output, "lib"),
    ],
    { stdio: "inherit" },
  );
  const hostDir = join(output, "bin");
  await mkdir(hostDir, { recursive: true });
  const repository = fileURLToPath(new URL("../", import.meta.url));
  await build({
    entryPoints: [join(repository, "scripts/author-host/commands.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["quickjs-emscripten", "zod", "ajv"],
    outfile: join(hostDir, "commands.js"),
  });
  await copyFile(
    join(repository, "scripts/author-host/preview.html"),
    join(hostDir, "preview.html"),
  );
  const dependencyVersions = Object.fromEntries(
    Object.keys(metadata.dependencies).map((name) => [
      name,
      require(name + "/package.json").version,
    ]),
  );
  for (const dependency of ["quickjs-emscripten", "ajv"]) {
    const platformRequire = createRequire(
      join(repository, "packages/platform/package.json"),
    );
    dependencyVersions[dependency] = platformRequire(
      dependency + "/package.json",
    ).version;
  }
  const entry = (name) => ({
    types: "./lib/" + name + ".d.ts",
    import: "./lib/" + name + ".js",
  });
  await writeFile(
    join(output, "package.json"),
    JSON.stringify(
      {
        name: metadata.name,
        version: metadata.version,
        type: "module",
        description: "弗淼 Studio 插件作者工具与版本化契约",
        repository: {
          type: "git",
          url: "git+https://github.com/ninjaz0/fumiao.git",
          directory: "packages/plugin-sdk",
        },
        engines: { node: ">=24" },
        publishConfig: { access: "public" },
        exports: {
          ".": entry("author"),
          "./signing": entry("package-signing"),
          "./package.json": "./package.json",
        },
        bin: { "fumiao-plugin": "./lib/cli.js" },
        files: ["lib", "bin", "templates", "README.md"],
        dependencies: dependencyVersions,
      },
      null,
      2,
    ) + "\n",
  );
  await writeAuthorTemplates(
    fileURLToPath(new URL("../", import.meta.url)),
    join(output, "templates"),
  );
  await copyFile(join(root, "README.md"), join(output, "README.md"));
  await chmod(join(output, "lib/cli.js"), 0o755);
  await rm(target, { recursive: true, force: true });
  await rename(output, target);
  console.log(metadata.name + "@" + metadata.version + " → " + target);
} finally {
  await rm(output, { recursive: true, force: true });
}
