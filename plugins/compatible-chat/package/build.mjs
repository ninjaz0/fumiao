import { build } from "esbuild";
import { chatStreaming } from "@fumiao/plugin-chat/stream.js";
const manifest = structuredClone(chatStreaming.manifest);
manifest.version = process.argv[2];
for (const p of manifest.chat.providers) delete p.credentialFallback;
manifest.configSchema.properties.baseUrl.pattern = "^https://";
const origins = manifest.chat.providers.map(
  (p) => new URL(p.defaultConfig.baseUrl).origin,
);
const compiled = await build({
  entryPoints: ["plugins/compatible-chat/package/policy.js"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "policy",
  target: "es2022",
  minify: true,
  write: false,
  legalComments: "none",
});
manifest.chat.sandbox = {
  program:
    "(()=>{" + compiled.outputFiles[0].text + ";return policy.default})()",
  origins,
};
process.stdout.write(
  JSON.stringify({
    manifest,
    contributes: {
      version: 1,
      hostCapabilities: ["http", "secrets"],
      http: { origins },
    },
  }),
);
