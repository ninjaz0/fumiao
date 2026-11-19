import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const native = join(root, "packages/image-import/native");
const build = join(root, ".runtime-advanced/image-codecs");
const prefix = join(native, "build");
const sources = JSON.parse(
  await readFile(join(native, "sources.json"), "utf8"),
);
if (!["darwin", "linux"].includes(process.platform))
  throw new Error("Image codecs require macOS or Linux");
await mkdir(build, { recursive: true });
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });
const jobs = process.env.CMAKE_BUILD_PARALLEL_LEVEL || "4";
if (!/^[1-9][0-9]?$/.test(jobs)) throw new Error("Invalid build concurrency");
const common = [
  "-G",
  "Ninja",
  "-DCMAKE_BUILD_TYPE=Release",
  "-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON",
  "-DBUILD_SHARED_LIBS=ON",
  `-DCMAKE_INSTALL_PREFIX=${prefix}`,
  "-DCMAKE_INSTALL_LIBDIR=lib",
  `-DCMAKE_PREFIX_PATH=${prefix}`,
  `-DCMAKE_INSTALL_RPATH=${process.platform === "darwin" ? "@loader_path" : "$ORIGIN"}`,
  ...(process.platform === "darwin" ? ["-DCMAKE_INSTALL_NAME_DIR=@rpath"] : []),
];
const compile = (source, name, options = []) => {
  const directory = join(build, name);
  run("cmake", ["-S", source, "-B", directory, ...common, ...options]);
  run("cmake", ["--build", directory, "--parallel", jobs]);
  run("cmake", ["--install", directory]);
};
for (const source of sources) {
  const archive = join(build, `${source.name}-${source.version}.tar.gz`);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok)
      throw new Error(`Download failed: ${source.name} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
    throw new Error(`Source checksum mismatch: ${source.name}`);
  await writeFile(archive, bytes);
  const directory = join(build, `${source.name}-${source.version}`);
  // Re-extract the verified release on every build; never consume an edited source checkout.
  await rm(directory, { recursive: true, force: true });
  run("tar", ["-xzf", archive, "-C", build]);
  const options =
    source.name === "libde265"
      ? ["-DENABLE_SDL=OFF", "-DENABLE_DECODER=OFF", "-DENABLE_ENCODER=OFF"]
      : [
          "-DBUILD_TESTING=OFF",
          "-DBUILD_DOCUMENTATION=OFF",
          "-DWITH_EXAMPLES=OFF",
          "-DWITH_GDK_PIXBUF=OFF",
          "-DENABLE_PLUGIN_LOADING=OFF",
          "-DWITH_LIBDE265=ON",
          "-DWITH_LIBDE265_PLUGIN=OFF",
          ...[
            "X265",
            "X264",
            "OpenH264_DECODER",
            "AOM_DECODER",
            "AOM_ENCODER",
            "LIBSHARPYUV",
          ].map((n) => `-DWITH_${n}=OFF`),
        ];
  compile(directory, `${source.name}-build`, options);
  const notices = join(prefix, "share", source.name);
  await mkdir(notices, { recursive: true });
  await cp(join(directory, "COPYING"), join(notices, "COPYING"));
  // Ship the exact corresponding source with the private shared libraries.
  await cp(archive, join(notices, `${source.name}-${source.version}.tar.gz`));
}
compile(native, "helper-build");
await cp(join(native, "sources.json"), join(prefix, "sources.json"));
console.log(`Image decoder ready: ${join(prefix, "bin/heif-decode")}`);
