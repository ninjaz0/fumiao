import { OriginalState } from "@fumiao/original-api/state.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { canvasesFixture } from "../helpers/canvases.js";
import { databaseFixture } from "../helpers/database.js";
import { migrate, one } from "@fumiao/platform/db.js";
import { S3Storage } from "@fumiao/platform/storage.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { originalStoryboard } from "@fumiao/platform/composition/renderer.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { ensureBuiltinEdgeTts } from "@fumiao/platform/tts/edge-plugin.js";
import { directorAdoptionBasis, type DirectorProduction } from "@fumiao/web-compat/director.js";
import { OriginalIdentity, type OriginalActor } from "@fumiao/original-api/identity.js";
const exec = promisify(execFile);
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
async function fixture() {
  const f = await canvasesFixture();
  await f.db.query(
    "INSERT INTO studio_packages(id,version,enabled) VALUES('storyboard','1.0.0',true) ON CONFLICT DO NOTHING",
  );
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
async function setCanvas(f: Awaited<ReturnType<typeof fixture>>, doc: unknown) {
  await f.db.query(
    "UPDATE canvas_documents SET document=$2 WHERE project_id=$1",
    [f.projectId, Buffer.from(JSON.stringify(doc))],
  );
}
function episode(shotIds: string[], globalOrder = shotIds) {
  const order = globalOrder.filter((id) => shotIds.includes(id));
  return {
    script_id: "c".repeat(32),
    script_revision: 1,
    shot_ids: shotIds,
    order_basis: createHash("sha256").update(JSON.stringify(order)).digest("hex"),
  };
}
async function deployStoryboardExporter(
  f: Awaited<ReturnType<typeof fixture>>,
  version: string,
  declaration: { outputKind: string; mime: string; program: string },
) {
  await f.db.query(
    `INSERT INTO studio_package_releases(id,version,package)
     SELECT id,$1,jsonb_set(
       jsonb_set(package,'{version}',to_jsonb($1::text)),
       '{contributes,exporters}',$2::jsonb
     )
     FROM studio_package_releases WHERE id='storyboard' AND version='1.0.0'`,
    [version, JSON.stringify([{ id: "mp4", title: "MP4", ...declaration }])],
  );
  await f.db.query("UPDATE studio_packages SET version=$1 WHERE id='storyboard'", [version]);
}
test("episode export freezes adopted shots in canvas order", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    const imported = f.video;
    const adopted = await f.asset("a".repeat(32), "video");
    const trial = await f.asset("b".repeat(32), "video");
    await f.job(800, "audio", "running");
    await f.job(901, "video", "completed", adopted.id);
    await f.job(902, "video", "completed", trial.id);
    await f.link(f.project.id, "s1", 901);
    await f.link(f.project.id, "s1", 902);
    await f.link(f.project.id, "dialogue:s1:line", 900);

    const s1 = {
      id: "s1",
      type: "video",
      title: "对白",
      x: 0,
      y: 0,
      active_job: 901,
      media_id: trial.public_id,
      narration_text: "不用旁白",
      tail_inherited: true,
      dialogue_lines: [
        { id: "line", speaker: "林默", text: "你好。😀!", audio_job: 900 },
      ],
    };
    const s2 = {
      id: "s2",
      type: "video",
      title: "原声",
      x: 0,
      y: 0,
      use_media: true,
      media_id: imported.public_id,
      audio_strategy: "keep_original",
      narration_text: "文字可保留",
      dialogue_lines: [{ id: "line", text: "保留原声", audio_pending: 800 }],
    };
    const trialNode = {
      id: "trial",
      type: "video",
      x: 0,
      y: 0,
      use_media: true,
      media_id: trial.public_id,
    };
    const shots = ["s2", "trial", "s1"];
    const director = episode(["s1", "s2"], shots);
    const doc = await confirmEpisodeAdoptions(f, { nodes: [s1, s2, trialNode], shots, director });
    const request = {
      uid: randomUUID(),
      expected_revision: 1,
      scope: "episode" as const,
    };
    const create = () => f.service.create(f.admin, f.project.id, request);
    await setCanvas(f, {
      ...doc,
      nodes: [{ ...s1, active_job: null }, s2, trialNode],
    });
    await assert.rejects(create(), { status: 409, message: /采用/ });
    await setCanvas(f, {
      ...doc,
      nodes: [{ ...s1, active_job: 999 }, s2, trialNode],
    });
    await assert.rejects(create(), { status: 409, message: /尚未就绪/ });
    await setCanvas(f, { ...doc, shots: ["s1", "trial", "s2"] });
    await assert.rejects(create(), { status: 409, message: /顺序/ });
    await setCanvas(f, {
      ...doc,
      nodes: [
        { ...s1, dialogue_lines: [{ id: "line", text: "待配音" }] },
        s2,
        trialNode,
      ],
    });
    await assert.rejects(create(), { status: 409, message: /对白尚未生成/ });
    await setCanvas(f, {
      ...doc,
      nodes: [{ ...s1, dialogue_lines: [{ ...s1.dialogue_lines[0], speaker: "换成其他角色", audio_stale: [900] }] }, s2, trialNode],
    });
    await assert.rejects(create(), { status: 409, message: /对白台词已修改.*重新生成/ });
    await setCanvas(f, doc);
    await assert.rejects(f.service.create(f.member, f.project.id, request), {
      status: 404,
    });
    await assert.rejects(
      f.service.create(f.admin, f.project.id, { ...request, exporter: "storyboard/fcp" }),
      { status: 400, message: /MP4/ },
    );
    await deployStoryboardExporter(f, "2.0.0", {
      outputKind: "composition",
      mime: "video/mp4",
      program: "({plan:()=>[{index:1,narration:false,subtitles:false}]})",
    });
    const accepted = await create();
    assert.equal(accepted.scope, "episode");
    assert.deepEqual(await create(), accepted);
    await assert.rejects(
      f.service.create(f.admin, f.project.id, {
        uid: request.uid,
        expected_revision: 1,
      }),
      { status: 409, message: /提交编号/ },
    );
    const row = await one(
      f.db,
      "SELECT snapshot,exporter_version FROM storyboard_exports WHERE public_id=$1",
      [accepted.id],
    );
    assert.equal(row.exporter_version, "2.0.0");
    assert.deepEqual(JSON.parse(Buffer.from(row.snapshot).toString("utf8")), [
      {
        node: "s2",
        title: "原声",
        video: imported.public_id,
        voice: null,
        text: "",
        audioStrategy: "keep_original",
      },
      {
        node: "s1",
        title: "对白",
        video: adopted.public_id,
        voice: null,
        text: "",
        dialogue: [{ voice: f.voice.public_id, speaker: "林默", text: "你好。😀!" }],
      },
    ]);
    await setCanvas(f, { ...doc, director: { ...director, shot_ids: ["s2"] } });
    assert.deepEqual(await create(), accepted);
    assert.deepEqual((await f.service.list(f.admin, f.project.id)).exports, [accepted]);
  } finally {
    await f.cleanup();
  }
});
test("episode keeps the head of adjacent legacy clips after adopting a different predecessor", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    const original = await f.job(901, "video", "completed", f.video.id);
    const replacementClip = await f.asset(randomUUID().replaceAll("-", ""), "video");
    await f.job(902, "video", "completed", replacementClip.id);
    const child = await f.job(903, "video", "completed", f.video.id);
    await f.link(f.project.id, "prior", 901);
    await f.link(f.project.id, "prior", 902);
    await f.link(f.project.id, "next", 903);
    await f.db.query("INSERT INTO job_tail_chains(child_job_id,parent_job_id) VALUES($1,$2)", [child.id, original.id]);
    const shots = ["prior", "next"];
    for (const inherited of [true, false]) {
      await confirmEpisodeAdoptions(f, {
        nodes: [
          { id: "prior", type: "video", x: 0, y: 0, active_job: 902 },
          { id: "next", type: "video", x: 300, y: 0, active_job: 903, tail_inherited: inherited },
        ],
        shots,
        director: episode(shots),
      });
      const accepted = await f.service.create(f.admin, f.project.id, {
        uid: randomUUID(), expected_revision: 1, scope: "episode",
      });
      const row = await one(f.db, "SELECT snapshot FROM storyboard_exports WHERE public_id=$1", [accepted.id]);
      const frozen = JSON.parse(Buffer.from(row.snapshot).toString("utf8"));
      assert.deepEqual(frozen.map((shot: { video: string }) => shot.video), [replacementClip.public_id, f.video.public_id]);
      assert.ok(frozen.every((shot: { tailInherited?: boolean }) => !shot.tailInherited));
      await f.db.query("UPDATE storyboard_exports SET state='failed' WHERE public_id=$1", [accepted.id]);
    }
  } finally {
    await f.cleanup();
  }
});

test("episode receipt remains available when the renderer is down", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    await confirmEpisodeAdoptions(f, { ...f.doc, director: episode(f.doc.shots) });
    const request = {
      uid: randomUUID(),
      expected_revision: f.project.revision,
      scope: "episode" as const,
    };
    const accepted = await f.service.create(f.admin, f.project.id, request);
    let healthChecks = 0;
    const unavailable = new OriginalStoryboardExports(f.p, [{
      ...originalStoryboard,
      health: async () => {
        healthChecks++;
        return false;
      },
    }]);
    assert.deepEqual(await unavailable.create(f.admin, f.project.id, request), accepted);
    await assert.rejects(
      unavailable.create(f.admin, f.project.id, { ...request, scope: "canvas" }),
      { status: 409, message: /提交编号/ },
    );
    await assert.rejects(
      unavailable.create(f.member, f.project.id, request),
      { status: 404 },
    );
    assert.equal(healthChecks, 0);
    await assert.rejects(
      unavailable.create(f.admin, f.project.id, { ...request, uid: randomUUID() }),
      { status: 503 },
    );
    assert.equal(healthChecks, 1);
  } finally {
    await f.cleanup();
  }
});
test("a stalled renderer probe does not lock an existing export receipt", async () => {
  const f = await fixture();
  const enteredProbe = deferred();
  const releaseProbe = deferred();
  let probe: Promise<unknown> | undefined;
  let replay: Promise<unknown> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = { uid: randomUUID(), expected_revision: f.project.revision };
    const accepted = await f.service.create(f.admin, f.project.id, request);
    const slow = new OriginalStoryboardExports(f.p, [
      {
        ...originalStoryboard,
        health: async () => {
          enteredProbe.resolve();
          await releaseProbe.promise;
          return false;
        },
      },
    ]);
    probe = slow
      .create(f.admin, f.project.id, { ...request, uid: randomUUID() })
      .catch((error: unknown) => error);
    await enteredProbe.promise;
    replay = f.service.create(f.admin, f.project.id, request);
    const timedOut = new Promise((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error("renderer probe locked receipt lookup")),
        5000,
      );
    });
    assert.deepEqual(await Promise.race([replay, timedOut]), accepted);
  } finally {
    clearTimeout(deadline);
    releaseProbe.resolve();
    await Promise.allSettled([probe, replay]);
    await f.cleanup();
  }
});
test("episode exporter requires MP4 composition output", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    await setCanvas(f, { ...f.doc, director: episode(f.doc.shots) });
    const request = {
      uid: randomUUID(),
      expected_revision: f.project.revision,
      scope: "episode" as const,
    };
    await deployStoryboardExporter(f, "2.0.0", {
      outputKind: "project",
      mime: "application/zip",
      program: "({export:()=>({})})",
    });
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request),
      { status: 503, message: /MP4/ },
    );
    await deployStoryboardExporter(f, "3.0.0", {
      outputKind: "composition",
      mime: "application/zip",
      program: "({plan:()=>[{index:0,narration:true,subtitles:true}]})",
    });
    await assert.rejects(
      f.service.create(f.admin, f.project.id, request),
      { status: 503, message: /MP4/ },
    );
  } finally {
    await f.cleanup();
  }
});
test("episode export rejects 31 shots at admission and 10 minutes at rendering", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    const nodes = Array.from({ length: 31 }, (_, index) => ({
      id: `s${index}`,
      type: "video",
      x: 0,
      y: 0,
      use_media: true,
      media_id: f.video.public_id,
    }));
    const request = {
      uid: randomUUID(),
      expected_revision: 1,
      scope: "episode" as const,
    };
    const setShots = async (nodes: unknown[], shots: string[]) => {
      await setCanvas(f, { nodes, shots, director: episode(shots) });
    };
    await setShots(nodes, nodes.map((n) => n.id));
    await assert.rejects(f.service.create(f.admin, f.project.id, request), {
      status: 400,
      message: /30/,
    });
    const narrated = {
      ...nodes[0],
      narration_text: "你好。😀!",
      dialogue_lines: [{ id: "blank", text: " " }],
    };
    await setShots([narrated], [narrated.id]);
    await assert.rejects(f.service.create(f.admin, f.project.id, request), {
      status: 409,
      message: /填写旁白/,
    });
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=16x16:r=24:d=100",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-f",
      "mp4",
      join(f.directory, f.video.id),
    ]);
    const episodeNodes = [{ ...narrated, narration_job: 900 }, ...nodes.slice(1, 6)];
    const episodeIds = episodeNodes.map(({ id }) => id);
    await confirmEpisodeAdoptions(f, { nodes: episodeNodes, shots: episodeIds, director: episode(episodeIds) });
    const accepted = await f.service.create(f.admin, f.project.id, request);
    const row = await one(
      f.db,
      "SELECT id,snapshot FROM storyboard_exports WHERE public_id=$1",
      [accepted.id],
    );
    assert.equal(JSON.parse(Buffer.from(row.snapshot).toString("utf8"))[0].voice, f.voice.public_id);
    await f.service.execute(row.id);
    const failed = (await f.service.list(f.admin, f.project.id)).exports[0];
    assert.equal(failed.state, "failed");
    assert.equal(failed.scope, "episode");
    assert.match(failed.error, /成片总时长最多 5 分钟/);
  } finally {
    await f.cleanup();
  }
});
test("scope migration retains queued canvas snapshots and their submission receipts", async () => {
  const f = await databaseFixture("055_workspace_script_documents.sql");
  try {
    await new OriginalIdentity(f.p).bootstrap({
      name: "admin",
      nickname: "管理员",
      password: "scope-migration-fixture",
    });
    const admin = (await one(f.db, "SELECT * FROM users WHERE name='admin'")) as OriginalActor;
    const project = await new OriginalCanvases(f.p).create(admin, {});
    const request = { uid: randomUUID(), expected_revision: project.revision };
    const id = randomUUID();
    const publicId = id.replaceAll("-", "");
    const snapshot = Buffer.from(JSON.stringify([{ node: "saved", video: "pinned" }]));
    await f.db.query(
      `INSERT INTO storyboard_exports
        (id,public_id,uid,owner_id,workspace_id,project_id,revision,snapshot,state,subtitles,error,created,updated)
       SELECT $1,$2,$3,owner_id,workspace_id,id,revision,$4,'queued',$5,$5,1,1
       FROM documents WHERE public_id=$6`,
      [id, publicId, request.uid, snapshot, Buffer.alloc(0), project.id],
    );
    await migrate(f.db);
    const row = await one(f.db, "SELECT scope,snapshot FROM storyboard_exports WHERE id=$1", [id]);
    assert.equal(row.scope, "canvas");
    assert.deepEqual(Buffer.from(row.snapshot), snapshot);
    const service = new OriginalStoryboardExports(f.p);
    const replay = await service.create(admin, project.id, request);
    assert.equal(replay.id, publicId);
    assert.equal(replay.scope, "canvas");
    assert.equal(replay.state, "queued");
    await assert.rejects(
      service.create(admin, project.id, { ...request, scope: "episode" }),
      { status: 409, message: /提交编号/ },
    );
  } finally {
    await f.cleanup();
  }
});
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
    assert.equal(created.scope, "canvas");
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
    const pinned = await one(
      f.db,
      "SELECT exporter_plugin,exporter_version,exporter_id FROM storyboard_exports WHERE id=$1",
      [row.id],
    );
    assert.deepEqual(pinned, {
      exporter_plugin: "storyboard",
      exporter_version: "1.0.0",
      exporter_id: "mp4",
    });
    await f.db.query(
      "UPDATE studio_packages SET enabled=false WHERE id='storyboard'",
    );
    assert.deepEqual(
      await f.service.create(f.admin, f.project.id, {
        uid,
        expected_revision: 1,
      }),
      created,
    );
    await assert.rejects(
      f.service.create(f.admin, f.project.id, {
        uid: randomUUID(),
        expected_revision: 1,
      }),
      /成片合成服务尚未配置/,
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
      await import("@fumiao/original-api/storyboard-queue.js");
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
      { status: 404 },
    );
    await assert.rejects(
      unavailable.create(f.admin, f.project.id, request()),
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

test("episode admission requires matching adoption evidence for an explicit media pin", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    const node = { ...f.doc.nodes[0], prompt: "同一镜头", audio_strategy: "keep_original" };
    await setCanvas(f, { ...f.doc, nodes: [node], director: episode(f.doc.shots) });
    const request = { uid: randomUUID(), expected_revision: 1, scope: "episode" };
    await assert.rejects(f.service.create(f.admin, f.project.id, request), { status: 409, message: /采用/ });
    const approved = await confirmEpisodeAdoptions(f, { ...f.doc, nodes: [node], director: episode(f.doc.shots) });
    const another = await f.asset(randomUUID().replaceAll("-", ""), "video");
    await setCanvas(f, { ...approved, nodes: [{ ...node, media_id: another.public_id }] });
    await assert.rejects(f.service.create(f.admin, f.project.id, request), { status: 409, message: /采用/ });
    await setCanvas(f, { ...approved, nodes: [{ ...node, prompt: "分镜已改写" }] });
    await assert.rejects(f.service.create(f.admin, f.project.id, request), { status: 409, message: /采用/ });
    await setCanvas(f, { ...approved, nodes: [{ ...node, x: 100 }] });
    assert.equal((await f.service.create(f.admin, f.project.id, request)).scope, "episode");
  } finally {
    await f.cleanup();
  }
});

test("episode admission refuses a drifted script unless its exact confirmed revision was chosen", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f, 2);
    await confirmEpisodeAdoptions(f, { ...f.doc, director: episode(f.doc.shots) });
    const request = { uid: randomUUID(), expected_revision: 1, scope: "episode" };
    await assert.rejects(f.service.create(f.admin, f.project.id, request), { status: 409, message: /主剧本已更新/ });
    await assert.rejects(f.service.create(f.admin, f.project.id, {
      ...request, script_revision: 2, use_confirmed_script: true,
    }), { status: 409, message: /剧本版本/ });
    await confirmEpisodeAdoptions(f, { ...f.doc, director: episode(f.doc.shots) });
    const exact = { ...request, script_revision: 1, use_confirmed_script: true };
    const accepted = await f.service.create(f.admin, f.project.id, exact);
    await f.db.query("UPDATE workspace_script_documents SET deleted=true WHERE public_id=$1", ["c".repeat(32)]);
    assert.deepEqual(await f.service.create(f.admin, f.project.id, exact), accepted);
  } finally {
    await f.cleanup();
  }
});

async function confirmEpisodeAdoptions<T extends { director: DirectorProduction; nodes: { id: string; media_id?: string | null; use_media?: boolean; active_job?: number | null }[] }>(
  f: Awaited<ReturnType<typeof fixture>>,
  document: T,
) {
  await setCanvas(f, document);
  const director = new OriginalBatchPrecheck(f.p);
  const shots: NonNullable<DirectorProduction["shots"]> = [];
  for (const nodeId of document.director.shot_ids) {
    const node = document.nodes.find(({ id }) => id === nodeId)!;
    const inputs = await director.directorInputs(f.admin, f.project.id, nodeId);
    assert.ok(inputs.adoption_input_basis);
    const selection = node.use_media ? { media_id: node.media_id! } : { job_id: node.active_job! };
    shots.push({ node_id: nodeId, adoption_basis: await directorAdoptionBasis(inputs.adoption_input_basis, selection) });
  }
  const approved = { ...document, director: { ...document.director, shots } };
  await setCanvas(f, approved);
  return approved;
}

async function seedEpisodeScript(f: Awaited<ReturnType<typeof fixture>>, revision = 1) {
  await f.db.query(
    `INSERT INTO workspace_script_documents(id, public_id, workspace_id, owner_id, path, revision)
     SELECT $1,$2,workspace_id,owner_id,'主剧本.md',$3 FROM documents WHERE id=$4`,
    [randomUUID(), "c".repeat(32), revision, f.projectId],
  );
}

test("episode admission rechecks selected tracked audio against the current effective voice", async () => {
  const f = await fixture();
  try {
    await seedEpisodeScript(f);
    await ensureBuiltinEdgeTts(f.p);
    const packs = new OriginalPacks(f.p);
    const workspace = String(f.workspace.public_id);
    const reference = await f.asset(randomUUID().replaceAll("-", ""), "ref");
    const packDraft = (voice_id: string) => ({
      name: "林默",
      purpose: "subject",
      media: [reference.public_id],
      voice_profile: { model: "edge-tts", voice_id },
    });
    const oldVoice = "zh-CN-XiaoxiaoNeural";
    const pack = await packs.save(f.admin, packDraft(oldVoice), workspace);
    const node = { ...f.doc.nodes[0], prompt: "对白镜头", narration_job: null, narration_text: "", dialogue_lines: [
      { id: "line", speaker: "林默", text: "你好。😀!", audio_job: 900, pack_id: pack.id },
    ] };
    const approved = await confirmEpisodeAdoptions(f, { ...f.doc, nodes: [node], director: episode(f.doc.shots) });
    const checked = await new OriginalBatchPrecheck(f.p).directorInputs(f.admin, f.project.id, node.id);
    const expected = checked.audio_inputs["shot:dialogue:line"];
    assert.equal(expected.voice_id, oldVoice);
    const link = await f.link(f.project.id, "dialogue:shot:line", 900, JSON.stringify({ director_basis: expected.basis }));
    const request = { uid: randomUUID(), expected_revision: 1, scope: "episode" };
    const accepted = await f.service.create(f.admin, f.project.id, request);
    const row = await one(f.db, "SELECT id FROM storyboard_exports WHERE public_id=$1", [accepted.id]);
    await f.service.execute(row.id);
    assert.equal((await f.service.list(f.admin, f.project.id, "episode")).exports[0].state, "done");

    await packs.save(f.admin, { ...packDraft("zh-CN-YunxiNeural"), expected_revision: pack.revision }, workspace, pack.id);
    const retry = () => f.service.create(f.admin, f.project.id, { ...request, uid: randomUUID() });
    await assert.rejects(retry(), { status: 409, message: /声线.*重新生成/ });
    // Updating the video approval still leaves the selected voice take stale.
    await confirmEpisodeAdoptions(f, approved);
    await assert.rejects(retry(), { status: 409, message: /声线.*重新生成/ });
    // An ordinary take carries individual voice fields instead of a Director digest.
    const ordinary = { model: "edge-tts", pack_id: pack.id, voice_id: oldVoice };
    await f.db.query("UPDATE canvas_job_links SET inputs=$2 WHERE id=$1", [link.id, Buffer.from(JSON.stringify(ordinary))]);
    await assert.rejects(retry(), { status: 409, message: /声线.*重新生成/ });
    const receipt = await f.service.create(f.admin, f.project.id, request);
    assert.equal(receipt.id, accepted.id);
    assert.equal(receipt.state, "done");
  } finally {
    await f.cleanup();
  }
});
