import { build } from "esbuild";
import { createHash } from "node:crypto";
export async function packageRequestPolicy(
  adapter,
  version,
  errors,
  options = {},
) {
  const { priorTimingVersions = [], queueVersion, ...submissionOptions } =
    options;
  const manifest = structuredClone(adapter.manifest);
  manifest.version = version;
  if (queueVersion !== undefined) manifest.queue.version = queueVersion;
  manifest.queue.timingVersions.push(...priorTimingVersions, version);
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
    ...submissionOptions,
    studioDigest: createHash("sha256").update(studioProgram).digest("hex"),
  };
  process.stdout.write(
    JSON.stringify({
      manifest,
      studioProgram,
      contributes: {
        version: 1,
        hostCapabilities: ["http", "secrets", "media"],
        http: {
          origins: submissionOptions.artifactOrigins ?? [],
          connection: true,
        },
      },
    }),
  );
}
