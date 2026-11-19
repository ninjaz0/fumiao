import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canvasesFixture } from "../tests/helpers/canvases.js";
import {
  canvasDocumentJson,
  canvasText,
  canvasVoiceIds,
} from "../packages/original-api/src/canvas-values.js";
import { one } from "../packages/platform/src/db.js";
import { DomainError } from "../packages/platform/src/security.js";
import { ValidationError } from "../packages/original-api/src/validation.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-canvas-storage-"));
let f: Awaited<ReturnType<typeof canvasesFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/canvas-storage-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await canvasesFixture();
  await f.db.query("UPDATE studio_policy SET flags=$1", [
    JSON.stringify(data.initial_flags),
  ]);
  const key = (n: number) => n.toString(16).padStart(32, "0"),
    assets: Record<number, any> = {};
  for (const [i, kind, space, owner] of [
    [1, "ref", f.workspace, f.admin],
    [2, "video", f.workspace, f.admin],
    [3, "audio", f.workspace, f.admin],
    [4, "ref", f.memberSpace, f.member],
    [5, "ref", f.team, f.member],
  ] as const)
    assets[i] = await f.asset(key(i), kind, space, owner);
  for (const [id, kind, state, result] of [
    [1, "video", "completed", 2],
    [2, "video", "queued", null],
    [3, "audio", "completed", 3],
    [4, "image", "completed", 1],
    [5, "audio", "queued", null],
  ] as const)
    await f.job(id, kind, state, result ? assets[result].id : undefined);
  const pack = await f.db.transaction((sql) =>
    f!.canvases.packs.save(sql, f!.admin, f!.workspace.id, {
      name: "包",
      purpose: "subject",
      description: "",
      media: [key(1)],
      expected_revision: null,
    }),
  );
  await f.db.query("UPDATE documents SET public_id=$2 WHERE id=$1", [
    pack.id,
    key(8),
  ]);
  const aliases = new Map<string, string>();
  let counter = 0;
  function register(key: string) {
    aliases.set(key, "$c" + ++counter);
  }
  function resolveInput(value: any): any {
    if (typeof value === "string")
      return [...aliases].find(([, v]) => v === value)?.[0] ?? value;
    if (Array.isArray(value)) return value.map(resolveInput);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolveInput(v)]),
      );
    return value;
  }
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
    const projects = (
      await f!.db
        .query(`SELECT d.public_id AS id,c.title,u.public_id AS owner,e.public_id AS last_editor,c.created,c.updated,d.revision,c.document,w.public_id AS workspace
      FROM canvas_documents c JOIN documents d ON d.id=c.project_id JOIN users u ON u.id=d.owner_id JOIN users e ON e.id=c.last_editor JOIN workspaces w ON w.id=d.workspace_id`)
    ).rows.map((r) =>
      normalize({
        ...r,
        title: canvasText(r.title),
        owner: Number(r.owner),
        last_editor: Number(r.last_editor),
        created: Number(r.created),
        updated: Number(r.updated),
        workspace: Number(r.workspace),
        document: canvasDocumentJson(r.document),
      }),
    );
    const refs = (
      await f!.db.query(
        "SELECT d.public_id AS project,r.node,a.public_id AS media FROM canvas_media_refs r JOIN documents d ON d.id=r.project_id JOIN assets a ON a.id=r.asset_id",
      )
    ).rows.map(normalize);
    const links = (
      await f!.db.query(
        "SELECT l.id,d.public_id AS project,l.node,j.public_id AS job,u.public_id AS owner,l.inputs,l.created FROM canvas_job_links l JOIN documents d ON d.id=l.project_id LEFT JOIN jobs j ON j.id=l.job_id JOIN users u ON u.id=l.owner_id",
      )
    ).rows.map((r) =>
      normalize({
        ...r,
        id: Number(r.id),
        job: r.job === null ? null : Number(r.job),
        owner: Number(r.owner),
        created: Number(r.created),
        inputs: canvasText(r.inputs),
        uid: "$link-uid" + r.id,
      }),
    );
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return {
      projects: projects.sort((a, b) => cmp(a.id, b.id)),
      refs: refs.sort(
        (a, b) =>
          cmp(a.project, b.project) ||
          cmp(a.node, b.node) ||
          cmp(a.media, b.media),
      ),
      links: links.sort((a, b) => a.id - b.id),
    };
  }
  for (const c of data.cases) {
    f.setTime(c.stamp);
    const op = c.operation,
      user = op.user === 1 ? f.admin : f.member,
      project = resolveInput(op.project),
      body = resolveInput(op.body),
      selected = op.workspace === null ? undefined : String(op.workspace);
    let status = 200,
      value: any;
    try {
      switch (op.action) {
        case "create":
          value = await f.canvases.create(user, body, selected);
          register(value.id);
          break;
        case "get":
          value = await f.canvases.get(user, project);
          break;
        case "list":
          value = await f.canvases.list(user, selected);
          break;
        case "save":
          value = await f.canvases.save(user, project, body);
          break;
        case "duplicate":
          value = await f.canvases.duplicate(user, project);
          register(value.id);
          break;
        case "remove":
          value = await f.canvases.remove(user, project);
          break;
        case "links":
          for (const link of body)
            await f.link(
              project,
              link.node,
              link.job,
              link.inputs ?? "{}",
              user,
            );
          value = { ok: true };
          break;
        case "flags":
          await f.db.query("UPDATE studio_policy SET flags=$1", [
            JSON.stringify(body),
          ]);
          value = { ok: true };
          break;
        case "fill":
          while (
            Number(
              (
                await one(
                  f.db,
                  "SELECT count(*) AS n FROM canvas_documents c JOIN documents d ON d.id=c.project_id WHERE d.workspace_id=$1",
                  [f.workspace.id],
                )
              ).n,
            ) < 200
          ) {
            const p = await f.canvases.create(f.admin, {});
            register(p.id);
          }
          value = { ok: true };
          break;
        default:
          throw new Error("Unknown action");
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        status = 422;
        value = { detail: error.detail };
      } else if (error instanceof DomainError) {
        status = error.status;
        value = { detail: error.message };
      } else {
        status = 500;
        value = "Internal Server Error";
      }
    }
    try {
      assert.equal(status, c.status);
      assert.deepEqual(normalize(value), c.expected);
      assert.deepEqual(await snapshot(), c.state);
    } catch (error) {
      failures.push({ name: c.name, error: String(error).slice(0, 8000) });
    }
  }
  for (const c of data.voice_orders) {
    try {
      assert.deepEqual(canvasVoiceIds(c.current, c.pending), c.expected);
    } catch (error) {
      failures.push({
        name: `voice-order-${c.current}-${c.pending}`,
        error: String(error),
      });
    }
  }
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    voiceOrders: data.voice_orders.length,
    failures,
  };
  await mkdir(".runtime-advanced/canvas-storage-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/canvas-storage-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original canvas storage parity:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
