import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { databaseFixture } from "../tests/helpers/database.js";
import { canvasImportTables } from "../tests/helpers/canvas-import.js";
import {
  importLegacy,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../packages/original-api/src/identity.js";
import { OriginalCanvasRuns } from "../packages/original-api/src/canvas-runs.js";
import { OriginalCanvases } from "../packages/original-api/src/canvases.js";
import { OriginalCredits } from "../packages/original-api/src/credits.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { museCanvasRuns } from "../plugins/muse/src/canvas-runs.js";
import { flowCanvasRuns } from "../plugins/flow/src/canvas-runs.js";
import { gpuCanvasRuns } from "../plugins/gpu/src/canvas-runs.js";
import { imagesCanvasRuns } from "../plugins/images/src/canvas-runs.js";
import { one } from "../packages/platform/src/db.js";
import { DomainError } from "../packages/platform/src/security.js";
import { ValidationError } from "../packages/original-api/src/validation.js";
import { canonical } from "../packages/platform/src/plugins.js";
const f = await databaseFixture(),
  failures: any[] = [];
const sorted = (rows: unknown[]) => rows.map(canonical).sort();
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/canvas-import-fixtures.py", f.directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data: LegacyExport = JSON.parse(
      await readFile(join(f.directory, "export.json"), "utf8"),
    ),
    oracle = JSON.parse(
      await readFile(join(f.directory, "manifest.json"), "utf8"),
    );
  assert.equal(
    (await stat(join(f.directory, "export.json"))).mode & 0o777,
    0o600,
  );
  assert.equal(data.canvasVersion, 1);
  await importLegacy(f.p, data, join(f.directory, "runtime/media"));
  const actual = await canvasImportTables(f.db);
  for (const [name, rows] of Object.entries(actual))
    assert.deepEqual(
      sorted(rows),
      sorted(data.tables[name]),
      name + " exact fields",
    );
  const identity = new OriginalIdentity(f.p),
    actors: OriginalActor[] = [];
  for (const user of data.tables.users)
    actors.push(
      await identity.actor(
        await identity.login(
          { name: user.name, password: "canvas-import-fixture" },
          "canvas-import",
        ),
      ),
    );
  const credits = new OriginalCredits(f.p);
  for (const account of data.tables.credit_accounts) {
    const ledger = await credits.history(f.db, account.workspace),
      expected = data.tables.credit_ledger.filter(
        (l) => l.workspace === account.workspace,
      );
    assert.equal(ledger.length, expected.length);
    for (const row of ledger) {
      const original = expected.find((r) => r.id === row.id)!;
      for (const key of [
        "job",
        "amount",
        "balance",
        "reserved",
        "action",
        "created",
        "note",
      ] as const)
        assert.deepEqual(row[key], original[key], "ledger " + key);
    }
  }
  assert.equal((await one(f.db, "SELECT count(*)::int AS n FROM outbox")).n, 0);
  assert.equal(
    (await one(f.db, "SELECT sum(held)::int AS n FROM wallets")).n,
    0,
  );
  // Only activate immutable local policy manifests. No connection or credential is configured.
  const policy = await one(f.db, "SELECT * FROM studio_policy");
  await f.p.registry.installBuiltins(f.db);
  await f.db.transaction(async (sql) => {
    for (const p of [
      museCanvasRuns,
      flowCanvasRuns,
      gpuCanvasRuns,
      imagesCanvasRuns,
    ])
      await new StudioCatalog(f.db).activate(sql, p.manifest);
  });
  await f.db.query(
    "UPDATE studio_policy SET flags=$1,revision=$2,price_revision=$3",
    [JSON.stringify(oracle.flags), policy.revision, policy.price_revision],
  );
  let stamp = 0;
  const canvases = new OriginalCanvases(f.p, () => stamp),
    aliases = new Map<string, string>(),
    initialUids = new Set(data.tables.canvas_job_links.map((l) => l.uid));
  const resolveId = (v: string) =>
    [...aliases].find(([, name]) => name === v)?.[0] ?? v;
  function normalize(value: any): any {
    if (typeof value === "string") return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, normalize(v)]),
      );
    return value;
  }
  async function snapshot() {
    const rows = await canvasImportTables(f.db);
    for (const row of rows.canvas_projects)
      row.document = JSON.parse(row.document);
    for (const row of rows.canvas_job_links)
      if (!initialUids.has(row.uid)) row.uid = "$new-link-" + row.id;
    return normalize(rows);
  }
  for (const c of oracle.cases) {
    stamp = c.stamp;
    const op = c.operation,
      actor = actors[op.user],
      project = resolveId(op.project),
      selected = op.workspace == null ? undefined : String(op.workspace);
    let status = 200,
      body: any;
    try {
      if (["generate", "candidates", "narrate"].includes(op.action))
        body = await new OriginalCanvasRuns(f.p)[
          op.action as "generate" | "candidates" | "narrate"
        ](actor, project, op.node, op.body);
      else if (op.action === "runs")
        body = await new OriginalCanvasRuns(f.p).list(actor, project);
      else if (op.action === "list")
        body = await canvases.list(actor, selected);
      else if (op.action === "get") body = await canvases.get(actor, project);
      else if (op.action === "duplicate") {
        body = await canvases.duplicate(actor, project);
        aliases.set(body.id, "$copy" + (aliases.size + 1));
      } else if (op.action === "save")
        body = await canvases.save(actor, project, op.body);
      else if (op.action === "remove")
        body = await canvases.remove(actor, project);
      else throw Error("Unknown action");
    } catch (e) {
      if (e instanceof ValidationError) {
        status = 422;
        body = { detail: e.detail };
      } else if (e instanceof DomainError) {
        status = e.status;
        body = { detail: e.message };
      } else throw e;
    }
    try {
      assert.equal(status, c.status);
      assert.deepEqual(normalize(body), c.expected);
      const state = await snapshot();
      for (const [name, rows] of Object.entries(state))
        assert.deepEqual(
          sorted(rows as any[]),
          sorted(c.state[name]),
          name + " after " + op.action,
        );
    } catch (e) {
      failures.push({
        action: op.action,
        project: op.project,
        error: String(e).slice(0, 8000),
      });
    }
  }
  const before = await canvasImportTables(f.db);
  assert.equal(
    (await importLegacy(f.p, data, "unused-on-repeat")).alreadyImported,
    true,
  );
  assert.deepEqual(await canvasImportTables(f.db), before);
  assert.equal((await one(f.db, "SELECT count(*)::int AS n FROM outbox")).n, 0);
  const report = {
    passed: !failures.length,
    records: Object.fromEntries(
      Object.entries(actual).map(([k, v]) => [k, v.length]),
    ),
    scenarios: oracle.cases.length,
    exportGuards: oracle.guards,
    failures,
  };
  await mkdir(".runtime-advanced/canvas-import-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/canvas-import-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original canvas history import:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await f.cleanup();
}
