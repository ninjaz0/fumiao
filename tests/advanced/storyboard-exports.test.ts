import { OriginalState } from "../../packages/original-api/src/state.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { canvasesFixture } from "../helpers/canvases.js";
import { databaseFixture } from "../helpers/database.js";
import { migrate, one } from "../../packages/platform/src/db.js";
import { S3Storage } from "../../packages/platform/src/storage.js";
import { OriginalStoryboardExports } from "../../packages/original-api/src/storyboard-exports.js";
import { originalStoryboard } from "../../plugins/storyboard/src/original.js";
import { OriginalMedia } from "../../packages/original-api/src/media.js";
const exec = promisify(execFile);
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
async function fixture() {
  const f = await canvasesFixture();
  const video = await f.asset(randomUUID().replaceAll("-", ""), "video");
  const voice = await f.asset(randomUUID().replaceAll("-", ""), "audio");
  for (const a of [video, voice])
    await f.db.query("UPDATE assets SET object_key=$2 WHERE id=$1", [
      a.id,
      a.id,
    ]);
  const v = join(f.directory, video.id),
    a = join(f.directory, voice.id);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=96x64:r=24:d=0.5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    v + ".mp4",
  ]);
  await exec("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=400:duration=1",
    "-c:a",
    "pcm_s16le",
    a + ".wav",
  ]);
  await writeFile(v, await readFile(v + ".mp4"));
  await writeFile(a, await readFile(a + ".wav"));
  const job = await f.job(900, "audio", "completed", voice.id);
  await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
    job.id,
    JSON.stringify({ prompt: "你好。😀!" }),
  ]);
  const project = await f.canvases.create(f.admin, { title: "成片" });
  const doc = {
    nodes: [
      {
        id: "shot",
        type: "video",
        title: "镜头",
        x: 0,
        y: 0,
        use_media: true,
        media_id: video.public_id,
        narration_job: 900,
        narration_text: "你好。😀!",
      },
    ],
    edges: [],
    shots: ["shot"],
  };
  // Use the raw document authority; submission tests independently cover canvas saves.
  const row = await one(f.db, "SELECT id FROM documents WHERE public_id=$1", [
    project.id,
  ]);
  await f.db.query(
    "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
    [row.id, Buffer.from(JSON.stringify(doc))],
  );
  return {
    ...f,
    video,
    voice,
    project,
    projectId: row.id,
    doc,
    service: new OriginalStoryboardExports(
      f.p,
      undefined,
      undefined,
      f.directory,
    ),
  };
}
test("real local composition: acceptance, UID replay, refs, audio padding, embedded subtitles and one save", async () => {
  const f = await fixture();
  const bucket = process.env.TEST_STORYBOARD_S3_BUCKET;
  const storage = bucket ? new S3Storage(bucket) : undefined;
  const objectKeys: string[] = [];
  try {
    if (storage) {
      assert.ok(process.env.S3_ENDPOINT, "Set an isolated S3 test endpoint");
      for (const asset of [f.video, f.voice]) {
        objectKeys.push(asset.id);
        await storage.putFile(
          asset.id,
          join(f.directory, asset.id),
          asset.mime,
        );
      }
      f.p.storage = storage;
    }
    const uid = randomUUID(),
      request = { uid, expected_revision: 1 };
    const created = await f.service.create(f.admin, f.project.id, request);
    assert.equal(created.state, "queued");
    assert.deepEqual(
      await f.service.create(f.admin, f.project.id, {
        uid,
        expected_revision: 999,
      }),
      created,
    );
    await assert.rejects(
      f.service.create(f.admin, f.project.id, {
        uid: randomUUID(),
        expected_revision: 1,
      }),
      /当前空间已有成片/,
    );
    await assert.rejects(
      new OriginalMedia(f.p).protect(f.db, f.video.id),
      /合成/,
    );
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    await f.service.recover();
    await Promise.all([f.service.execute(row.id), f.service.execute(row.id)]);
    await f.service.execute(row.id);
    const done = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(done.state, "done", done.error);
    const srt = await f.service.subtitles(f.admin, done.id);
    assert.match(srt.body, /你好。/);
    assert.match(srt.body, /😀!/);
    assert.match(
      (await f.service.subtitles(f.admin, done.id, "vtt")).body,
      /^WEBVTT/,
    );
    await assert.rejects(f.service.subtitles(f.member, done.id), /无权访问/);
    const output = await one(f.db, "SELECT * FROM assets WHERE public_id=$1", [
      done.result,
    ]);
    const path = join(f.directory, output.object_key);
    if (storage) {
      objectKeys.push(output.object_key);
      const media = new OriginalMedia(f.p);
      await media.resource(f.db, f.admin, done.result);
      await assert.rejects(
        media.resource(f.db, f.member, done.result),
        /无权访问/,
      );
      const signed = await storage.downloadUrl(output.object_key);
      const unsigned = new URL(signed);
      unsigned.search = "";
      const denied = await fetch(unsigned);
      assert.equal(denied.status, 403);
      await denied.body?.cancel();
      const download = await fetch(signed);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-type"), "video/mp4");
      const bytes = Buffer.from(await download.arrayBuffer());
      assert.equal(bytes.length, Number(output.size));
      await writeFile(path, bytes);
    }
    const info = JSON.parse(
      (
        await exec("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ])
      ).stdout,
    );
    assert.equal(info.streams[0].width, 96);
    assert.equal(info.streams[0].height, 64);
    assert.equal(info.streams[0].r_frame_rate, "24/1");
    assert.equal(info.streams[0].codec_name, "h264");
    assert.ok(
      info.streams.some((s: any) => s.codec_name === "aac" && s.channels === 2),
    );
    assert.ok(info.streams.some((s: any) => s.codec_name === "mov_text"));
    assert.ok(Math.abs(Number(info.format.duration) - 1) < 0.25);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM jobs WHERE plugin_id='original-storyboard'",
          )
        ).n,
      ),
      1,
    );
    assert.equal(
      Number(
        (await one(f.db, "SELECT reserved FROM storage_capacity")).reserved,
      ),
      0,
    );
    await f.db.query(
      "UPDATE jobs SET deleted_at=now() WHERE plugin_id!='original-storyboard' AND state='completed'",
    );
    const history = await new OriginalState(f.p).canvasJobs(
      f.db,
      f.workspace.id,
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].prompt, "镜头合成");
    assert.equal(history[0].model, "storyboard");
    assert.equal(history[0].result, done.result);
    await f.canvases.remove(f.admin, f.project.id);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT project_id FROM storyboard_exports WHERE id=$1",
          [row.id],
        )
      ).project_id,
      null,
    );
    assert.match((await f.service.subtitles(f.admin, done.id)).body, /你好/);
  } finally {
    try {
      if (storage) for (const key of objectKeys) await storage.remove(key);
    } finally {
      storage?.client.destroy();
      await f.cleanup();
    }
  }
});
test("expired lease recovery fails once and releases refs without replay", async () => {
  const f = await fixture();
  try {
    const created = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const token = randomUUID();
    const { id } = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    await f.db.query(
      "UPDATE storyboard_exports SET state='running',lease_token=$2,lease_until=now()-interval '1 second' WHERE public_id=$1",
      [created.id, token],
    );
    await f.db.query(
      "INSERT INTO storyboard_export_objects(export_id,object_key,work_token,write_state) VALUES($1,$2,$3,'unstarted')",
      [id, randomUUID(), token],
    );
    const stage = join(f.directory, "storyboard-" + token);
    await mkdir(stage);
    f.p.storage.remove = async () => assert.fail("A PUT was never started");
    await f.service.recover();
    await f.service.recover();
    assert.equal(
      await one(f.db, "SELECT * FROM storyboard_export_objects"),
      undefined,
    );
    await assert.rejects(stat(stage), { code: "ENOENT" });
    const done = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(done.state, "failed");
    assert.equal(done.error, "服务重启中断了合成，请重新合成");
    assert.equal((await f.service.ready()).length, 0);
    assert.equal(
      Number(
        (await one(f.db, "SELECT count(*) AS n FROM storyboard_export_refs")).n,
      ),
      0,
    );
  } finally {
    await f.cleanup();
  }
});
test("canvas deletion during encoding fences late completion and cleans objects", async () => {
  const f = await fixture();
  try {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const plugin = {
      ...originalStoryboard,
      async compose(...args: Parameters<typeof originalStoryboard.compose>) {
        const result = await originalStoryboard.compose(...args);
        entered();
        await gate;
        return result;
      },
    };
    const service = new OriginalStoryboardExports(
      f.p,
      [plugin],
      undefined,
      f.directory,
    );
    let uploads = 0;
    const put = f.p.storage.putFile!.bind(f.p.storage);
    f.p.storage.putFile = async (...args) => {
      uploads++;
      await put(...args);
    };
    const created = await service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    const executing = service.execute(row.id);
    await started;
    await f.canvases.remove(f.admin, f.project.id);
    release();
    await executing;
    await service.recover();
    const terminal = await one(
      f.db,
      "SELECT * FROM storyboard_exports WHERE id=$1",
      [row.id],
    );
    assert.equal(terminal, undefined);
    assert.equal(
      Number(
        (await one(f.db, "SELECT reserved FROM storage_capacity")).reserved,
      ),
      0,
    );
    assert.equal(uploads, 0);
    assert.equal(
      await one(f.db, "SELECT * FROM storyboard_export_objects"),
      undefined,
    );
  } finally {
    await f.cleanup();
  }
});
test("storage write and late database failures roll back output, history, quota and references", async () => {
  const f = await fixture();
  try {
    for (const fault of ["storage", "database"]) {
      const service = f.service;
      const created = await service.create(f.admin, f.project.id, {
        uid: randomUUID(),
        expected_revision: 1,
      });
      const row = await one(
        f.db,
        "SELECT id FROM storyboard_exports WHERE public_id=$1",
        [created.id],
      );
      const put = f.p.storage.putFile!.bind(f.p.storage);
      const remove = f.p.storage.remove.bind(f.p.storage);
      const tx = f.db.transaction.bind(f.db);
      let objectKey!: string;
      f.p.storage.putFile = async (...args) => {
        objectKey = args[0];
        await put(...args);
        if (fault === "storage") throw new Error("synthetic write failure");
      };
      if (fault === "storage") {
        f.p.storage.remove = async () => {
          throw new Error("synthetic delete failure");
        };
      } else
        f.db.transaction = async (fn) =>
          tx(async (sql) =>
            fn({
              query: async (statement, params) => {
                if (statement.startsWith("INSERT INTO job_assets"))
                  throw new Error("synthetic late database failure");
                return sql.query(statement, params);
              },
            }),
          );
      if (fault === "storage")
        await assert.rejects(
          service.execute(row.id),
          /synthetic delete failure/,
        );
      else await service.execute(row.id);
      f.p.storage.putFile = put;
      f.p.storage.remove = remove;
      f.db.transaction = tx;
      assert.equal(
        (
          await one(f.db, "SELECT state FROM storyboard_exports WHERE id=$1", [
            row.id,
          ])
        ).state,
        "failed",
      );
      assert.equal(
        Number(
          (
            await one(
              f.db,
              "SELECT count(*) AS n FROM jobs WHERE plugin_id='original-storyboard'",
            )
          ).n,
        ),
        0,
      );
      assert.equal(
        Number(
          (await one(f.db, "SELECT reserved FROM storage_capacity")).reserved,
        ),
        0,
      );
      assert.equal(
        Number(
          (await one(f.db, "SELECT count(*) AS n FROM storyboard_export_refs"))
            .n,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await one(
              f.db,
              "SELECT count(*) AS n FROM storyboard_export_objects WHERE committed",
            )
          ).n,
        ),
        0,
      );
      const object = await one(
        f.db,
        "SELECT * FROM storyboard_export_objects WHERE export_id=$1",
        [row.id],
      );
      if (fault === "storage") {
        assert.equal(object.write_state, "uncertain");
        assert.equal(object.cleanup_attempts, 1);
        await service.recover();
        assert.ok((await f.p.storage.stat(objectKey)).size > 0);
        await f.db.query(
          "UPDATE storyboard_export_objects SET cleanup_after=now() WHERE export_id=$1",
          [row.id],
        );
        await service.recover();
        assert.equal(
          (
            await one(
              f.db,
              "SELECT write_state FROM storyboard_export_objects WHERE export_id=$1",
              [row.id],
            )
          ).write_state,
          "uncertain",
        );
      } else assert.equal(object, undefined);
      await assert.rejects(f.p.storage.stat(objectKey), {
        code: "ENOENT",
      });
    }
  } finally {
    await f.cleanup();
  }
});
test("late PUT after lease recovery is swept again and its acknowledgement retires the marker", async () => {
  const f = await fixture();
  try {
    const remove = f.p.storage.remove.bind(f.p.storage);
    for (const acknowledge of [false, true]) {
      const created = await f.service.create(f.admin, f.project.id, {
        uid: randomUUID(),
        expected_revision: 1,
      });
      const { id } = await one(
        f.db,
        "SELECT id FROM storyboard_exports WHERE public_id=$1",
        [created.id],
      );
      const started = deferred<string>();
      const response = deferred();
      const deleted = deferred();
      const finishSweep = deferred();
      if (acknowledge) {
        f.p.storage.remove = async (...args) => {
          await remove(...args);
          deleted.resolve();
          await finishSweep.promise;
        };
      }
      f.p.storage.putFile = async (key, path, mime) => {
        const bytes = await readFile(path);
        started.resolve(key);
        await response.promise;
        await f.p.storage.put(key, bytes, mime);
        if (!acknowledge) throw new Error("lost PUT acknowledgement");
      };
      const execution = f.service.execute(id);
      let key: string;
      let sweep: Promise<void> | undefined;
      try {
        key = await Promise.race([
          started.promise,
          execution.then(() => {
            throw new Error("No PUT was attempted");
          }),
        ]);
        await f.db.query(
          "UPDATE storyboard_exports SET lease_until=now()-interval '1 second' WHERE id=$1",
          [id],
        );
        sweep = f.service.recover();
        if (acknowledge) {
          await Promise.race([
            deleted.promise,
            sweep.then(() => {
              throw new Error("No provisional DELETE was attempted");
            }),
          ]);
        } else await sweep;
        const marker = await one(
          f.db,
          "SELECT * FROM storyboard_export_objects WHERE export_id=$1",
          [id],
        );
        assert.equal(marker.write_state, "uncertain");
        if (acknowledge) assert.ok(marker.cleanup_token);
        else assert.equal(marker.cleanup_attempts, 1);
        await assert.rejects(f.p.storage.stat(key), { code: "ENOENT" });
      } finally {
        response.resolve();
        try {
          await execution;
        } finally {
          finishSweep.resolve();
          await sweep;
          f.p.storage.remove = remove;
        }
      }
      const marker = await one(
        f.db,
        "SELECT * FROM storyboard_export_objects WHERE export_id=$1",
        [id],
      );
      if (acknowledge) {
        assert.equal(marker.write_state, "settled");
        assert.ok((await f.p.storage.stat(key)).size > 0);
        await f.service.recover();
        assert.equal(
          await one(
            f.db,
            "SELECT export_id FROM storyboard_export_objects WHERE export_id=$1",
            [id],
          ),
          undefined,
        );
      } else {
        assert.equal(marker.write_state, "uncertain");
        assert.ok((await f.p.storage.stat(key)).size > 0);
        await f.service.recover();
        assert.ok((await f.p.storage.stat(key)).size > 0);
        await f.db.query(
          "UPDATE storyboard_export_objects SET cleanup_after=now() WHERE export_id=$1",
          [id],
        );
        await f.service.recover();
      }
      await assert.rejects(f.p.storage.stat(key), { code: "ENOENT" });
      assert.equal(
        (
          await one(f.db, "SELECT state FROM storyboard_exports WHERE id=$1", [
            id,
          ])
        ).state,
        "failed",
      );
      assert.equal(
        await one(
          f.db,
          "SELECT id FROM jobs WHERE plugin_id='original-storyboard'",
        ),
        undefined,
      );
    }
  } finally {
    await f.cleanup();
  }
});
test("cleanup claims bound each batch and let other workers make progress during an item failure", async () => {
  const f = await databaseFixture();
  const blocked = deferred();
  const release = deferred();
  let firstSweep: Promise<void> | undefined;
  try {
    const workers = Array.from(
      { length: 2 },
      () =>
        new OriginalStoryboardExports(f.p, undefined, undefined, f.directory),
    );
    const keys = Array.from({ length: 18 }, () => randomUUID());
    for (const [index, key] of keys.entries()) {
      await f.p.storage.put(key, Buffer.from("orphan"), "video/mp4");
      await f.db.query(
        `INSERT INTO storyboard_export_objects(export_id,object_key,work_token,write_state,cleanup_after)
         VALUES($1::uuid,$1::uuid::text,$2,'settled',now()-$3*interval '1 second')`,
        [key, randomUUID(), keys.length - index],
      );
    }
    const remove = f.p.storage.remove.bind(f.p.storage);
    const calls: string[] = [];
    let fail = true;
    f.p.storage.remove = async (key) => {
      calls.push(key);
      if (key === keys[0] && fail) {
        blocked.resolve();
        await release.promise;
        throw new Error("bad object");
      }
      await remove(key);
    };
    firstSweep = workers[0].cleanupObjects();
    await Promise.race([
      blocked.promise,
      firstSweep.then(() => {
        throw new Error("Oldest item was skipped");
      }),
    ]);
    assert.equal(calls.length, 16);
    assert.deepEqual(new Set(calls), new Set(keys.slice(0, 16)));
    await workers[1].cleanupObjects();
    assert.equal(calls.length, keys.length);
    assert.deepEqual(new Set(calls), new Set(keys));
    release.resolve();
    await assert.rejects(firstSweep, /bad object/);
    const { rows } = await f.db.query(
      "SELECT * FROM storyboard_export_objects",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].object_key, keys[0]);
    assert.equal(rows[0].cleanup_attempts, 1);
    assert.equal(rows[0].cleanup_token, null);
    await workers[1].cleanupObjects();
    assert.equal(calls.length, keys.length);
    fail = false;
    await f.db.query(
      "UPDATE storyboard_export_objects SET cleanup_after=now()",
    );
    await workers[1].cleanupObjects();
    assert.equal(calls.length, keys.length + 1);
    assert.equal(
      await one(f.db, "SELECT * FROM storyboard_export_objects"),
      undefined,
    );
  } finally {
    release.resolve();
    await firstSweep?.catch(() => {});
    await f.cleanup();
  }
});
test("a cleanup claim with lost acknowledgement becomes available to a replacement worker", async () => {
  const f = await databaseFixture("025_storyboard_execution.sql");
  try {
    const key = randomUUID();
    await f.p.storage.put(key, Buffer.from("orphan"), "video/mp4");
    await f.db.query(
      "INSERT INTO storyboard_export_objects VALUES($1::uuid,$1::uuid::text,$2,false)",
      [key, randomUUID()],
    );
    await migrate(f.db);
    const worker = new OriginalStoryboardExports(
      f.p,
      undefined,
      undefined,
      f.directory,
    );
    const query = f.db.query.bind(f.db);
    f.db.query = async <T extends Record<string, any>>(
      statement: string,
      params?: any[],
    ) => {
      const result = await query<T>(statement, params);
      if (statement.startsWith("WITH due AS"))
        throw new Error("lost cleanup claim acknowledgement");
      return result;
    };
    await assert.rejects(
      worker.cleanupObjects(),
      /lost cleanup claim acknowledgement/,
    );
    f.db.query = query;
    const marker = await one(f.db, "SELECT * FROM storyboard_export_objects");
    assert.equal(marker.write_state, "uncertain");
    assert.ok(marker.cleanup_token);
    const replacement = new OriginalStoryboardExports(
      f.p,
      undefined,
      undefined,
      f.directory,
    );
    await replacement.cleanupObjects();
    assert.ok((await f.p.storage.stat(key)).size > 0);
    await f.db.query(
      "UPDATE storyboard_export_objects SET cleanup_after=now()",
    );
    await replacement.cleanupObjects();
    await assert.rejects(f.p.storage.stat(key), { code: "ENOENT" });
    const recovered = await one(
      f.db,
      "SELECT * FROM storyboard_export_objects",
    );
    assert.equal(recovered.write_state, "uncertain");
    assert.equal(recovered.cleanup_token, null);
    assert.equal(recovered.cleanup_attempts, 1);
  } finally {
    await f.cleanup();
  }
});
test(
  "PostgreSQL concurrent acceptance and BullMQ automatic dispatch retry save only once",
  { skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL },
  async () => {
    const f = await fixture();
    const { StoryboardQueue } =
      await import("../../packages/original-api/src/storyboard-queue.js");
    const url = new URL(process.env.TEST_REDIS_URL!);
    const errors: unknown[] = [];
    const queue = new StoryboardQueue(
      f.service,
      {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username || undefined,
        password: url.password || undefined,
        db: Number(url.pathname.slice(1) || 0),
      },
      "test-storyboard-" + randomUUID(),
      (error) => errors.push(error),
    );
    try {
      const uid = randomUUID();
      const requests = await Promise.all(
        Array.from({ length: 4 }, () =>
          f.service.create(f.admin, f.project.id, {
            uid,
            expected_revision: 1,
          }),
        ),
      );
      assert.equal(new Set(requests.map((r) => r.id)).size, 1);
      const add = queue.queue.add.bind(queue.queue);
      const enqueueError = new Error("isolated dispatch failure");
      const cleanupError = new Error("isolated object cleanup failure");
      queue.queue.add = async () => {
        throw enqueueError;
      };
      f.service.cleanupObjects = async () => {
        throw cleanupError;
      };
      await queue.start();
      assert.deepEqual(errors, [enqueueError]);
      assert.equal((await f.service.ready()).length, 1);
      queue.queue.add = add;
      const deadline = Date.now() + 20000;
      let done: any;
      while (Date.now() < deadline) {
        done = (await f.service.list(f.admin, f.project.id)).exports[0];
        if (done.state === "done" || done.state === "failed") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(done.state, "done", done.error);
      assert.ok(errors.includes(cleanupError));
      assert.equal((await f.service.ready()).length, 0);
      assert.equal(
        Number(
          (
            await one(
              f.db,
              "SELECT count(*) AS n FROM jobs WHERE plugin_id='original-storyboard'",
            )
          ).n,
        ),
        1,
      );
    } finally {
      await queue.worker.pause();
      await queue.queue.obliterate({ force: true });
      await queue.close();
      await f.cleanup();
    }
  },
);
test("pinned original function differential: rejection order and real composition/subtitles", async () => {
  const f = await fixture();
  try {
    const oracle = JSON.parse(
      (
        await exec(process.env.STUDIO_PYTHON || "python3", [
          "scripts/storyboard-export-fixtures.py",
          join(f.directory, f.video.id),
          join(f.directory, f.voice.id),
        ])
      ).stdout,
    );
    const cases: any[] = [];
    async function attempt(doc: any, revision = 1) {
      await f.db.query(
        "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
        [f.projectId, Buffer.from(JSON.stringify(doc))],
      );
      try {
        await f.service.create(f.admin, f.project.id, {
          uid: randomUUID(),
          expected_revision: revision,
        });
        cases.push({ status: 200 });
      } catch (e: any) {
        cases.push({ status: e.status, error: e.message });
      }
    }
    const node = { ...f.doc.nodes[0], narration_job: null, narration_text: "" };
    const doc = (n: any = node) => ({ nodes: [n], edges: [], shots: ["shot"] });
    await attempt(doc(), 2);
    await attempt({ nodes: [], edges: [], shots: [] });
    await attempt(doc({ ...node, media_id: null }));
    await attempt(doc({ ...node, narration_text: "旁白" }));
    assert.deepEqual(cases, oracle.cases);
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [f.projectId, Buffer.from(JSON.stringify(f.doc))],
    );
    const created = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    await f.service.execute(
      (
        await one(
          f.db,
          "SELECT id FROM storyboard_exports WHERE public_id=$1",
          [created.id],
        )
      ).id,
    );
    const result = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(result.state, "done", result.error);
    assert.equal(
      (await f.service.subtitles(f.admin, result.id)).body,
      oracle.srt,
    );
    const a = await one(
      f.db,
      "SELECT metadata FROM assets WHERE public_id=$1",
      [result.result],
    );
    assert.deepEqual([a.metadata.width, a.metadata.height], oracle.size);
    assert.equal(a.metadata.duration, oracle.seconds);
  } finally {
    await f.cleanup();
  }
});
test("acceptance retains permission, revision, readiness, narration, UID, global queue and quota error order", async () => {
  const f = await fixture();
  try {
    const request = () => ({ uid: randomUUID(), expected_revision: 1 });
    const setDoc = async (doc: any) =>
      f.db.query(
        "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
        [f.projectId, Buffer.from(JSON.stringify(doc))],
      );
    await assert.rejects(
      f.service.create(f.member, f.project.id, request()),
      /无权访问/,
    );
    const unavailable = new OriginalStoryboardExports(f.p, [
      { ...originalStoryboard, health: async () => false },
    ]);
    await assert.rejects(
      unavailable.create(f.member, f.project.id, request()),
      /成片合成服务尚未配置/,
    );
    await f.db.query("UPDATE jobs SET state='queued' WHERE public_id=900");
    await setDoc({
      ...f.doc,
      nodes: [{ ...f.doc.nodes[0], narration_pending: 900 }],
    });
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request()),
      /新旁白仍在生成/,
    );
    await setDoc(f.doc);
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request()),
      /旁白尚未就绪/,
    );
    await f.db.query(
      "UPDATE jobs SET state='completed',input=$1 WHERE public_id=900",
      [JSON.stringify({ prompt: "修改" })],
    );
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request()),
      /旁白文字已修改/,
    );
    await f.db.query("UPDATE jobs SET input=$1 WHERE public_id=900", [
      JSON.stringify({ prompt: "你好。😀!" }),
    ]);
    await f.db.query("UPDATE storage_capacity SET quota=1");
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request()),
      /空间不足/,
    );
    await f.db.query("UPDATE storage_capacity SET quota=20000000000");
    const available = f.service.availableStageBytes.bind(f.service);
    f.service.availableStageBytes = async () => 1;
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request()),
      /合成空间不足/,
    );
    f.service.availableStageBytes = available;
    const accepted = await f.service.create(f.admin, f.project.id, request());
    const other = await f.canvases.create(f.admin, { title: "other" });
    const old = await one(
      f.db,
      "SELECT uid FROM storyboard_exports WHERE public_id=$1",
      [accepted.id],
    );
    await assert.rejects(
      f.service.create(f.admin, other.id, {
        uid: old.uid,
        expected_revision: 1,
      }),
      /提交编号已使用/,
    );
    await f.db.query("UPDATE storyboard_exports SET state='failed'");
    await f.db.query("DELETE FROM storyboard_export_refs");
    for (let i = 0; i < 10; i++) {
      const wid = randomUUID(),
        id = randomUUID();
      await f.db.query(
        "INSERT INTO workspaces(id,name,kind,owner_id) VALUES($1,$2,'team',$3)",
        [wid, "queue-" + i, f.admin.id],
      );
      await f.db.query(
        "INSERT INTO storyboard_exports(id,public_id,uid,owner_id,workspace_id,revision,snapshot,state,subtitles,error,created,updated) VALUES($1,$2,$3,$4,$5,1,$6,'queued',$6,$6,1,1)",
        [
          id,
          id.replaceAll("-", ""),
          randomUUID(),
          f.admin.id,
          wid,
          Buffer.from(""),
        ],
      );
    }
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request()),
      /合成队列已满/,
    );
  } finally {
    await f.cleanup();
  }
});
test("lost commit acknowledgement retains the saved object and does not replay", async () => {
  const f = await fixture();
  try {
    const created = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [created.id],
    );
    const tx = f.db.transaction.bind(f.db);
    let lostAcknowledgement = false;
    f.db.transaction = async (fn) => {
      let committed = false;
      const result = await tx(async (sql) => {
        const value = await fn(sql);
        committed = !!(await one(
          sql,
          "SELECT 1 FROM storyboard_export_objects WHERE export_id=$1 AND committed",
          [row.id],
        ));
        return value;
      });
      if (committed) {
        lostAcknowledgement = true;
        throw new Error("lost commit acknowledgement");
      }
      return result;
    };
    f.p.storage.remove = async () =>
      assert.fail("Committed object was deleted");
    await f.service.execute(row.id);
    f.db.transaction = tx;
    assert.ok(lostAcknowledgement);
    const done = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(done.state, "done", done.error);
    const asset = await one(
      f.db,
      "SELECT object_key FROM assets WHERE public_id=$1",
      [done.result],
    );
    assert.ok((await f.p.storage.stat(asset.object_key)).size > 0);
    await f.service.recover();
    await f.service.execute(row.id);
    assert.equal(
      await one(f.db, "SELECT * FROM storyboard_export_objects"),
      undefined,
    );
    assert.ok((await f.p.storage.stat(asset.object_key)).size > 0);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM jobs WHERE plugin_id='original-storyboard'",
          )
        ).n,
      ),
      1,
    );
  } finally {
    await f.cleanup();
  }
});
test("real corrupt input fails with original decoder message and releases capacity", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.directory, f.video.id), "invalid local video");
    f.p.storage.remove = async () =>
      assert.fail("Encoding failed before upload");
    const accepted = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [accepted.id],
    );
    await f.service.execute(row.id);
    const failed = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(failed.error, "素材解码或合成失败，请检查视频和音轨后重试");
    assert.equal(failed.state, "failed");
    await f.service.recover();
    await f.service.recover();
    assert.equal(
      await one(f.db, "SELECT * FROM storyboard_export_objects"),
      undefined,
    );
    assert.equal(
      Number(
        (await one(f.db, "SELECT reserved FROM storage_capacity")).reserved,
      ),
      0,
    );
  } finally {
    await f.cleanup();
  }
});
test("expired encoder cannot save late or replay after recovery", async () => {
  const f = await fixture();
  try {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const plugin = {
      ...originalStoryboard,
      async compose(...args: Parameters<typeof originalStoryboard.compose>) {
        const result = await originalStoryboard.compose(...args);
        entered();
        await gate;
        return result;
      },
    };
    const service = new OriginalStoryboardExports(f.p, [plugin]);
    const accepted = await service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    const row = await one(
      f.db,
      "SELECT id FROM storyboard_exports WHERE public_id=$1",
      [accepted.id],
    );
    const execution = service.execute(row.id);
    await started;
    await f.db.query(
      "UPDATE storyboard_exports SET lease_until=now()-interval '1 second' WHERE id=$1",
      [row.id],
    );
    await service.recover();
    release();
    await execution;
    await service.execute(row.id);
    await service.recover();
    const failed = (await service.list(f.admin, f.project.id)).exports[0];
    assert.equal(failed.state, "failed");
    assert.equal(failed.error, "服务重启中断了合成，请重新合成");
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM jobs WHERE plugin_id='original-storyboard'",
          )
        ).n,
      ),
      0,
    );
  } finally {
    await f.cleanup();
  }
});
test("fractional ffprobe duration retains 124 frames without an extra silent frame", async () => {
  const f = await fixture();
  try {
    const path = join(f.directory, "fractional.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=96x64:r=24:d=6",
      "-frames:v",
      "124",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
    await writeFile(join(f.directory, f.video.id), await readFile(path));
    const doc = {
      ...f.doc,
      nodes: [{ ...f.doc.nodes[0], narration_job: null, narration_text: "" }],
    };
    await f.db.query(
      "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
      [f.projectId, Buffer.from(JSON.stringify(doc))],
    );
    const accepted = await f.service.create(f.admin, f.project.id, {
      uid: randomUUID(),
      expected_revision: 1,
    });
    await f.service.execute(
      (
        await one(
          f.db,
          "SELECT id FROM storyboard_exports WHERE public_id=$1",
          [accepted.id],
        )
      ).id,
    );
    const done = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(done.state, "done", done.error);
    const asset = await one(
      f.db,
      "SELECT object_key FROM assets WHERE public_id=$1",
      [done.result],
    );
    const info = JSON.parse(
      (
        await exec("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          join(f.directory, asset.object_key),
        ])
      ).stdout,
    );
    assert.equal(
      Number(info.streams.find((s: any) => s.codec_type === "video").nb_frames),
      124,
    );
    assert.ok(
      info.streams.some(
        (s: any) => s.codec_type === "audio" && s.channels === 2,
      ),
    );
    assert.equal((await f.service.subtitles(f.admin, done.id)).body, "");
  } finally {
    await f.cleanup();
  }
});
