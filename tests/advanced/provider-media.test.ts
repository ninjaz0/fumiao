import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { inspectProviderOutput } from "@fumiao/platform/provider-output.js";
import { Executor } from "@fumiao/platform/executor.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalGeneration } from "@fumiao/original-api/generation.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import { one } from "@fumiao/platform/db.js";
import { museArtifacts } from "@fumiao/plugin-muse/artifacts.js";
import { flowArtifacts } from "@fumiao/plugin-flow/artifacts.js";
import { museDownload } from "@fumiao/plugin-muse/download.js";
import { gpuState } from "@fumiao/plugin-gpu/state.js";
import { imagesState } from "@fumiao/plugin-images/state.js";
import { ArtifactValidationError } from "@fumiao/plugin-sdk/index.js";
import { imageImporter } from "@fumiao/image-import/index.js";
import { DomainError } from "@fumiao/platform/security.js";

async function fixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p),
    password = "artifact-fixture-password";
  let cleanup = () => f.cleanup();
  try {
    await identity.bootstrap({ name: "admin", nickname: "管理员", password });
    const actor = await identity.actor(
      await identity.login({ name: "admin", password }, "fixture"),
    );
    let bytes: Buffer = Buffer.alloc(0);
    let submissions = 0,
      downloads = 0;
    const server = createServer((req, res) => {
      assert.equal(req.headers.authorization, "Bearer local-fixture");
      downloads++;
      res.end(bytes);
    });
    cleanup = async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await f.cleanup();
    };
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const plugins = [museArtifacts, flowArtifacts].map((p) => ({
      ...p,
      requestCapacity: () => null,
      submit: async () => {
        submissions++;
        return {
          state: "completed" as const,
          artifacts: [
            {
              url:
                base +
                (p.manifest.id === "muse" ? "/v1/media/result" : "/tmp/result"),
            },
          ],
          usage: { flow_media_id: null },
        };
      },
    }));
    f.p.registry = new PluginRegistry([
      gpuState,
      imagesState,
      museDownload,
      ...plugins,
    ]);
    await f.p.registry.installBuiltins(f.db);
    const catalog = new StudioCatalog(f.db);
    for (const p of [gpuState, imagesState, ...plugins])
      await f.db.transaction((sql) => catalog.activate(sql, p.manifest));
    for (const p of plugins) {
      const c = await f.p.createConnection(actor, {
        name: p.manifest.id,
        pluginId: p.manifest.id,
        version: p.manifest.version,
        config: { baseUrl: base, apiKey: "local-fixture" },
      });
      await f.p.updateConnection(actor, c.id, {
        revision: 1,
        enabled: true,
        concurrency: 2,
      });
    }
    await f.db.query("UPDATE studio_prices SET amount=1");
    await f.db.query("UPDATE wallets SET balance=1000");
    const workspace = await one(
        f.db,
        "SELECT * FROM workspaces WHERE kind='team'",
      ),
      generation = new OriginalGeneration(f.p),
      executor = new Executor(f.p);
    return {
      ...f,
      actor,
      plugins,
      executor,
      setBytes(value: Buffer) {
        bytes = value;
      },
      counts: () => ({ submissions, downloads }),
      state: () =>
        new OriginalState(f.p).read(actor, String(workspace.public_id)),
      async submit(model: string, kind: "image" | "video") {
        const task = await generation.submit(
          actor,
          await generation.parse(kind, {
            uid: randomUUID(),
            prompt: "artifact fixture",
            model,
            seed: 42,
          }),
          String(workspace.public_id),
        );
        return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [task.id]);
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("provider validation keeps WebM bytes, public media metadata and once-only billing through the original state", async () => {
  const f = await fixture();
  try {
    const path = join(f.directory, "video.webm");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=blue:size=32x24:rate=25",
      "-t",
      "1",
      "-c:v",
      "libvpx-vp9",
      "-threads",
      "1",
      path,
    ]);
    const bytes = await readFile(path);
    const policy = {
      version: 3 as const,
      errors: {
        imageFormat: "图片格式",
        imageDecode: "图片内容",
        video: "视频无效",
        failed: "保存失败",
        recovering: "恢复失败",
      },
    };
    const signal = new AbortController().signal;
    assert.deepEqual(
      await inspectProviderOutput(policy, bytes, "video", false, signal),
      {
        mime: "video/webm",
        width: 32,
        height: 24,
        duration: 1,
        fps: "25/1",
      },
    );
    await assert.rejects(
      inspectProviderOutput(
        policy,
        Buffer.from("invalid"),
        "video",
        true,
        signal,
      ),
      /恢复失败/,
    );
    f.setBytes(bytes);
    for (const model of ["muse-video", "flow:veo-3.1-quality"]) {
      const job = await f.submit(model, "video");
      await f.executor.execute(job.id);
      await f.executor.execute(job.id);
      const row = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
      assert.equal(row.state, "completed");
      const asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
        row.result.assets[0],
      ]);
      assert.equal(asset.mime, "video/webm");
      assert.equal(asset.original_kind, "video");
      assert.deepEqual(await f.p.storage.read(asset.object_key), bytes);
      const task = (await f.state()).jobs.find(
        (j: any) => j.id === Number(job.public_id),
      );
      assert.equal(task.status, "done");
      assert.equal(task.width, 32);
      assert.equal(task.height, 24);
      assert.deepEqual(task.actual, {
        width: 32,
        height: 24,
        duration: 1,
        fps: "25/1",
      });
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM ledger WHERE job_id=$1 AND action='spend'",
            [job.id],
          )
        ).rows.length,
        1,
      );
    }
    assert.deepEqual(f.counts(), { submissions: 2, downloads: 2 });
  } finally {
    await f.cleanup();
  }
});

test("provider image inspection preserves EXIF bytes and dimensions, rejects invalid output and refunds once", async () => {
  const f = await fixture();
  try {
    const bytes = await sharp({
      create: { width: 24, height: 16, channels: 3, background: "blue" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    f.setBytes(bytes);
    const job = await f.submit("muse-image", "image");
    await f.executor.execute(job.id);
    const state = await f.state(),
      task = state.jobs.find((j: any) => j.id === Number(job.public_id)),
      asset = await one(f.db, "SELECT * FROM assets WHERE public_id=$1", [
        task.result,
      ]);
    assert.equal(task.status, "done");
    assert.deepEqual(task.actual, { width: 16, height: 24 });
    assert.equal(
      state.assets.find((a: any) => a.id === task.result).kind,
      "ref",
    );
    assert.deepEqual(await f.p.storage.read(asset.object_key), bytes);
    for (const [value, message] of [
      [await sharp(bytes).gif().toBuffer(), "Muse 返回的图片格式或尺寸无效"],
      [Buffer.from("not an image"), "Muse 成品保存失败，请检查后重新生成"],
    ] as const) {
      f.setBytes(value);
      const failed = await f.submit("muse-image", "image");
      await f.executor.execute(failed.id);
      await f.executor.execute(failed.id);
      const row = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
        failed.id,
      ]);
      assert.equal(row.state, "failed");
      assert.equal(row.error, message);
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM job_assets WHERE job_id=$1 AND role='output'",
            [failed.id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
            [failed.id],
          )
        ).rows.length,
        1,
      );
    }
    const after = await f.state();
    assert.equal(after.credits.balance, 999);
    assert.equal(after.credits.reserved, 0);
    assert.equal(after.reserved, 0);
  } finally {
    await f.cleanup();
  }
});

test("request media validation requires its explicit local ABI; Flow save recovery keeps its original failure text", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.p.registry.install(f.db, {
        ...museArtifacts.manifest,
        artifactValidation: { version: 1 },
      }),
      { status: 400 },
    );
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...museArtifacts.manifest, id: "remote-artifacts" },
        "http://127.0.0.1:9",
      ),
      { status: 400 },
    );
    f.setBytes(Buffer.from("invalid video"));
    const job = await f.submit("flow:veo-3.1-quality", "video"),
      config = f.p.vault.open(job.config_snapshot);
    await f.db.query(
      "UPDATE jobs SET state='finalizing',receipt=$2 WHERE id=$1",
      [
        job.id,
        JSON.stringify({
          state: "completed",
          artifacts: [{ url: config.baseUrl + "/tmp/result" }],
        }),
      ],
    );
    await f.executor.execute(job.id);
    await f.executor.execute(job.id);
    const row = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(row.state, "failed");
    assert.equal(row.error, "Flow 成品保存失败，请从后台检查生成结果");
    assert.deepEqual(f.counts(), { submissions: 0, downloads: 1 });
    await assert.rejects(
      flowArtifacts.validateArtifact!(
        { kind: "video", model: "flow", references: [], params: {} },
        Buffer.from("invalid"),
        {},
        new AbortController().signal,
        async () => {},
      ),
      (error) =>
        error instanceof ArtifactValidationError &&
        error.message === "Flow 返回的视频无法验证或方向异常",
    );
  } finally {
    await f.cleanup();
  }
});

test("image inspection backpressure retains the accepted output and retries without another generation or refund", async () => {
  const f = await fixture(),
    original = imageImporter.inspect;
  try {
    f.setBytes(
      await sharp({
        create: { width: 24, height: 16, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
    );
    const job = await f.submit("muse-image", "image");
    imageImporter.inspect = async () => {
      throw new DomainError(503, "请求处理失败");
    };
    await f.executor.execute(job.id);
    const blocked = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(blocked.state, "finalizing");
    assert.equal(blocked.error, null);
    assert.equal(blocked.lease_token, null);
    assert.ok(blocked.receipt);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
          [job.id],
        )
      ).rows.length,
      0,
    );
    imageImporter.inspect = original;
    await f.executor.execute(job.id);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [job.id])).state,
      "completed",
    );
    assert.deepEqual(f.counts(), { submissions: 1, downloads: 2 });
  } finally {
    imageImporter.inspect = original;
    await f.cleanup();
  }
});
