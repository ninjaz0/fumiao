import { build } from "esbuild";
import { createHash } from "node:crypto";
import { museText } from "../src/text.ts";
const version = process.argv[2];
const manifest = structuredClone(museText.manifest);
manifest.version = version;
manifest.queue.timingVersions.push(version);
manifest.configSchema.properties.baseUrl.pattern = "^https://";
manifest.artifactValidation = {
  version: 3,
  errors: {
    imageFormat: "Muse 返回的图片格式或尺寸无效",
    imageDecode: "Muse 成品保存失败，请检查后重新生成",
    video: "Muse 返回的视频无法验证或方向异常",
    failed: "Muse 成品保存失败，请检查后重新生成",
  },
};
const compiled = await build({
  entryPoints: ["plugins/muse/package/policy.js"],
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
        manifest.models.map((m) => [m.id, museText.modelForm(m)]),
      ),
    ),
  },
});
const studioProgram =
  "(()=>{" + compiled.outputFiles[0].text + ";return policy.default})()";
manifest.originalSubmission = {
  version: 5,
  studioDigest: createHash("sha256").update(studioProgram).digest("hex"),
};
process.stdout.write(
  JSON.stringify({
    manifest,
    studioProgram,
    contributes: {
      version: 1,
      hostCapabilities: ["http", "secrets", "media"],
      http: { origins: [], connection: true },
    },
  }),
);
