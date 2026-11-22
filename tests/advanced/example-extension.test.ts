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
import {
  loadProgram,
  programLimits,
  runProgram,
} from "@fumiao/platform/plugin-program.js";
import { hostLimits } from "@fumiao/platform/plugin-host.js";
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
  assert.deepEqual(contributions.hostCapabilities, ["data"]);
  assert.deepEqual(
    contributions.settingsPages.map((page) => page.id),
    ["display", "overview", "notes"],
  );
});

test("the notes page keeps its own data through the host", async () => {
  const notes = page("notes");
  const store = new Map<string, unknown>();
  const host = async (name: string, args: unknown[]) => {
    const key = String(args[0] ?? "");
    if (name === "data.list")
      return {
        keys: [...store.keys()].filter((k) => k.startsWith(key)).sort(),
        more: false,
      };
    if (name === "data.get") return store.get(key) ?? null;
    if (name === "data.put") return (store.set(key, args[1]), true);
    return store.delete(key);
  };
  const all = ["data.get", "data.list", "data.put", "data.delete"];
  const view = async () =>
    viewSchema.parse(
      await runProgram(notes.program, "view", [{}], all.slice(0, 2), host),
    );
  const act = (id: string, payload: object) =>
    runProgram(notes.program, "action", [id, payload, {}], all, host);
  const rows = async () => {
    const list = (await view()).blocks.find((b) => b.type === "list");
    return list?.type === "list" ? list.rows.map((r) => [r.id, r.title]) : [];
  };
  assert.deepEqual(await rows(), []);
  assert.deepEqual(await act("add-note", { text: " 第一条 " }), {
    notice: "备注已保存",
  });
  await act("add-note", { text: "第二条" });
  assert.deepEqual(await rows(), [
    ["note/000001", "第一条"],
    ["note/000002", "第二条"],
  ]);
  await act("remove-note", { key: "note/000001" });
  await act("add-note", { text: "第三条" });
  assert.deepEqual(await rows(), [
    ["note/000002", "第二条"],
    ["note/000003", "第三条"],
  ]);
  await assert.rejects(act("add-note", { text: "  " }));
  assert.deepEqual(
    notes.actions.map((a) => a.kind),
    ["program", "program"],
  );
});

for (const legacyCount of [0, 40, 60, 220]) {
  test(`notes remain usable with ${legacyCount} legacy notes and 60 new notes`, async () => {
    const notes = page("notes");
    const store = new Map<string, unknown>();
    for (let i = 1; i <= legacyCount; i++)
      store.set(`notes/${String(i).padStart(6, "0")}`, {
        text: `old ${i}`,
        savedAt: "",
      });
    let calls = 0;
    const host = async (name: string, args: unknown[]) => {
      calls++;
      const key = String(args[0] ?? "");
      if (name === "data.list") {
        const keys = [...store.keys()].filter((k) => k.startsWith(key)).sort();
        return { keys: keys.slice(0, 200), more: keys.length > 200 };
      }
      if (name === "data.get") return store.get(key) ?? null;
      if (name === "data.put") {
        store.set(key, structuredClone(args[1]));
        return true;
      }
      assert.equal(name, "data.delete");
      return store.delete(key);
    };
    const view = async () => {
      calls = 0;
      const result = viewSchema.parse(
        await runProgram(
          notes.program,
          "view",
          [{}],
          ["data.get", "data.list"],
          host,
        ),
      );
      assert.ok(calls <= programLimits.hostCalls);
      return result;
    };
    const act = async (id: string, payload = {}) => {
      calls = 0;
      const result = await runProgram(
        notes.program,
        "action",
        [id, payload, {}],
        ["data.get", "data.list", "data.put", "data.delete"],
        host,
      );
      assert.ok(calls <= programLimits.hostCalls);
      return result;
    };
    const rows = (result: Awaited<ReturnType<typeof view>>) =>
      result.blocks.flatMap((block) =>
        block.type === "list" ? block.rows : [],
      );
    let result = await view();
    assert.equal(result.primary, undefined);
    assert.equal(
      !!result.description,
      legacyCount > programLimits.hostCalls - 2,
    );
    const initialIds = rows(result).map((row) => row.id);
    if (legacyCount) {
      await act("add-note", { text: "during migration" });
      const added = rows(await view()).find(
        (row) => row.title === "during migration",
      );
      assert.ok(added);
      await act("remove-note", { key: added.id });
      result = await view();
      assert.deepEqual(
        rows(result)
          .slice(0, initialIds.length)
          .map((row) => row.id),
        initialIds,
      );
    }
    for (let i = 1; i <= 60; i++) {
      await act("add-note", { text: `new ${i}` });
      if (legacyCount === 60 && i === 3) {
        assert.equal(
          [...store.keys()].filter((key) => key.startsWith("notes/")).length,
          0,
        );
        assert.equal(rows(await view()).length, 63);
      }
      if ([32, 40, 60].includes(i)) {
        const rendered = rows(await view());
        assert.equal(rendered.length, legacyCount + i);
        assert.equal(
          new Set(rendered.map((row) => row.id)).size,
          rendered.length,
        );
      }
    }
    assert.equal(
      [...store.keys()].filter((key) => key.startsWith("notes/")).length,
      0,
    );
    const complete = await view();
    assert.equal(complete.description, undefined);
    assert.deepEqual(
      rows(complete)
        .slice(0, legacyCount)
        .map((row) => row.title),
      Array.from({ length: legacyCount }, (_, i) => `old ${i + 1}`),
    );
    const before = rows(await view());
    for (const row of [before[0], before.at(-1)!])
      await act("remove-note", { key: row.id });
    const after = rows(await view());
    assert.equal(after.length, before.length - 2);
    assert.ok(
      after.every((row) => ![before[0].id, before.at(-1)!.id].includes(row.id)),
    );
    await assert.rejects(act("add-note", { text: " " }));
    await assert.rejects(act("unknown"));
    assert.deepEqual(rows(await view()), after);
  });
}

test("deleting an unmigrated legacy note drains a full batch within the call cap", async () => {
  const store = new Map<string, unknown>();
  for (let i = 1; i <= 60; i++)
    store.set(`notes/${String(i).padStart(6, "0")}`, {
      text: `old ${i}`,
      savedAt: "",
    });
  let calls = 0;
  const host = async (name: string, args: unknown[]) => {
    calls++;
    const key = String(args[0]);
    if (name === "data.get") return store.get(key) ?? null;
    if (name === "data.list")
      return {
        keys: [...store.keys()]
          .filter((key) => key.startsWith("notes/"))
          .sort(),
        more: false,
      };
    if (name === "data.put") return (store.set(key, args[1]), true);
    assert.equal(name, "data.delete");
    return store.delete(key);
  };
  assert.deepEqual(
    await runProgram(
      page("notes").program,
      "action",
      ["remove-note", { key: "notes/000060" }, {}],
      ["data.get", "data.list", "data.put", "data.delete"],
      host,
    ),
    { notice: "备注已删除" },
  );
  assert.equal(calls, programLimits.hostCalls);
  const migrated = store.get("notes-v2") as { notes: { id: string }[] };
  assert.equal(migrated.notes.length, 14);
  assert.equal(store.has("notes/000060"), false);
  assert.equal(store.size - 1 + migrated.notes.length, 59);
  assert.deepEqual(
    migrated.notes.map((note) => note.id),
    Array.from(
      { length: 14 },
      (_, i) => `notes/${String(i + 1).padStart(6, "0")}`,
    ),
  );
});

test("a full notes collection returns a Chinese notice without writing and remains deletable", async () => {
  const notes = page("notes");
  const saved = {
    next: 1,
    notes: [] as { id: string; text: string; savedAt: string }[],
  };
  const text = "中😀".repeat(67).slice(0, 200);
  for (;;) {
    saved.notes.push({
      id: `note/${String(saved.next).padStart(6, "0")}`,
      text,
      savedAt: "",
    });
    saved.next++;
    if (Buffer.byteLength(JSON.stringify(saved)) > hostLimits.dataValueBytes) {
      saved.notes.pop();
      saved.next--;
      break;
    }
  }
  const store = new Map<string, unknown>([["notes-v2", saved]]);
  let puts = 0;
  const host = async (name: string, args: unknown[]) => {
    const key = String(args[0]);
    if (name === "data.get") return store.get(key) ?? null;
    if (name === "data.list") return { keys: [], more: false };
    assert.equal(name, "data.put");
    assert.ok(
      Buffer.byteLength(JSON.stringify(args[1])) <= hostLimits.dataValueBytes,
    );
    puts++;
    store.set(key, structuredClone(args[1]));
    return true;
  };
  const act = async (id: string, payload: object) =>
    programActionOutputSchema.parse(
      await runProgram(
        notes.program,
        "action",
        [id, payload, {}],
        ["data.get", "data.list", "data.put", "data.delete"],
        host,
      ),
    );
  const before = JSON.stringify(saved);
  assert.deepEqual(await act("add-note", { text }), {
    notice: "备注存储空间已满（最多 256 KB），请先删除部分备注后再保存。",
  });
  assert.equal(puts, 0);
  assert.equal(JSON.stringify(store.get("notes-v2")), before);
  const view = viewSchema.parse(
    await runProgram(
      notes.program,
      "view",
      [{}],
      ["data.get", "data.list"],
      host,
    ),
  );
  assert.ok(view.blocks.length <= 40);
  assert.equal(
    view.blocks.flatMap((block) => (block.type === "list" ? block.rows : []))
      .length,
    saved.notes.length,
  );
  await act("remove-note", { key: saved.notes[0].id });
  assert.deepEqual(await act("add-note", { text }), { notice: "备注已保存" });
  assert.equal(puts, 2);
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
