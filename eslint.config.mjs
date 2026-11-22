import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import importX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));
const workspaces = ["apps", "packages", "plugins"].flatMap((group) =>
  readdirSync(join(root, group))
    .map((name) => `${group}/${name}`)
    .filter((path) => existsSync(join(root, path, "package.json"))),
);

// Workspace packages are imported by name. A relative path into another
// package bypasses its exports and its declared dependencies.
const relative = {
  regex: "^(\\.\\./)+(apps|packages|plugins)/",
  message: "Import workspace packages by name, e.g. @fumiao/platform/db.js.",
};
const apps = {
  group: ["@fumiao/api", "@fumiao/api/**", "@fumiao/web", "@fumiao/web/**", "@fumiao/worker", "@fumiao/worker/**"],
  message: "Applications are not libraries.",
};
const otherPlugins = ["@fumiao/plugin-*/**", "!@fumiao/plugin-sdk/**"];
const boundary = (files, patterns, ignores = []) => ({
  files,
  ignores,
  rules: {
    "no-restricted-imports": ["error", { patterns: [relative, apps, ...patterns] }],
  },
});

// The layers, lowest first: plugin-sdk and web-compat, image-import,
// platform, original-api, then the applications. Plugins sit on plugin-sdk.
// `debt` lists the files that still cross a layer; do not add to it.
const debt = {
  plugins: [
    "plugins/flow/src/{lifecycle,artifacts}.ts",
    "plugins/images/src/{settings,lifecycle}.ts",
    "plugins/remote/src/original.ts",
    "plugins/muse/src/artifacts.ts",
  ],
  imageImport: ["packages/image-import/src/index.ts"],
  platform: [
    "packages/platform/src/{plugins,payments,historical-adapters,studio-packages,portable-plugin}.ts",
    "packages/platform/src/{import-canvases,plugin-pages}.ts",
  ],
  originalApi: ["packages/original-api/src/{storyboard-exports,recharge}.ts"],
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/build/**",
      "**/package/**",
      "baseline/**",
      ".runtime-advanced/**",
      "apps/web/next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "import-x": importX, "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-restricted-imports": ["error", { patterns: [relative] }],
      "import-x/no-extraneous-dependencies": ["error", { packageDir: [root] }],
      "import-x/no-self-import": "error",
    },
  },
  // A dropped promise loses its error; in a worker that is a job stuck in
  // its queue. `void` marks the ones that report failures themselves.
  ...[
    ["apps/web/tsconfig.json", ["apps/web/**/*.{ts,tsx}"]],
    ["tsconfig.json", ["{apps/api,apps/worker,packages,plugins,scripts,tests}/**/*.ts"]],
  ].map(([project, files]) => ({
    files,
    languageOptions: { parserOptions: { project, tsconfigRootDir: root } },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe"] },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
    },
  })),
  // Every workspace declares what it imports.
  ...workspaces.map((path) => ({
    files: [`${path}/**/*.{ts,tsx,mjs}`],
    rules: {
      "import-x/no-extraneous-dependencies": ["error", { packageDir: [join(root, path)] }],
    },
  })),
  // Tests reach into applications, which export nothing. Their mock HTTP
  // servers, like the example plugin servers, take async request handlers.
  { files: ["tests/**"], rules: { "no-restricted-imports": "off" } },
  {
    files: ["tests/**", "plugins/example-*/**"],
    rules: {
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
    },
  },
  boundary(["packages/plugin-sdk/**", "packages/web-compat/**"], [
    { group: ["@fumiao/**"], message: "This package is the bottom layer." },
  ]),
  boundary(["packages/image-import/**"], [
    { group: ["@fumiao/**"], message: "image-import is a leaf library." },
  ], debt.imageImport),
  boundary(["plugins/*/src/**"], [
    {
      group: ["@fumiao/platform/**", "@fumiao/original-api/**", "@fumiao/web-compat/**", ...otherPlugins],
      message: "Plugins build on @fumiao/plugin-sdk only.",
    },
  ], debt.plugins),
  boundary(["packages/platform/**"], [
    {
      group: ["@fumiao/original-api/**", "@fumiao/web-compat/**", ...otherPlugins],
      message: "platform sits below original-api and does not know individual plugins.",
    },
  ], debt.platform),
  boundary(["packages/original-api/**"], [
    { group: otherPlugins, message: "Reach plugins through the registry." },
  ], debt.originalApi),
  boundary(["apps/web/**"], [
    {
      group: ["@fumiao/platform/**", "@fumiao/image-import/**", ...otherPlugins, "@fumiao/original-api/**", "!@fumiao/original-api/asset-limits"],
      message: "The browser bundle only shares contracts: plugin-sdk, web-compat and asset limits.",
    },
  ]),
);
