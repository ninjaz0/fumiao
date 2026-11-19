import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import sharp from "sharp";
import { timingFixture } from "../helpers/timing.js";
import { one } from "../../packages/platform/src/db.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { JobTiming } from "../../packages/platform/src/timing.js";
import { museDownload } from "../../plugins/muse/src/download.js";
import { museState } from "../../plugins/muse/src/state.js";
import { flowDownload } from "../../plugins/flow/src/download.js";
import { flowArtifactSource } from "../../plugins/flow/src/download.js";
import {
  ArtifactDownloadError,
  fetchArtifact,
  type ProviderPlugin,
} from "../../packages/plugin-sdk/src/index.js";

const fixturePlugin = (plugin: ProviderPlugin): ProviderPlugin => ({
  ...plugin,
  manifest: {
    ...plugin.manifest,
    id: "download-" + plugin.manifest.id,
    configSchema: { type: "object" },
    models: plugin.manifest.models
      .filter((m) => m.kind === "image")
      .slice(0, 1)
      .map(({ studio, ...m }) => ({ ...m, hidden: false })),
  },
  requestCapacity: () => null,
});
const png = () =>
  sharp({ create: { width: 12, height: 18, channels: 3, background: "green" } })
    .png()
    .toBuffer();

test("Muse downloads authenticated private media and resumes only its saved receipt after an outage", async () => {
  let posts = 0,
    downloads = 0;
  const bytes = await png(),
    seen: string[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer local-fixture");
    seen.push(req.url!);
    if (req.method === "POST") {
      posts++;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "completed",
          url: "https://backend.nvmes.com/muse/v1/media/result.png",
        }),
      );
    } else {
      downloads++;
      assert.equal(req.url, "/backend/v1/media/result.png");
      res.writeHead(downloads === 1 ? 503 : 200, {
        "Content-Type": "image/png",
      });
      res.end(downloads === 1 ? "private-upstream-error" : bytes);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const f = await timingFixture(fixturePlugin(museDownload));
  try {
    await f.p.updateConnection(f.admin, f.connections["download-muse"], {
      revision: 2,
      enabled: true,
      concurrency: 1,
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}/backend`,
        apiKey: "local-fixture",
      },
    });
    const job = await f.create("muse-image"),
      executor = new Executor(f.p),
      timing = new JobTiming(f.p);
    await executor.execute(job.id);
    let current = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(current.state, "finalizing");
    assert.equal(current.lease_token, null);
    assert.equal(current.error, null);
    assert.ok(current.receipt);
    const before = await timing.current(f.db, job.id);
    assert.equal(before?.status, "running");
    assert.equal(before?.phase, "finalizing");
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT held FROM wallets WHERE workspace_id=$1", [
            f.wid,
          ])
        ).held,
      ),
      2,
    );
    await executor.execute(job.id);
    await executor.execute(job.id);
    current = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(current.state, "completed");
    assert.equal(posts, 1);
    assert.equal(downloads, 2);
    assert.equal(current.attempts, 1);
    assert.equal((await timing.current(f.db, job.id))?.id, before?.id);
    const asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
      current.result.assets[0],
    ]);
    assert.equal(asset.original_kind, "ref");
    assert.deepEqual(await f.p.storage.read(asset.object_key), bytes);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='spend'",
          [job.id],
        )
      ).rows.length,
      1,
    );
    assert.deepEqual(seen, [
      "/backend/v1/images/tasks",
      "/backend/v1/media/result.png",
      "/backend/v1/media/result.png",
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});

test("Flow cache download failures are terminal once; credentials never accompany Google media URLs", async () => {
  let downloads = 0;
  const server = createServer((req, res) => {
    downloads++;
    assert.equal(req.url, "/tmp/result.png");
    assert.equal(req.headers.authorization, "Bearer local-fixture");
    res.writeHead(503);
    res.end("private-provider-diagnostic");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const plugin = fixturePlugin(flowDownload);
  let submissions = 0;
  plugin.submit = async () => {
    submissions++;
    return {
      state: "completed",
      artifacts: [{ url: "https://backend.nvmes.com/flow/tmp/result.png" }],
    };
  };
  const f = await timingFixture(plugin);
  try {
    await f.p.updateConnection(f.admin, f.connections["download-flow"], {
      revision: 2,
      enabled: true,
      concurrency: 1,
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "local-fixture",
      },
    });
    const job = await f.create(plugin.manifest.models[0].id),
      executor = new Executor(f.p);
    await executor.execute(job.id);
    await executor.execute(job.id);
    const current = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(current.state, "failed");
    assert.equal(current.error, "Flow 生成或保存失败，请从后台检查结果后重试");
    assert.equal(submissions, 1);
    assert.equal(downloads, 1);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
          [job.id],
        )
      ).rows.length,
      1,
    );
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
    const recovering = await f.create(plugin.manifest.models[0].id);
    await f.db.query(
      "UPDATE jobs SET state='finalizing',receipt=$2 WHERE id=$1",
      [
        recovering.id,
        JSON.stringify({
          state: "completed",
          artifacts: [{ url: "https://evil.example/result.png" }],
        }),
      ],
    );
    await executor.execute(recovering.id);
    await executor.execute(recovering.id);
    const recovered = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
      recovering.id,
    ]);
    assert.equal(recovered.state, "failed");
    assert.equal(recovered.error, "Flow 成品保存失败，请从后台检查生成结果");
    assert.equal(submissions, 1);
    assert.equal(downloads, 1);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
          [recovering.id],
        )
      ).rows.length,
      1,
    );
    const config = { baseUrl: "http://127.0.0.1:9", apiKey: "local-fixture" };
    for (const host of [
      "flow-content.google",
      "storage.googleapis.com",
      "random.googleusercontent.com",
    ])
      assert.deepEqual(
        flowArtifactSource(`https://${host}/asset.mp4?signature=fake`, config)
          .headers,
        {},
      );
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...plugin.manifest, id: "remote-download" },
        "http://127.0.0.1:9",
      ),
      { status: 400 },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});

test("download bounds and redirect rejection stop reads; older Muse versions retain their transport", async () => {
  let redirected = 0;
  const bytes = await png();
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/destination" });
      res.end();
    } else if (req.url === "/destination") {
      redirected++;
      res.end("should not be fetched");
    } else {
      assert.equal(req.headers.authorization, undefined);
      res.end(req.url === "/old.png" ? bytes : "123456789");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const f = await timingFixture(fixturePlugin(museState));
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`,
      options = {
        signal: new AbortController().signal,
        timeout: 1000,
        maxBytes: 8,
        oversized: "size-contract",
      };
    await assert.rejects(
      fetchArtifact(base + "/large", {}, options),
      (error) =>
        error instanceof ArtifactDownloadError &&
        error.disposition === "failed" &&
        error.message === "size-contract",
    );
    await assert.rejects(fetchArtifact(base + "/redirect", {}, options));
    assert.equal(redirected, 0);
    await f.p.updateConnection(f.admin, f.connections["download-muse"], {
      revision: 2,
      enabled: true,
      concurrency: 1,
      config: { baseUrl: base, apiKey: "local-fixture" },
    });
    const job = await f.create("muse-image");
    // Resume an older task's accepted receipt through its original transport.
    await f.db.query(
      "UPDATE jobs SET state='finalizing',receipt=$2 WHERE id=$1",
      [
        job.id,
        JSON.stringify({
          state: "completed",
          artifacts: [{ url: base + "/old.png" }],
        }),
      ],
    );
    await new Executor(f.p).execute(job.id);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [job.id])).state,
      "completed",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});
