import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { OriginalStoryboardExports } from "../packages/original-api/src/storyboard-exports.js";
import { StoryboardQueue } from "../packages/original-api/src/storyboard-queue.js";
import { S3Storage } from "../packages/platform/src/storage.js";
import type { verifyCanvasRunsHttp } from "./canvas-runs-http-cases.js";

const exec = promisify(execFile);
type Context = Parameters<typeof verifyCanvasRunsHttp>[0];
type Backend = Context["original"];
const admin = { actor: "admin" } as const;
const member = { actor: "member" } as const;
const subtitles = (key: string) =>
  "/api/storyboard-exports/" + key + "/subtitles";
const hex = () => randomUUID().replaceAll("-", "");

export async function verifyStoryboardHttp(
  {
    f,
    original,
    target,
    runtime,
    python,
    team,
    personal,
    request,
    compare,
    project,
    checks,
  }: Context,
  pause: string,
) {
  const backends = [original, target];
  const data = join(runtime, "data");
  function sqlite(statement: string, args: unknown[] = []) {
    return JSON.parse(
      execFileSync(
        python,
        [
          "-c",
          "import json,sqlite3,sys\nwith sqlite3.connect(sys.argv[1],timeout=20) as db:\n" +
            " db.execute('PRAGMA foreign_keys=ON')\n print(json.dumps(db.execute(sys.argv[2],json.loads(sys.argv[3])).fetchall()))",
          join(data, "studio.sqlite"),
          statement,
          JSON.stringify(args),
        ],
        { encoding: "utf8" },
      ),
    );
  }

  for (const title of [
    "storyboard-http",
    "other-storyboard-http",
    "competing-storyboard-http",
    "private-storyboard-http",
  ])
    await compare(
      "create " + title,
      "POST",
      "/api/canvases",
      200,
      {
        ...admin,
        workspace: title.startsWith("private") ? personal : team,
        body: { title },
      },
      title,
    );
  const canvas = project("storyboard-http"),
    other = project("other-storyboard-http"),
    competing = project("competing-storyboard-http");
  const exports = project("storyboard-http", "/exports");
  const shots = project("storyboard-http", "/shots/download");
  const revision = { expected_revision: 1 };
  const uid = randomUUID();
  const draft = { ...revision, uid };
  await compare("export-list authentication", "GET", exports, 401);
  await compare("empty export list", "GET", exports, 200, admin);
  await compare(
    "export body validation before authentication",
    "POST",
    exports,
    422,
    {
      body: { uid: false, expected_revision: 0 },
    },
  );
  await compare(
    "export authentication after ignored extra field",
    "POST",
    exports,
    401,
    {
      body: { ...draft, client_field: true },
    },
  );
  await compare(
    "shot download rejects extra fields before authentication",
    "POST",
    shots,
    422,
    {
      body: { ...revision, client_field: true },
    },
  );
  await compare("shot download authentication", "POST", shots, 401, {
    body: revision,
  });
  await compare("export malformed JSON", "POST", exports, 422, {
    raw: '{"uid":',
    contentType: "application/json",
  });
  await compare("export CSRF", "POST", exports, 403, {
    ...admin,
    body: draft,
    origin: "https://elsewhere.invalid",
  });
  await compare("export method and Allow", "DELETE", exports, 405);
  await compare("shot-download method and Allow", "GET", shots, 405);
  await compare(
    "subtitle format validation before authentication",
    "GET",
    subtitles("missing") + "?format=ass",
    422,
  );
  await compare(
    "subtitle requires authenticated session",
    "GET",
    subtitles("missing"),
    401,
  );
  await compare(
    "subtitle missing export",
    "GET",
    subtitles("missing"),
    404,
    admin,
  );
  await compare(
    "subtitle opaque key with NUL",
    "GET",
    subtitles("%00"),
    404,
    admin,
  );
  await compare("subtitle HEAD and Allow", "HEAD", subtitles("missing"), 405);
  await compare(
    "subtitle trailing slash redirect",
    "GET",
    subtitles("missing") + "/?format=vtt",
    307,
  );
  await compare(
    "no separate export details route",
    "GET",
    "/api/storyboard-exports/missing",
    404,
  );
  await compare(
    "export missing canvas",
    "POST",
    "/api/canvases/missing/exports",
    404,
    { ...admin, body: draft },
  );
  await compare(
    "personal export list hidden from teammate",
    "GET",
    project("private-storyboard-http", "/exports"),
    404,
    member,
  );
  await compare(
    "personal shot download hidden from teammate",
    "POST",
    project("private-storyboard-http", "/shots/download"),
    404,
    { ...member, body: revision },
  );
  await compare("empty storyboard", "POST", exports, 400, {
    ...admin,
    body: draft,
  });
  await compare("empty shots download", "POST", shots, 400, {
    ...admin,
    body: revision,
  });
  await compare("shot revision mismatch before readiness", "POST", shots, 409, {
    ...admin,
    raw: '{"expected_revision":9007199254740993}',
    contentType: "application/json",
  });

  const videoPath = join(runtime, "shot.mp4");
  const alternatePath = join(runtime, "earlier.webm");
  const voicePath = join(runtime, "voice.wav");
  await Promise.all([
    exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=24:d=0.5",
      "-c:v",
      "libx264",
      videoPath,
    ]),
    exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x96:r=24:d=0.5",
      "-c:v",
      "libvpx-vp9",
      alternatePath,
    ]),
    exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=400:duration=0.75",
      "-c:a",
      "pcm_s16le",
      voicePath,
    ]),
  ]);
  async function asset(kind: "video" | "audio", mime: string, bytes: Buffer) {
    const key = hex(),
      row = await f.asset(key, kind, f.team, f.admin);
    await f.p.storage.put(key, bytes, mime);
    await writeFile(join(data, "objects", key), bytes, { mode: 0o600 });
    await f.db.query(
      "UPDATE assets SET object_key=$1,mime=$2,size=$3 WHERE id=$4",
      [key, mime, bytes.length, row.id],
    );
    sqlite(
      "INSERT INTO media(id,kind,owner,workspace,size,mime) VALUES(?,?,?,?,?,?)",
      [key, kind, f.admin.public_id, team, bytes.length, mime],
    );
    return { id: row.id, key, bytes };
  }
  const video = await asset("video", "video/mp4", await readFile(videoPath));
  const alternate = await asset(
    "video",
    "video/webm",
    await readFile(alternatePath),
  );
  const voice = await asset("audio", "audio/wav", await readFile(voicePath));
  const corrupt = await asset(
    "video",
    "video/mp4",
    Buffer.from("unreadable video content"),
  );
  const unsupported = await asset("video", "video/quicktime", video.bytes);
  const narration = "你好。😀!";
  const voiceJob = 9000,
    pickedJob = 9001,
    latestJob = 9002;
  for (const job of [
    {
      id: voiceJob,
      kind: "audio",
      node: "voice:narrated",
      result: voice,
      prompt: narration,
    },
    { id: pickedJob, kind: "video", node: "picked", result: video, prompt: "" },
    {
      id: latestJob,
      kind: "video",
      node: "picked",
      result: alternate,
      prompt: "",
    },
  ]) {
    const row = await f.job(
      job.id,
      job.kind,
      "completed",
      job.result.id,
      f.team,
      f.admin,
    );
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      row.id,
      JSON.stringify({ prompt: job.prompt }),
    ]);
    await f.link(canvas(target).split("/").at(-1)!, job.node, job.id);
    sqlite(
      "INSERT INTO jobs(id,uid,owner,workspace,kind,status,prompt,result,created,updated) VALUES(?,?,?,?,?,'done',?,?,1,1)",
      [
        job.id,
        randomUUID(),
        f.admin.public_id,
        team,
        job.kind,
        job.prompt,
        job.result.key,
      ],
    );
    sqlite(
      "INSERT INTO canvas_job_links(project,node,job,owner,uid,inputs,created) VALUES(?,?,?,?,?,'{}',1)",
      [
        canvas(original).split("/").at(-1),
        job.node,
        job.id,
        f.admin.public_id,
        randomUUID(),
      ],
    );
  }
  const node = (id: string, values: object = {}) => ({
    id,
    type: "video",
    x: 0,
    y: 0,
    ...values,
  });
  const local = (id: string, media_id: string) =>
    node(id, { media_id, use_media: true });
  async function save(
    label: string,
    path: (backend: Backend) => string,
    expected_revision: number,
    nodes: ReturnType<typeof node>[],
    order = nodes.map((n) => n.id),
  ) {
    const saved = await compare(
      label,
      "PUT",
      (backend) => path(backend) + "/document",
      200,
      {
        ...admin,
        body: {
          expected_revision,
          title: label,
          document: { nodes, shots: order },
        },
      },
    );
    return { expected_revision: saved.revision };
  }
  const pending = await save("unfinished shot", canvas, 1, [
    local("ok", video.key),
    node("missing"),
  ]);
  await compare(
    "first unready scene uses a two-digit shot number",
    "POST",
    shots,
    409,
    { ...admin, body: pending },
  );
  await compare("export rejects an unready scene", "POST", exports, 409, {
    ...admin,
    body: { uid, ...pending },
  });
  const otherRevision = await save("unsupported download MIME", other, 1, [
    local("odd", unsupported.key),
  ]);
  await compare(
    "unsupported shot MIME",
    "POST",
    (b) => other(b) + "/shots/download",
    400,
    { ...admin, body: otherRevision },
  );

  const ready = await save(
    "ready ordered storyboard",
    canvas,
    2,
    [
      node("picked", { media_id: alternate.key, active_job: pickedJob }),
      node("narrated", {
        media_id: alternate.key,
        use_media: true,
        narration_job: voiceJob,
        narration_text: narration,
      }),
      local("same", video.key),
    ],
    ["same", "narrated", "picked"],
  );

  async function pairFiles(
    label: string,
    path: (backend: Backend) => string,
    status: number,
    headers: Record<string, string> = {},
  ) {
    const responses = await Promise.all(
      backends.map((backend) =>
        request(backend, "GET", path(backend), { ...admin, headers }),
      ),
    );
    for (const res of responses)
      assert.equal(res.status, status, label + " " + res.text.slice(0, 250));
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "content-disposition",
      "cache-control",
      "x-accel-buffering",
    ])
      assert.equal(
        responses[1].headers.get(key),
        responses[0].headers.get(key),
        label + " " + key,
      );
    assert.deepEqual(responses[1].bytes, responses[0].bytes, label);
    checks.push(label);
    return responses[1];
  }
  await pairFiles(
    "ready shot uses private FileResponse Range",
    () => "/media/" + video.key + "?download=true",
    206,
    { range: "bytes=4-31" },
  );
  await pairFiles(
    "unsatisfiable media download Range",
    () => "/media/" + video.key + "?download=true",
    416,
    { range: "bytes=999999-" },
  );

  const tickets = await Promise.all(
    backends.map(async (backend) => {
      const replies = await Promise.all(
        Array.from({ length: 2 }, () =>
          request(backend, "POST", shots(backend) + "?workspace=" + personal, {
            ...admin,
            workspace: "invalid",
            body: ready,
          }),
        ),
      );
      for (const reply of replies) {
        assert.equal(reply.status, 200, reply.text);
        assert.match(reply.body.url, /^\/api\/downloads\/[A-Za-z0-9_-]+$/);
        assert.equal(reply.body.filename, "弗淼-镜头-3项.zip");
      }
      assert.notEqual(replies[0].body.url, replies[1].body.url);
      return replies[0].body.url as string;
    }),
  );
  const ticket = (backend: Backend) => tickets[backends.indexOf(backend)];
  await compare("archive ticket requires authentication", "GET", ticket, 401);
  await compare(
    "same-workspace teammate cannot redeem someone else's ticket",
    "GET",
    ticket,
    403,
    member,
  );
  const archive = await pairFiles(
    "private ZIP download ignores Range and preserves streaming headers",
    ticket,
    200,
    { range: "bytes=0-3" },
  );
  assert.equal(archive.headers.get("content-type"), "application/zip");
  assert.equal(archive.headers.get("x-accel-buffering"), "no");
  assert.equal(
    archive.headers.get("content-disposition"),
    "attachment; filename*=UTF-8''" + encodeURIComponent("弗淼-镜头-3项.zip"),
  );
  const zip = join(runtime, "shots.zip");
  await writeFile(zip, archive.bytes);
  const entries = execFileSync(
    python,
    [
      "-c",
      "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n print(json.dumps([(n,z.read(n).hex()) for n in z.namelist()]))",
      zip,
    ],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(entries), [
    ["镜头-001.mp4", video.bytes.toString("hex")],
    ["镜头-002.webm", alternate.bytes.toString("hex")],
    ["镜头-003.mp4", video.bytes.toString("hex")],
  ]);
  const bucket = process.env.TEST_STORYBOARD_S3_BUCKET;
  if (bucket) {
    assert.ok(process.env.S3_ENDPOINT, "Use an isolated private S3 endpoint");
    const storage = new S3Storage(bucket);
    const disk = f.p.storage;
    try {
      await storage.put(video.key, video.bytes, "video/mp4");
      await storage.put(alternate.key, alternate.bytes, "video/webm");
      f.p.storage = storage;
      await pairFiles("private S3 ZIP matches the pinned archive", ticket, 200);

      const path = "/media/" + video.key + "?download=true";
      const forbidden = await request(target, "GET", path);
      assert.equal(forbidden.status, 401);
      assert.equal(forbidden.location, null);
      const redirect = await request(target, "GET", path, admin);
      assert.equal(redirect.status, 307);
      const signed = new URL(redirect.location!);
      const unsigned = await fetch(signed.origin + signed.pathname);
      assert.equal(unsigned.status, 403);
      await unsigned.body?.cancel();
      const portion = await fetch(signed, { headers: { Range: "bytes=4-31" } });
      assert.equal(portion.status, 206);
      assert.equal(portion.headers.get("content-type"), "video/mp4");
      assert.equal(
        portion.headers.get("content-range"),
        "bytes 4-31/" + video.bytes.length,
      );
      assert.equal(
        portion.headers.get("content-disposition"),
        "attachment; filename*=UTF-8''" +
          encodeURIComponent("弗淼-" + video.key.slice(0, 8) + ".mp4"),
      );
      assert.deepEqual(
        Buffer.from(await portion.arrayBuffer()),
        video.bytes.subarray(4, 32),
      );
      checks.push(
        "authorized S3 media redirect, unsigned denial and signed download Range",
      );
    } finally {
      f.p.storage = disk;
      await Promise.all([
        storage.remove(video.key),
        storage.remove(alternate.key),
      ]);
      storage.client.destroy();
    }
  }
  await Promise.all([
    rm(join(data, "objects", alternate.key)),
    f.p.storage.remove(alternate.key),
  ]);
  await compare(
    "archive fails before streaming if a private object is unavailable",
    "GET",
    ticket,
    404,
    admin,
  );
  await Promise.all([
    writeFile(join(data, "objects", alternate.key), alternate.bytes, {
      mode: 0o600,
    }),
    f.p.storage.put(alternate.key, alternate.bytes, "video/webm"),
  ]);

  await writeFile(pause, "");
  const accepted = await Promise.all(
    backends.map(async (backend) => {
      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          request(backend, "POST", exports(backend), {
            ...admin,
            body: { ...ready, uid, ignored: true },
          }),
        ),
      );
      for (const r of responses) {
        assert.equal(r.status, 200, r.text);
        assert.match(r.body.id, /^[a-f0-9]{32}$/);
        assert.ok(["queued", "running"].includes(r.body.state), r.text);
        assert.equal(r.body.result, null);
        assert.equal(r.body.revision, ready.expected_revision);
      }
      assert.equal(new Set(responses.map((r) => r.body.id)).size, 1);
      backend.aliases.set(responses[0].body.id, "active storyboard");
      return responses[0].body.id as string;
    }),
  );
  const caption = (backend: Backend) =>
    subtitles(accepted[backends.indexOf(backend)]);
  await compare("pending captions", "GET", caption, 409, member);
  await compare(
    "same UID cannot target another canvas",
    "POST",
    (b) => other(b) + "/exports",
    409,
    { ...admin, body: { ...otherRevision, uid } },
  );
  await compare(
    "workspace admission rejects another UID",
    "POST",
    (b) => other(b) + "/exports",
    409,
    { ...admin, body: { ...otherRevision, uid: randomUUID() } },
  );

  const redis = new URL(process.env.TEST_REDIS_URL!);
  const queue = new StoryboardQueue(
    new OriginalStoryboardExports(f.p, undefined, undefined, runtime),
    {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      username: redis.username || undefined,
      password: redis.password || undefined,
      db: Number(redis.pathname.slice(1) || 0),
      ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
    },
    "test-storyboard-http-" + randomUUID(),
  );
  async function terminal(backend: Backend, path: string, id: string) {
    for (let attempt = 0; attempt < 240; attempt++) {
      const response = await request(backend, "GET", path, admin);
      assert.equal(response.status, 200, response.text);
      const row = response.body.exports.find(
        (item: { id: string }) => item.id === id,
      );
      if (["done", "failed"].includes(row?.state)) return row;
      await delay(100);
    }
    assert.fail("Storyboard never settled: " + id);
  }
  try {
    await rm(pause);
    await queue.start();
    const completed = await Promise.all(
      backends.map((b, i) => terminal(b, exports(b), accepted[i])),
    );
    for (const row of completed) {
      assert.equal(row.state, "done", row.error);
      assert.match(row.result, /^[a-f0-9]{32}$/);
    }
    assert.deepEqual(
      sqlite("SELECT count(*) FROM jobs WHERE model='storyboard'"),
      [[1]],
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM jobs WHERE plugin_id='original-storyboard'",
        )
      ).rows[0].n,
      1,
    );
    for (const [i, backend] of backends.entries()) {
      const published = await request(
        backend,
        "GET",
        "/media/" + completed[i].result,
        admin,
      );
      assert.equal(published.status, 200, published.text);
      assert.equal(published.headers.get("content-type"), "video/mp4");
      assert.equal(published.bytes.toString("ascii", 4, 8), "ftyp");
      const denied = await request(
        backend,
        "GET",
        "/media/" + completed[i].result,
      );
      assert.equal(denied.status, 401);
    }
    const srt = await pairFiles(
      "SRT attachment with UTF-8 byte length",
      caption,
      200,
    );
    assert.equal(srt.headers.get("content-type"), "application/x-subrip");
    assert.equal(
      srt.headers.get("content-disposition"),
      'attachment; filename="subtitles.srt"',
    );
    assert.match(srt.text, /你好。/);
    assert.match(srt.text, /😀!/);
    await pairFiles("SRT ignores download Range", caption, 200, {
      range: "bytes=0-3",
    });
    const vtt = await pairFiles(
      "VTT inline and last repeated format wins",
      (b) => caption(b) + "?format=srt&format=vtt",
      200,
    );
    assert.equal(vtt.headers.get("content-type"), "text/vtt; charset=utf-8");
    assert.equal(vtt.headers.get("content-disposition"), null);
    assert.match(vtt.text, /^WEBVTT\n\n1\n00:00:00\.500/);

    const broken = await save(
      "corrupt private source",
      other,
      otherRevision.expected_revision,
      [local("broken", corrupt.key)],
    );
    const competingRevision = await save(
      "second corrupt source",
      competing,
      1,
      [local("broken", corrupt.key)],
    );
    await writeFile(pause, "");
    await queue.worker.pause();
    const winners = await Promise.all(
      backends.map(async (backend) => {
        const attempts = [
          [other(backend), broken],
          [competing(backend), competingRevision],
        ] as const;
        const replies = await Promise.all(
          attempts.map(async ([projectPath, revision]) => {
            const path = projectPath + "/exports";
            return {
              path,
              reply: await request(backend, "POST", path, {
                ...admin,
                body: { ...revision, uid: randomUUID() },
              }),
            };
          }),
        );
        assert.deepEqual(
          replies.map(({ reply }) => reply.status).sort(),
          [200, 409],
        );
        assert.deepEqual(
          replies.find(({ reply }) => reply.status === 409)!.reply.body,
          { detail: "当前空间已有成片在合成，请完成后再试" },
        );
        return replies.find(({ reply }) => reply.status === 200)!;
      }),
    );
    checks.push("concurrent different canvases admit one export per workspace");
    await rm(pause);
    queue.worker.resume();
    const failed = await Promise.all(
      winners.map(async ({ path, reply }, index) => {
        const row = await terminal(backends[index], path, reply.body.id);
        assert.equal(row.state, "failed");
        assert.equal(row.result, null);
        return row;
      }),
    );
    assert.equal(failed[1].error, failed[0].error);
    await compare(
      "failed export has no captions",
      "GET",
      (b) => subtitles(failed[backends.indexOf(b)].id),
      409,
      admin,
    );

    for (const [i, backend] of backends.entries()) {
      const list = await request(backend, "GET", exports(backend), member);
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.exports, [completed[i]]);
      assert.deepEqual(Object.keys(completed[i]).sort(), [
        "created",
        "error",
        "id",
        "result",
        "revision",
        "state",
        "updated",
      ]);
      const replay = await request(backend, "POST", exports(backend), {
        ...admin,
        body: draft,
      });
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, completed[i]);
    }
    checks.push(
      "concurrent UID replay, workspace admission, completed history and failed execution",
    );
    const memberTickets = await Promise.all(
      backends.map(async (backend) => {
        const response = await request(backend, "POST", shots(backend), {
          ...member,
          body: ready,
        });
        assert.equal(response.status, 200);
        return response.body.url as string;
      }),
    );
    await compare("removed canvas", "DELETE", canvas, 200, admin);
    await compare(
      "removed canvas no longer has export listing",
      "GET",
      exports,
      404,
      admin,
    );
    await pairFiles(
      "completed captions survive removal of source canvas",
      caption,
      200,
    );

    sqlite("DELETE FROM workspace_members WHERE workspace=? AND user=?", [
      team,
      f.member.public_id,
    ]);
    await f.db.query(
      "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
      [f.team.id, f.member.id],
    );
    await compare(
      "revoked teammate loses captions",
      "GET",
      caption,
      404,
      member,
    );
    await compare(
      "revoked teammate loses their own archive access",
      "GET",
      (b) => memberTickets[backends.indexOf(b)],
      404,
      member,
    );
    sqlite("UPDATE downloads SET expires=0");
    await f.db.query("UPDATE download_tickets SET expires_at=to_timestamp(0)");
    await compare("expired archive ticket", "GET", ticket, 410, admin);
  } finally {
    await queue.worker.pause();
    await queue.queue.obliterate({ force: true });
    await queue.close();
  }
}
