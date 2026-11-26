import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packComfyMicroAppDirectory } from "@fumiao/platform/comfy-compiler.js";

async function main() {
  const [, , dirArg, outArg] = process.argv;
  if (!dirArg) {
    console.error("Usage: tsx scripts/pack-comfy-microapp.ts <microapp-dir> [output.fmplugin.json]");
    process.exit(1);
  }
  const packed = await packComfyMicroAppDirectory(dirArg);
  const outPath = resolve(
    outArg || resolve(dirArg, `${packed.package_file.id}.fmplugin.json`),
  );
  await writeFile(outPath, JSON.stringify(packed.package_file, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      plugin_id: packed.package_file.id,
      version: packed.package_file.version,
      model_id: packed.spec.slug,
      model_key: packed.model_key,
      slots: packed.spec.inputs.length,
      output: outPath,
    }),
  );
}

main().catch((err) => {
  console.error((err as Error).message || err);
  process.exit(1);
});
