import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCanvasDocument } from "../packages/original-api/src/canvas-draft.js";
import {
  validateCanvasDocument,
  type CanvasValidationResources,
} from "../packages/original-api/src/canvas-validation.js";
import { CanvasModels } from "../packages/platform/src/canvas-models.js";
import {
  DomainError,
  requireValue,
} from "../packages/platform/src/security.js";
import { museCanvas } from "../plugins/muse/src/canvas.js";
import { flowCanvas } from "../plugins/flow/src/canvas.js";
import { gpuCanvas } from "../plugins/gpu/src/canvas.js";
import { imagesCanvas } from "../plugins/images/src/canvas.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-canvas-validation-"));
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/canvas-validation-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const fixture = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [],
    data = fixture.resources,
    models = new CanvasModels(
      [museCanvas, flowCanvas, gpuCanvas, imagesCanvas].flatMap(
        (p) => p.manifest.canvas!.models,
      ),
    );
  for (const c of fixture.cases) {
    const user = data.users.find((r: any) => r.id === c.user);
    async function authorize(row: any) {
      const space = data.workspaces.find((r: any) => r.id === row?.workspace);
      requireValue(
        row &&
          row.workspace === c.workspace &&
          space &&
          (space.kind === "personal"
            ? space.owner === user.id
            : user.role === "admin" ||
              data.workspace_members.some(
                (r: any) => r.workspace === space.id && r.user === user.id,
              )),
        404,
        "内容不存在或无权访问",
      );
    }
    function linked(node: string, key: number) {
      return data.canvas_job_links.some(
        (r: any) =>
          r.project === fixture.project && r.node === node && r.job === key,
      )
        ? data.jobs.find((r: any) => r.id === key)
        : undefined;
    }
    const resources: CanvasValidationResources = {
      async media(key) {
        const r = data.media.find((r: any) => r.id === key);
        return r ? { kind: r.kind, authorize: () => authorize(r) } : undefined;
      },
      async pack(key) {
        await authorize(data.asset_packs.find((r: any) => r.id === key));
      },
      async voice(node, key) {
        const r = linked(node, key);
        return r?.kind === "audio"
          ? { result: r.result, authorize: () => authorize(r) }
          : undefined;
      },
      async active(node, key, kind) {
        const r = linked(node, key);
        return (
          !!r && r.kind === kind && r.status === "done" && r.result !== null
        );
      },
    };
    let status = 200,
      value: unknown;
    try {
      value = (
        await validateCanvasDocument(
          parseCanvasDocument(c.document),
          models,
          resources,
        )
      ).sort((a, b) =>
        a.node < b.node
          ? -1
          : a.node > b.node
            ? 1
            : a.media < b.media
              ? -1
              : a.media > b.media
                ? 1
                : 0,
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      status = error.status;
      value = { detail: error.message };
    }
    try {
      assert.equal(status, c.status);
      assert.deepEqual(value, c.expected);
    } catch (error) {
      failures.push({ name: c.name, error: String(error).slice(0, 2500) });
    }
  }
  for (const [i, c] of fixture.templates.entries()) {
    try {
      assert.equal(models.template(c.flags), c.expected);
    } catch (error) {
      failures.push({ name: "template-" + i, error: String(error) });
    }
  }
  const report = {
    passed: !failures.length,
    scenarios: fixture.cases.length,
    templates: fixture.templates.length,
    failures,
  };
  await mkdir(".runtime-advanced/canvas-validation-parity", {
    recursive: true,
  });
  await writeFile(
    ".runtime-advanced/canvas-validation-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original canvas validation parity:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
