import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  imagesLifecycleFixture,
  imagesModel,
} from "../helpers/images-lifecycle.js";
import { one } from "../../packages/platform/src/db.js";
import { JobTiming } from "../../packages/platform/src/timing.js";
import {
  imagesLifecycle,
  imageProcessingFailure,
} from "../../plugins/images/src/lifecycle.js";
import { imagesState } from "../../plugins/images/src/state.js";
import { museJson } from "../../plugins/muse/src/json.js";
const row = (
  f: Awaited<ReturnType<typeof imagesLifecycleFixture>>,
  id: string,
) => one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]);
const png = () =>
  sharp({ create: { width: 8, height: 6, channels: 3, background: "blue" } })
    .png()
    .toBuffer();

test("Image plugin saves one original PNG, opaque usage and request ID with an atomic credit settlement", async () => {
  const f = await imagesLifecycleFixture();
  try {
    const bytes = await png();
    f.setWire({
      raw: JSON.stringify({
        data: [{ b64_json: bytes.toString("base64") }],
        usage: null,
      }),
      requestId: "request-fixture",
    });
    const j = await f.create(imagesModel);
    await Promise.all([f.executor.execute(j.id), f.executor.execute(j.id)]);
    const saved = await row(f, j.id),
      a = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
        saved.result.assets[0],
      ]);
    assert.equal(saved.state, "completed");
    assert.equal(saved.receipt, null);
    assert.deepEqual(saved.result.providerResponse, {
      version: 1,
      requestId: "request-fixture",
      usageJson: "null",
    });
    assert.deepEqual(Buffer.from(await f.p.storage.read(a.object_key)), bytes);
    assert.equal(a.original_kind, "ref");
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].idempotency, null);
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT action,amount FROM ledger WHERE job_id=$1 ORDER BY created_at",
          [j.id],
        )
      ).rows.map((x) => [x.action, Number(x.amount)]),
      [
        ["hold", 2],
        ["spend", 2],
      ],
    );
    assert.equal(
      (await new JobTiming(f.p).current(f.db, j.id))?.status,
      "done",
    );
  } finally {
    await f.cleanup();
  }
});

test("Image admission is serial FIFO; disabled service/configuration and missing reference metadata leave the queue untouched", async () => {
  const f = await imagesLifecycleFixture();
  try {
    const first = await f.create(imagesModel),
      second = await f.create(imagesModel);
    assert.equal(await f.executor.claim(second.id), undefined);
    await f.db.query("UPDATE original_state_settings SET image_enabled=false");
    assert.equal(await f.executor.claim(first.id), undefined);
    await f.db.query("UPDATE original_state_settings SET image_enabled=true");
    await f.db.query(
      "UPDATE jobs SET input=jsonb_set(input::jsonb,'{references}',$2::jsonb) WHERE id=$1",
      [first.id, JSON.stringify([randomUUID()])],
    );
    assert.equal(await f.executor.claim(first.id), undefined);
    assert.equal((await row(f, first.id)).attempts, 0);
    assert.equal(await new JobTiming(f.p).current(f.db, first.id), undefined);
    assert.equal(await f.executor.claim(second.id), undefined);
    const ref = await f.reference();
    await f.db.query(
      "UPDATE jobs SET input=jsonb_set(input::jsonb,'{references}',$2::jsonb) WHERE id=$1",
      [first.id, JSON.stringify([ref])],
    );
    await f.db.query("UPDATE jobs SET config_snapshot=$2 WHERE id=$1", [
      first.id,
      f.p.vault.seal({ ...f.config, apiKey: "invalid" }),
    ]);
    assert.equal(await f.executor.claim(first.id), undefined);
    await f.db.query("UPDATE jobs SET config_snapshot=$2 WHERE id=$1", [
      first.id,
      f.p.vault.seal(f.config),
    ]);
    assert.ok(await f.executor.claim(first.id));
    assert.equal(await f.executor.claim(second.id), undefined);
  } finally {
    await f.cleanup();
  }
});

test("Interrupted image execution fails and refunds once, even with an accepted receipt; it never replays generation or saving", async () => {
  const f = await imagesLifecycleFixture();
  try {
    for (const accepted of [false, true]) {
      const j = await f.create(imagesModel);
      await f.executor.claim(j.id);
      if (accepted)
        await f.db.query(
          "UPDATE jobs SET state='finalizing',receipt=$2 WHERE id=$1",
          [
            j.id,
            JSON.stringify({
              state: "completed",
              artifacts: [
                {
                  url:
                    "data:image/png;base64," + (await png()).toString("base64"),
                },
              ],
            }),
          ],
        );
      await f.db.query(
        "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [j.id],
      );
      await f.executor.recover();
      await f.executor.recover();
      await f.executor.execute(j.id);
      const after = await row(f, j.id);
      assert.equal(after.state, "failed");
      assert.equal(
        after.error,
        imagesLifecycle.manifest.requestLifecycle!.notes.unknownSubmission,
      );
      assert.equal(
        (await new JobTiming(f.p).current(f.db, j.id))?.status,
        "interrupted",
      );
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
            [j.id],
          )
        ).rows.length,
        1,
      );
    }
    assert.equal(f.requests.length, 0);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
  } finally {
    await f.cleanup();
  }
});

test("Images distinguish malformed results and transport failure, refund once and do not leak provider details", async () => {
  const f = await imagesLifecycleFixture();
  try {
    for (const [wire, note] of [
      [
        { disconnect: true },
        "与 OpenAI 的连接中断，结果未确认；请检查平台记录后再重新生成",
      ],
      [
        {
          raw: '{"data":[{"url":"https://example.com/private"}]}',
          status: 200,
        },
        "OpenAI 没有返回有效图片",
      ],
      [
        { raw: '{"data":[{"b64_json":"AA==\\n"}]}', status: 200 },
        imageProcessingFailure,
      ],
      [
        { raw: '{"error":{"message":"private sentinel"}}', status: 429 },
        "OpenAI 请求频率受限，请稍后重新生成",
      ],
      [{ raw: '{"error":[]}', status: 401 }, imageProcessingFailure],
    ] as const) {
      f.setWire(wire);
      const j = await f.create(imagesModel);
      await f.executor.execute(j.id);
      await f.executor.recover();
      await f.executor.execute(j.id);
      assert.equal((await row(f, j.id)).error, note);
      assert.equal((await row(f, j.id)).state, "failed");
      assert.equal(
        (await new JobTiming(f.p).current(f.db, j.id))?.status,
        "failed",
      );
    }
    assert.equal(f.requests.length, 5);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 10000);
  } finally {
    await f.cleanup();
  }
});

test("Disabled image owners cancel only while the service is enabled; output storage failures leave no media or spend", async () => {
  const f = await imagesLifecycleFixture();
  try {
    const cancelled = await f.create(imagesModel);
    await f.db.query("UPDATE users SET active=false WHERE id=$1", [f.admin.id]);
    await f.db.query("UPDATE original_state_settings SET image_enabled=false");
    await f.executor.recover();
    assert.equal((await row(f, cancelled.id)).state, "queued");
    await f.db.query("UPDATE original_state_settings SET image_enabled=true");
    await f.executor.recover();
    assert.equal((await row(f, cancelled.id)).state, "cancelled");
    assert.equal((await row(f, cancelled.id)).error, "账户已停用");
    await f.db.query("UPDATE users SET active=true WHERE id=$1", [f.admin.id]);
    f.setWire({
      raw: JSON.stringify({
        data: [{ b64_json: (await png()).toString("base64") }],
      }),
    });
    const j = await f.create(imagesModel),
      put = f.p.storage.put.bind(f.p.storage);
    f.p.storage.put = async () => {
      throw new Error("private sentinel");
    };
    try {
      await f.executor.execute(j.id);
    } finally {
      f.p.storage.put = put;
    }
    assert.equal((await row(f, j.id)).error, imageProcessingFailure);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM job_assets WHERE job_id=$1 AND role='output'",
          [j.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 10000);
  } finally {
    await f.cleanup();
  }
});

test("Images preserve ordered multipart references and Unicode Picture markers without changing existing plugin versions", async () => {
  const f = await imagesLifecycleFixture();
  try {
    const refs = await Promise.all([
      f.reference("image/jpeg"),
      f.reference("image/png"),
      f.reference("image/webp"),
    ]);
    f.setWire({
      raw: JSON.stringify({
        data: [{ b64_json: (await png()).toString("base64") }],
      }),
    });
    const j = await f.create(imagesModel);
    await f.db.query(
      "UPDATE jobs SET input=jsonb_set(jsonb_set(input::jsonb,'{references}',$2::jsonb),'{prompt}',$3::jsonb) WHERE id=$1",
      [
        j.id,
        JSON.stringify(refs),
        JSON.stringify("<Picture ١> <Picture ２> <Picture 3>"),
      ],
    );
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).state, "completed");
    const body = f.requests[0].body;
    assert.ok(body.includes("参考图片١ 参考图片２ 参考图片3"));
    assert.ok(
      body.indexOf("reference-1.jpg") < body.indexOf("reference-2.png"),
    );
    assert.ok(body.includes("reference-3.webp"));
    assert.ok(body.endsWith("--fixture--\r\n"));
    assert.equal(imagesState.manifest.requestLifecycle, undefined);
    assert.equal(imagesState.manifest.version, "1.6.0");
    assert.equal(imagesLifecycle.manifest.version, "1.7.0");
  } finally {
    await f.cleanup();
  }
});

test("Image output and credit settlement roll back together if settlement fails after writing its rows", async () => {
  const f = await imagesLifecycleFixture();
  try {
    f.setWire({
      raw: JSON.stringify({
        data: [{ b64_json: (await png()).toString("base64") }],
      }),
    });
    const j = await f.create(imagesModel),
      settle = f.p.settle.bind(f.p),
      put = f.p.storage.put.bind(f.p.storage),
      keys: string[] = [];
    f.p.storage.put = async (key, bytes, mime) => {
      keys.push(key);
      return put(key, bytes, mime);
    };
    f.p.settle = async (...args) => {
      await settle(...args);
      if (args[2] === "completed")
        throw new Error("injected transaction failure");
    };
    try {
      await f.executor.execute(j.id);
    } finally {
      f.p.settle = settle;
      f.p.storage.put = put;
    }
    assert.equal((await row(f, j.id)).state, "failed");
    assert.equal((await row(f, j.id)).error, imageProcessingFailure);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM job_assets WHERE job_id=$1 AND role='output'",
          [j.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='spend'",
          [j.id],
        )
      ).rows.length,
      0,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 10000);
    assert.equal(keys.length, 1);
    await assert.rejects(() => f.p.storage.read(keys[0]));
  } finally {
    await f.cleanup();
  }
});

test("Image redirects retain the original POST-to-GET rules, and unsupported POST redirects fail without reissuing generation", async () => {
  const f = await imagesLifecycleFixture();
  try {
    for (const status of [301, 302, 303, 307, 308]) {
      f.requests.length = 0;
      f.setWire({
        redirect: status,
        raw: JSON.stringify({
          data: [{ b64_json: (await png()).toString("base64") }],
        }),
      });
      const j = await f.create(imagesModel);
      await f.executor.execute(j.id);
      if (status < 307) {
        assert.equal((await row(f, j.id)).state, "completed");
        assert.deepEqual(
          f.requests.map((r) => r.method),
          ["POST", "GET"],
        );
        assert.equal(f.requests[1].contentType, "");
        assert.equal(f.requests[1].authorization, "Bearer sk-local-fixture");
      } else {
        assert.equal((await row(f, j.id)).state, "failed");
        assert.equal(f.requests.length, 1);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("Python-compatible JSON and strict base64 decoding handle large images and non-finite accounting without regex stack exhaustion", async () => {
  const b64 = Buffer.alloc(32 * 1024 ** 2, 42).toString("base64"),
    raw = Buffer.from(
      '{"data":[{"b64_json":' + JSON.stringify(b64) + '}],"usage":NaN}',
    );
  const parsed = museJson(raw);
  assert.ok(Number.isNaN(parsed.usage));
  assert.equal(parsed.data[0].b64_json, b64);
  const bytes = await imagesLifecycle.downloadArtifact!(
    { url: "data:image/png;base64," + b64, config: {}, recovering: false },
    new AbortController().signal,
  );
  assert.equal(bytes.length, 32 * 1024 ** 2);
  assert.equal(bytes[0], 42);
  assert.deepEqual(
    await imagesLifecycle.downloadArtifact!(
      { url: "data:image/png;base64,AB==", config: {}, recovering: false },
      new AbortController().signal,
    ),
    Buffer.from([0]),
  );
});
