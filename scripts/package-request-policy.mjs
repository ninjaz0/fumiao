import { build } from "esbuild";
import { createHash } from "node:crypto";
export async function packageRequestPolicy(
  adapter,
  version,
  errors,
  options = {},
) {
  const manifest = structuredClone(adapter.manifest);
  manifest.version = version;
  manifest.queue.timingVersions.push(version);
  manifest.configSchema.properties.baseUrl.pattern = "^https://";
  manifest.artifactValidation = { version: 3, errors };
  const compiled = await build({
    entryPoints: ["plugins/" + manifest.id + "/package/policy.js"],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "policy",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "none",
    define: {
      MODEL_FORMS: JSON.stringify(
        Object.fromEntries(
          manifest.models.map((m) => [m.id, adapter.modelForm(m)]),
        ),
      ),
    },
  });
  const studioProgram =
    "(()=>{" + compiled.outputFiles[0].text + ";return policy.default})()";
  manifest.originalSubmission = {
    version: 5,
    ...options,
    studioDigest: createHash("sha256").update(studioProgram).digest("hex"),
  };
  process.stdout.write(
    JSON.stringify({
      manifest,
      studioProgram,
      contributes: {
        version: 1,
        hostCapabilities: ["http", "secrets", "media"],
        http: { origins: options.artifactOrigins ?? [], connection: true },
      },
    }),
  );
}
