import { gpuText } from "../src/text.ts";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const version = process.argv[2];
const manifest = {
  ...gpuText.manifest,
  version,
  queue: {
    ...gpuText.manifest.queue,
    timingVersions: [...gpuText.manifest.queue.timingVersions, version],
  },
};
delete manifest.artifactValidation;
async function guest(entry, define = {}) {
  const result = await build({
    entryPoints: [resolve("plugins/gpu/package", entry)],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "policy",
    target: "es2022",
    write: false,
    minify: true,
    legalComments: "none",
    define,
    plugins: [
      {
        name: "sandbox-crypto",
        setup(b) {
          b.onResolve({ filter: /^\.\/policy-crypto\.js$/ }, () => ({
            path: resolve("plugins/gpu/package/guest-crypto.js"),
          }));
        },
      },
    ],
  });
  return "(()=>{" + result.outputFiles[0].text + ";return policy.default})()";
}
const studioProgram = await guest("studio-policy.js", {
  MODEL_FORMS: JSON.stringify(
    Object.fromEntries(
      manifest.models.map((m) => [m.id, gpuText.modelForm(m)]),
    ),
  ),
  STATE_CONFIGURATION: JSON.stringify(
    gpuText.originalState.configuration({
      stamp: 0,
      catalog: {},
      imageEnabled: true,
    }),
  ),
});
manifest.originalSubmission = {
  version: 4,
  studioDigest: createHash("sha256").update(studioProgram).digest("hex"),
};
process.stdout.write(
  JSON.stringify({
    manifest,
    studioProgram,
    program: await guest("program.js"),
  }),
);
