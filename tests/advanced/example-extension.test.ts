import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  contributesSchema,
  contributionProblems,
  packageContributions,
  programActionOutputSchema,
  viewSchema,
} from "@fumiao/plugin-sdk/contributions.js";
import { manifestSchema } from "@fumiao/plugin-sdk/index.js";
import { loadProgram } from "@fumiao/platform/plugin-program.js";
import { validator } from "@fumiao/platform/schema.js";
import { validOriginalRemoteModels } from "@fumiao/plugin-remote/original.js";

const directory = new URL("../../plugins/example-extension/", import.meta.url);
const bytes = readFileSync(
  new URL("example-extension.fmplugin.json", directory),
);
const pkg = JSON.parse(bytes.toString("utf8"));
const contributions = packageContributions(pkg);
const settings = contributions.settings!;

function page(id: string) {
  const found = contributions.settingsPages.find((page) => page.id === id);
  assert.ok(found, id);
  return found;
}

test("the release digest, remote model and packaged contributions match their contracts", () => {
  const update = JSON.parse(
    readFileSync(new URL("update.json", directory), "utf8"),
  );
  assert.equal(update.package, "example-extension.fmplugin.json");
  assert.equal(update.id, pkg.id);
  assert.equal(update.version, pkg.version);
  assert.equal(update.sha256, createHash("sha256").update(bytes).digest("hex"));
  const manifest = manifestSchema.parse(pkg.remote.manifest);
  assert.equal(manifest.id, pkg.id);
  assert.equal(manifest.version, pkg.adapterVersion);
  assert.equal(manifest.mode, "request");
  assert.ok(validOriginalRemoteModels(manifest));
  assert.equal(pkg.settingsPage, undefined);
  assert.equal(pkg.adapterModule, undefined);
  const parsed = contributesSchema.parse(pkg.contributes);
  assert.deepEqual(
    contributionProblems(parsed, {
      mode: manifest.mode,
      hasProgram: !!pkg.program,
    }),
    [],
  );
  assert.deepEqual(contributions, parsed);
  assert.deepEqual(contributions.hostCapabilities, []);
  assert.deepEqual(
    contributions.settingsPages.map((page) => page.id),
    ["display", "overview"],
  );
});

test("the global form shows schema defaults and saves the displayed revision", async () => {
  const display = page("display");
  const run = await loadProgram(display.program);
  for (const [values, revision] of [
    [{}, 0],
    [{ labelMode: "id" }, 7],
  ] as const) {
    assert.ok(validator.validate(settings.global!, values));
    const view = viewSchema.parse(
      run("view", { settings: { global: { values, revision } } }),
    );
    const form = view.blocks[0];
    assert.equal(form.type, "form");
    assert.equal(form.revision, revision);
    assert.deepEqual(display.actions, [
      { id: form.submit.action, kind: "settings", scope: "global" },
    ]);
    const [field] = form.fields;
    assert.equal(field.name, "labelMode");
    assert.equal(field.value, revision === 0 ? "name" : "id");
    for (const option of field.options!) {
      assert.ok(
        validator.validate(settings.global!, { [field.name]: option.value }),
      );
    }
  }
});

test("the overview toggle changes only the workspace filter, including from an empty list", async () => {
  const overview = page("overview");
  const run = await loadProgram(overview.program);
  const workspace = {};
  assert.ok(validator.validate(settings.workspace!, workspace));
  assert.deepEqual(workspace, { showDisabled: true });
  const input = {
    models: [
      {
        id: "example-extension-image",
        label: "示例色卡",
        kind: "image",
        enabled: false,
      },
    ],
    settings: {
      global: { values: { labelMode: "name" }, revision: 5 },
      workspace: { values: workspace, revision: 2 },
    },
  };
  for (const showDisabled of [true, false]) {
    const view = viewSchema.parse(run("view", input));
    const list = view.blocks[0];
    assert.equal(list.type, "list");
    assert.deepEqual(
      list.rows.map((row) => row.title),
      showDisabled ? ["示例色卡"] : [],
    );
    assert.ok(list.empty);
    const button = view.primary!;
    assert.ok(button.confirm);
    assert.deepEqual(overview.actions, [
      { id: button.action, kind: "program" },
    ]);
    const result = programActionOutputSchema.parse(
      run("action", button.action, {}, input),
    );
    assert.deepEqual(result.settings, {
      workspace: { showDisabled: !showDisabled },
    });
    assert.ok(
      validator.validate(settings.workspace!, result.settings!.workspace),
    );
    input.settings.workspace.values = result.settings!.workspace!;
    input.settings.workspace.revision++;
  }
  input.settings.global.values.labelMode = "id";
  input.models[0].enabled = true;
  input.settings.workspace.values = { showDisabled: false };
  const [list] = viewSchema.parse(run("view", input)).blocks;
  assert.equal(list.type, "list");
  assert.equal(list.rows[0].title, input.models[0].id);
});

test("migration carries old preferences into the new schemas and preserves current values", async () => {
  const run = await loadProgram("({migrate:" + settings.migrate + "\n})");
  for (const [scope, old, expected] of [
    ["global", { useModelIds: true }, { labelMode: "id" }],
    ["global", { useModelIds: false }, { labelMode: "name" }],
    ["workspace", { includeDisabled: false }, { showDisabled: false }],
    ["workspace", { includeDisabled: true }, { showDisabled: true }],
  ] as const) {
    const migrated = run("migrate", old, {
      scope,
      from: "1.0.0",
      to: pkg.version,
    });
    assert.deepEqual(migrated, expected);
    assert.ok(validator.validate(settings[scope]!, migrated));
    assert.deepEqual(
      run("migrate", migrated, { scope, from: pkg.version, to: "1.2.0" }),
      expected,
    );
  }
});
