import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { databaseFixture } from "../tests/helpers/database.js";
import { canvasRunPlugins } from "../tests/helpers/canvas-runs.js";
import {
  importLegacy,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../packages/original-api/src/identity.js";
import { OriginalCanvases } from "../packages/original-api/src/canvases.js";
import { OriginalCanvasRuns } from "../packages/original-api/src/canvas-runs.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { one } from "../packages/platform/src/db.js";
import { canvasText } from "../packages/original-api/src/canvas-values.js";
import { DomainError } from "../packages/platform/src/security.js";
import { ValidationError } from "../packages/original-api/src/validation.js";
import { canonical } from "../packages/platform/src/plugins.js";
const f = await databaseFixture(),
  failures: any[] = [];
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/canvas-runs-fixtures.py", f.directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data: LegacyExport = JSON.parse(
      await readFile(join(f.directory, "export.json"), "utf8"),
    ),
    oracle = JSON.parse(
      await readFile(join(f.directory, "manifest.json"), "utf8"),
    );
  await importLegacy(f.p, data, join(f.directory, "runtime/media"));
  const identity = new OriginalIdentity(f.p),
    actors: OriginalActor[] = [];
  for (const user of data.tables.users)
    actors.push(
      await identity.actor(
        await identity.login(
          { name: user.name, password: "canvas-runs-fixture" },
          "canvas-runs",
        ),
      ),
    );
  const policy = await one(f.db, "SELECT * FROM studio_policy"),
    catalog = new StudioCatalog(f.db);
  await f.p.registry.installBuiltins(f.db);
  for (const plugin of canvasRunPlugins) {
    await f.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
    const c = await f.p.createConnection(actors[0], {
      name: plugin.manifest.id,
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      config:
        plugin.manifest.mode === "pull"
          ? {}
          : { baseUrl: "http://127.0.0.1:9", apiKey: "sk-fixture-unused" },
    });
    await f.p.updateConnection(actors[0], c.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
  }
  await f.db.query(
    "UPDATE studio_policy SET revision=$1,price_revision=$2,flags=$3",
    [policy.revision, policy.price_revision, JSON.stringify(policy.flags)],
  );
  let stamp = 0;
  const canvases = new OriginalCanvases(f.p, () => stamp),
    runs = new OriginalCanvasRuns(f.p, () => stamp),
    aliases = new Map<string, string>(),
    links = new Map<number, string>();
  const resolveId = (v: string) =>
    [...aliases].find(([, alias]) => alias === v)?.[0] ?? v;
  const jobId = (v: any) => (v == null ? null : (aliases.get("job:" + v) ?? v));
  function normalize(value: any): any {
    if (typeof value === "string") return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, normalize(v)]),
      );
    return value;
  }
  async function register() {
    for (const j of (
      await f.db.query("SELECT public_id FROM jobs ORDER BY public_id")
    ).rows)
      if (!aliases.has("job:" + j.public_id))
        aliases.set(
          "job:" + j.public_id,
          "$job" +
            ([...aliases.keys()].filter((k) => k.startsWith("job:")).length +
              1),
        );
    for (const l of (
      await f.db.query("SELECT id FROM canvas_job_links ORDER BY id")
    ).rows)
      if (!links.has(Number(l.id)))
        links.set(Number(l.id), "$link" + (links.size + 1));
  }
  function response(value: any) {
    const v = structuredClone(value);
    if (v && typeof v === "object") {
      if (typeof v.id === "number") v.id = jobId(v.id);
      if (v.ids) v.ids = v.ids.map(jobId);
    }
    return normalize(v);
  }
  async function snapshot() {
    const rows = (
      await f.db.query(
        "SELECT j.*,u.public_id AS owner,w.public_id AS workspace FROM jobs j JOIN users u ON u.id=j.owner_id JOIN workspaces w ON w.id=j.workspace_id ORDER BY j.public_id",
      )
    ).rows;
    const fields = [
      "refs",
      "ratio",
      "quality",
      "seconds",
      "sampling_steps",
      "seed",
      "width",
      "height",
      "image_quality",
      "audio_settings",
      "h3_inputs",
    ];
    const jobs = rows.map((j) => ({
      id: jobId(Number(j.public_id)),
      owner: Number(j.owner),
      workspace: Number(j.workspace),
      kind: j.kind,
      model: j.provider_model,
      prompt: j.input.prompt,
      ...Object.fromEntries(
        fields.map((k) => [
          k,
          k === "seed" && j.kind === "audio"
            ? "$random-audio-seed"
            : j.original_view[k],
        ]),
      ),
      reference_packs: j.reference_packs,
      status: j.state === "completed" ? "done" : j.state,
    }));
    for (const j of rows)
      if (j.kind === "audio")
        assert.ok(
          Number.isSafeInteger(j.original_view.seed) &&
            j.original_view.seed >= 0 &&
            j.original_view.seed < 2 ** 31,
        );
    const rawLinks = (
      await f.db.query(
        "SELECT l.id,d.public_id AS project,l.node,j.public_id AS job,u.public_id AS owner,l.uid,l.inputs FROM canvas_job_links l JOIN documents d ON d.id=l.project_id JOIN users u ON u.id=l.owner_id LEFT JOIN jobs j ON j.id=l.job_id ORDER BY l.id",
      )
    ).rows;
    const ls = rawLinks.map((l) => ({
      ...l,
      id: links.get(Number(l.id)),
      job: jobId(Number(l.job)),
      owner: Number(l.owner),
      inputs: JSON.parse(canvasText(l.inputs)),
    }));
    const bs = (
      await f.db.query(
        "SELECT u.public_id AS owner,b.uid,d.public_id AS project,b.node,b.count,b.result FROM canvas_run_batches b JOIN users u ON u.id=b.owner_id JOIN documents d ON d.id=b.project_id ORDER BY b.uid",
      )
    ).rows.map((b) => ({
      ...b,
      owner: Number(b.owner),
      result: response(JSON.parse(canvasText(b.result))),
    }));
    const wallets = (
      await f.db.query(
        "SELECT w.public_id AS workspace,b.balance,b.held AS reserved FROM wallets b JOIN workspaces w ON w.id=b.workspace_id ORDER BY w.public_id",
      )
    ).rows.map((w) =>
      Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])),
    );
    return normalize({ jobs, links: ls, batches: bs, wallets });
  }
  for (const c of oracle.cases) {
    stamp = c.stamp;
    const op = c.operation,
      actor = actors[op.user],
      project = resolveId(op.project),
      selected = op.workspace == null ? undefined : String(op.workspace);
    let status = 200,
      value: any;
    try {
      if (op.action === "create") {
        value = await canvases.create(actor, op.body, selected);
        aliases.set(
          value.id,
          "$canvas" +
            ([...aliases.keys()].filter((k) => !k.startsWith("job:")).length +
              1),
        );
      } else if (op.action === "save")
        value = await canvases.save(actor, project, op.body);
      else if (op.action === "generate")
        value = await runs.generate(actor, project, op.node, op.body);
      else if (op.action === "candidates")
        value = await runs.candidates(actor, project, op.node, op.body);
      else if (op.action === "narrate")
        value = await runs.narrate(actor, project, op.node, op.body);
      else if (op.action === "list") value = await runs.list(actor, project);
      else if (op.action === "finish") {
        await f.db.transaction(async (sql) => {
          for (const j of (
            await sql.query(
              "SELECT * FROM jobs WHERE state='queued' ORDER BY public_id FOR UPDATE",
            )
          ).rows)
            await f.p.settle(sql, j, "failed");
        });
        value = { ok: true };
      } else if (op.action === "balance") {
        await f.db.query(
          "UPDATE wallets SET balance=$1 WHERE workspace_id=(SELECT id FROM workspaces WHERE public_id=2)",
          [op.body],
        );
        value = { ok: true };
      } else if (op.action === "flags") {
        await f.db.query("UPDATE studio_policy SET flags=$1", [
          JSON.stringify(op.body),
        ]);
        value = { ok: true };
      } else throw Error("unknown action");
    } catch (e) {
      if (e instanceof ValidationError) {
        status = 422;
        value = { detail: e.detail };
      } else if (e instanceof DomainError) {
        status = e.status;
        value = { detail: e.message };
      } else throw e;
    }
    await register();
    try {
      assert.equal(status, c.status);
      if (op.action === "list" && status === 200) {
        // Match each run to its already compared link snapshot. Only generated IDs,
        // wall-clock stamps and random speech seeds differ between the two runtimes.
        const strip = (run: any, index: number, native: boolean) => {
          const r = structuredClone(run);
          assert.ok(
            Number.isSafeInteger(r.created) && Number.isSafeInteger(r.updated),
          );
          delete r.created;
          delete r.updated;
          if (r.kind === "audio") r.seed = "$random-audio-seed";
          if (native) {
            r.id = jobId(r.id);
            r.link_id = links.get(r.link_id);
          }
          return r;
        };
        assert.equal(value.runs.length, c.expected.runs.length);
        assert.deepEqual(
          value.runs.map((r: any, i: number) => strip(r, i, true)),
          c.expected.runs.map((r: any, i: number) => strip(r, i, false)),
        );
      } else assert.deepEqual(response(value), c.expected);
      if (c.state) {
        const actual = await snapshot();
        for (const [name, rows] of Object.entries(actual))
          assert.deepEqual(
            (rows as any[]).map(canonical).sort(),
            c.state[name].map(canonical).sort(),
            name,
          );
      }
    } catch (e) {
      failures.push({
        name: c.name,
        action: op.action,
        error: String(e).slice(0, 10000),
      });
    }
  }
  const report = {
    passed: !failures.length,
    scenarios: oracle.cases.length,
    failures,
  };
  await mkdir(".runtime-advanced/canvas-runs-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/canvas-runs-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original canvas runs:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await f.cleanup();
}
