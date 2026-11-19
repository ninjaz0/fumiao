/** Real pinned Pure HTTP versus isolated Nest/PostgreSQL; dispatch is paused. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { databaseFixture } from "../tests/helpers/database.js";
import { createOriginalApp } from "../apps/api/src/original.js";
import { importLegacy } from "../packages/platform/src/importer.js";
import { one } from "../packages/platform/src/db.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { OriginalIdentity } from "../packages/original-api/src/identity.js";
import { OriginalPacks } from "../packages/original-api/src/packs.js";
import { gpuText as gpuOriginal } from "../plugins/gpu/src/text.js";
import { museText as museOriginal } from "../plugins/muse/src/text.js";
import { imagesText as imagesOriginal } from "../plugins/images/src/text.js";
import { flowText as flowOriginal } from "../plugins/flow/src/text.js";
import { gpuEstimate } from "../plugins/gpu/src/estimate.js";
import { museEstimate } from "../plugins/muse/src/estimate.js";
import { imagesEstimate } from "../plugins/images/src/estimate.js";
import { flowEstimate } from "../plugins/flow/src/estimate.js";
import { verifyEstimates } from "./estimate-cases.js";
const estimateOnly = process.argv.includes("--estimate");

const f = await databaseFixture(),
  python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
await mkdir(join(f.directory, "data"));
await writeFile(
  join(f.directory, "data/.dispatch-paused"),
  "isolated contract test\n",
);
// A deliberately unusable fixture token enables only the old configuration predicate.
await writeFile(
  join(f.directory, "data/openai.env"),
  "OPENAI_API_KEY=sk-fixture-unused\n",
  { mode: 0o600 },
);
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as any).port;
await new Promise<void>((r) => reservation.close(() => r()));
const origin = "http://localhost:3000",
  previous = process.env.PUBLIC_URL;
process.env.PUBLIC_URL = origin;
const legacy = spawn(
  python,
  [
    "scripts/preview-original.py",
    "--port",
    String(port),
    "--public-url",
    origin,
    "--runtime-directory",
    f.directory,
    "--no-reuse-local-credentials",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const stream of [legacy.stdout, legacy.stderr])
  stream.on("data", (b) => {
    logs = (logs + b).slice(-5000);
  });
const urls = [`http://127.0.0.1:${port}`, ""],
  sessions = ["", ""],
  checks: string[] = [];
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
function source(sql: string, params: unknown[] = []) {
  return JSON.parse(
    execFileSync(
      python,
      [
        "-c",
        "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; d=json.load(sys.stdin); r=[dict(x) for x in c.execute(d['sql'],d['params']).fetchall()]; c.commit(); print(json.dumps(r,ensure_ascii=False))",
        join(f.directory, "data/studio.sqlite"),
      ],
      {
        input: JSON.stringify({ sql, params }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).toString(),
  );
}
async function request(
  i: number,
  path: string,
  body?: unknown,
  options: {
    method?: string;
    workspace?: string;
    cookie?: string;
    bytes?: Buffer;
  } = {},
) {
  const response = await fetch(urls[i] + path, {
    method: options.method || "POST",
    headers: {
      // Uvicorn closes connections after its original plain-text 500 response.
      connection: "close",
      origin,
      cookie: options.cookie ?? sessions[i],
      "X-Workspace-Id": options.workspace ?? "1",
      "Content-Type": options.bytes
        ? "application/octet-stream"
        : "application/json",
    },
    body: options.bytes
      ? new Uint8Array(options.bytes)
      : body === undefined
        ? undefined
        : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return {
    status: response.status,
    headers: response.headers,
    body: parsed as any,
  };
}
async function pair(
  label: string,
  path: string,
  body: unknown,
  status = 200,
  options: Parameters<typeof request>[3] = {},
) {
  const result = await Promise.all(
    [0, 1].map((i) => request(i, path, body, options)),
  );
  if (result[0].status !== status) console.error(logs.slice(-3000));
  for (const [index, r] of result.entries())
    assert.equal(
      r.status,
      status,
      label + " backend " + index + ": " + JSON.stringify(r.body),
    );
  assert.deepEqual(result[1].body, result[0].body, label);
  checks.push(label);
  return result[0].body;
}
const path = (kind: string) =>
  kind === "video" ? "/api/jobs" : `/api/${kind}-jobs`;
async function submit(
  label: string,
  kind: string,
  fields: Record<string, unknown> = {},
) {
  const body = {
    uid: randomUUID(),
    prompt: "合成测试 prompt",
    seed: 42,
    ...fields,
  };
  const accepted = await pair(label, path(kind), body);
  const old = source("SELECT * FROM jobs WHERE id=?", [accepted.id])[0];
  const current = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
    accepted.id,
  ]);
  const view = current.original_view;
  for (const key of [
    "ratio",
    "quality",
    "seconds",
    "sampling_steps",
    "width",
    "height",
    "image_quality",
  ])
    assert.deepEqual(view[key], old[key], label + " " + key);
  if (fields.seed !== null) assert.equal(view.seed, old.seed, label + " seed");
  assert.equal(current.original_uid, old.uid, label + " identity");
  assert.equal(
    current.original_parent === null ? null : Number(current.original_parent),
    old.parent,
    label + " parent",
  );
  assert.equal(current.input.prompt, old.prompt, label + " prompt");
  assert.deepEqual(view.refs, JSON.parse(old.refs), label + " references");
  for (const [field, value] of [
    ["h3_inputs", view.h3_inputs],
    ["audio_settings", view.audio_settings],
    ["reference_packs", current.reference_packs],
    ["timing_forecast", current.submission_forecast],
  ] as const)
    assert.deepEqual(value, JSON.parse(old[field]), label + " " + field);
  const originalWallet = source(
    "SELECT balance,reserved FROM credit_accounts WHERE workspace=1",
  )[0];
  const wallet = await one(
    f.db,
    "SELECT balance,held FROM wallets WHERE workspace_id=(SELECT id FROM workspaces WHERE public_id=1)",
  );
  assert.equal(
    Number(wallet.balance),
    originalWallet.balance,
    label + " balance",
  );
  assert.equal(Number(wallet.held), originalWallet.reserved, label + " held");
  return { body, id: accepted.id };
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(urls[0] + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (legacy.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  const credentials = JSON.parse(
    await readFile(join(f.directory, "credentials.json"), "utf8"),
  );
  const login = await request(0, "/api/login", credentials);
  assert.equal(login.status, 200);
  sessions[0] = login.headers.get("set-cookie")!.split(";")[0];
  source("UPDATE credit_accounts SET balance=1000 WHERE workspace=1");
  source("UPDATE credit_prices SET amount=1");
  const png = await sharp({
    create: { width: 48, height: 64, channels: 3, background: "#4578a0" },
  })
    .png()
    .toBuffer();
  const uploaded = await request(0, "/api/assets", undefined, { bytes: png });
  assert.equal(uploaded.status, 200);
  const ref = uploaded.body.id;
  const visuals: string[] = [ref];
  for (let i = 1; i < 9; i++)
    visuals.push(
      (await request(0, "/api/assets", undefined, { bytes: png })).body.id,
    );
  const nativeRefs: string[] = [];
  for (const kind of ["video", "audio", "video"]) {
    const asset = (await request(0, "/api/assets", undefined, { bytes: png }))
      .body.id;
    source("UPDATE media SET kind=?,mime=?,w=?,h=? WHERE id=?", [
      "ref_" + kind,
      kind === "video" ? "video/mp4" : "audio/wav",
      kind === "video" ? 48 : 0,
      kind === "video" ? 64 : 0,
      asset,
    ]);
    source(
      "INSERT INTO h3_reference_media(media,seconds,fps,has_audio,name) VALUES(?,2,?,?,?)",
      [asset, kind === "video" ? 24 : 0, kind === "video" ? 1 : 0, "合成参考"],
    );
    nativeRefs.push(asset);
  }
  const pack = await request(0, "/api/asset-packs", {
    name: "主角",
    purpose: "subject",
    description: `蓝色服装 /media/${ref}?keep=1`,
    media: [ref],
  });
  assert.equal(pack.status, 200);
  const packText = {
    name: " \u0085\ufeff主\0角😀\ufeff\u001c ",
    description: ` \u001c说明\0 \uFEFF /media/${ref}?x=%00 https://example.test/😀 \\u0000 \u0085 `,
  };
  const specialPack = estimateOnly
    ? undefined
    : await request(0, "/api/asset-packs", {
        ...packText,
        purpose: "subject",
        media: [ref],
      });
  if (specialPack) {
    assert.equal(specialPack.status, 200);
    // An existing SQLite export may contain edge whitespace that live writes trim.
    source("UPDATE asset_packs SET description=? WHERE id=?", [
      "\u0085" + pack.body.description + " ",
      pack.body.id,
    ]);
  }
  const exportPath = join(f.directory, "export.json");
  execFileSync(
    python,
    [
      "scripts/export-legacy.py",
      "--database",
      join(f.directory, "data/studio.sqlite"),
      "--output",
      exportPath,
      "--source",
      "generation-fixture",
      "--include-registration-codes",
    ],
    { stdio: "pipe" },
  );
  await importLegacy(
    f.p,
    JSON.parse(await readFile(exportPath, "utf8")),
    join(f.directory, "data/objects"),
  );
  await f.p.registry.installBuiltins(f.db);
  const identity = new OriginalIdentity(f.p),
    token = await identity.login(credentials, "fixture"),
    admin = await identity.actor(token);
  sessions[1] = "fm_session=" + token;
  const catalog = new StudioCatalog(f.db);
  for (const plugin of estimateOnly
    ? [gpuEstimate, museEstimate, imagesEstimate, flowEstimate]
    : [gpuOriginal, museOriginal, imagesOriginal, flowOriginal]) {
    await f.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
    const connection = await f.p.createConnection(admin, {
      name: plugin.manifest.id,
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      config:
        plugin.manifest.mode === "pull"
          ? {}
          : { baseUrl: "http://127.0.0.1:9", apiKey: "sk-fixture-unused" },
    });
    await f.p.updateConnection(admin, connection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
  }
  await f.db.query("UPDATE studio_prices SET amount=1");
  await f.db.query("UPDATE original_state_settings SET image_enabled=true");
  await f.db.query("UPDATE studio_policy SET price_revision=$1", [
    Number(
      source("SELECT value FROM settings WHERE key='credit_price_revision'")[0]
        .value,
    ),
  ]);
  app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  urls[1] = await app.getUrl();
  if (estimateOnly) {
    await verifyEstimates({
      f,
      python,
      pair,
      source,
      checks,
      visuals,
      nativeRefs,
      admin,
    });
  } else {
    const packPath = "/api/asset-packs";
    const currentPack = specialPack!.body;
    const draft = { name: "current", purpose: "subject", media: [ref] };
    const listOptions = { method: "GET" };
    const importedPacks = await pair(
      "initial imported pack names and descriptions",
      packPath,
      undefined,
      200,
      listOptions,
    );
    assert.deepEqual(
      importedPacks.packs.find((p: any) => p.id === currentPack.id),
      currentPack,
    );

    function withoutGeneratedFields({ id, updated, ...value }: any) {
      assert.match(id, /^[a-f0-9]{32}$/);
      assert.ok(Number.isInteger(updated));
      return value;
    }
    for (const [label, name, description] of [
      ["ordinary", " 普通 ", " 描述 "],
      ["NUL name only", " 名\0字 ", "普通描述"],
      ["NUL description only", "名字", " 描\0述 "],
      ["NUL only", "\0", "\0"],
      ["BOM only", "\ufeff", "\ufeff"],
      [
        "Python whitespace",
        "\u001c\u0085 名字 \u0085\u001c",
        "\u001f 描述 \u0085",
      ],
      ["Unicode length limits", "😀".repeat(60), "😀".repeat(2000)],
      ["literal escapes and media paths", "\\u0000", `/media/${ref}?x=%00`],
    ]) {
      const body = { ...draft, name, description };
      const created = await Promise.all(
        [0, 1].map((i) => request(i, packPath, body)),
      );
      const listed = await Promise.all(
        [0, 1].map((i) => request(i, packPath, undefined, listOptions)),
      );
      for (const [i, reply] of created.entries()) {
        assert.equal(reply.status, 200, label);
        assert.equal(listed[i].status, 200, label);
        assert.deepEqual(
          listed[i].body.packs.find((p: any) => p.id === reply.body.id),
          reply.body,
          label,
        );
      }
      assert.deepEqual(
        withoutGeneratedFields(created[1].body),
        withoutGeneratedFields(created[0].body),
        label,
      );
      checks.push("pack create/list: " + label);
    }
    for (const [label, patch, status] of [
      [
        "whitespace before duplicate",
        { name: "\u001c\u0085", media: [ref, ref] },
        400,
      ],
      ["duplicate before missing", { media: ["missing", "missing"] }, 400],
      ["missing media", { media: ["missing"] }, 404],
      ["lone surrogate name", { name: "\ud800" }, 500],
      ["lone surrogate description", { description: "\udfff" }, 500],
    ] as const)
      await pair(
        "pack rejects " + label,
        packPath,
        { ...draft, ...patch },
        status,
      );
    const currentPath = packPath + "/" + currentPack.id;
    await pair(
      "pack stale edit precedes name and media validation",
      currentPath,
      { ...draft, name: "\u0085", media: [ref, ref], expected_revision: 99 },
      409,
      { method: "PUT" },
    );

    async function editPack(body: unknown) {
      const edits = await Promise.all(
        [0, 1].map((i) => request(i, currentPath, body, { method: "PUT" })),
      );
      for (const edit of edits) {
        assert.equal(edit.status, 200, JSON.stringify(edit.body));
        assert.equal(edit.body.id, currentPack.id);
      }
      assert.deepEqual(
        withoutGeneratedFields(edits[1].body),
        withoutGeneratedFields(edits[0].body),
      );
      return edits[0].body;
    }
    const live = await editPack({
      ...draft,
      ...packText,
      description: packText.description + " updated\0",
      purpose: "outfit",
      media: [visuals[1], ref],
      expected_revision: 1,
    });
    const frozen = await submit("H3 freezes live special pack text", "video", {
      prompt: "\u0085原始提示\u001c",
      refs: [ref],
      asset_packs: [{ id: currentPack.id, revision: live.revision }],
    });
    const snapshot = {
      id: live.id,
      name: live.name,
      revision: live.revision,
      purpose: live.purpose,
      description: live.description,
      media: live.media,
    };
    const originalJob = source("SELECT prompt,refs FROM jobs WHERE id=?", [
      frozen.id,
    ])[0];
    assert.equal(
      originalJob.prompt,
      `原始提示\n\n${live.name}（服装，<Picture 2>, <Picture 1>）：${live.description}`,
    );
    assert.deepEqual(JSON.parse(originalJob.refs), [ref, visuals[1]]);
    const plain = await editPack({
      ...draft,
      name: "plain replacement",
      expected_revision: live.revision,
    });
    const row = await one(
      f.db,
      "SELECT title,pack_text FROM documents WHERE public_id=$1",
      [currentPack.id],
    );
    assert.deepEqual(row, { title: plain.name, pack_text: null });
    const newSpecial = await editPack({
      ...draft,
      name: "\ufeff新\0素材包",
      description: packText.description,
      expected_revision: plain.revision,
    });
    assert.equal(newSpecial.revision, 4);
    const stale = await pair(
      "stale generation includes the current special pack name",
      path("video"),
      { ...frozen.body, uid: randomUUID() },
      409,
    );
    assert.equal(
      stale.detail,
      `素材包“${newSpecial.name}”已更新，请重新选择后生成`,
    );
    await pair(
      "special pack retry keeps the accepted job",
      path("video"),
      frozen.body,
    );
    assert.deepEqual(
      (
        await one(f.db, "SELECT reference_packs FROM jobs WHERE public_id=$1", [
          frozen.id,
        ])
      ).reference_packs,
      [snapshot],
    );
    checks.push(
      "pack updates clear and restore lossless storage; frozen references stay immutable",
    );

    for (const kind of ["video", "image", "audio"]) {
      const base = { uid: randomUUID(), prompt: "fixture" };
      for (const [label, body] of [
        ["missing body", undefined],
        ["null body", null],
        ["empty body", {}],
        ["scalar body", 42],
        ["array body", []],
        ["invalid uid", { ...base, uid: "bad" }],
        ["empty prompt", { ...base, prompt: "" }],
        ["wrong prompt", { ...base, prompt: 7 }],
        ["negative price revision", { ...base, price_revision: 0 }],
        ["fractional parent", { ...base, parent: 1.5 }],
      ] as const)
        await pair(kind + " " + label, path(kind), body, 422, { cookie: "" });
    }
    for (const [label, fields] of [
      ["unsupported model", { model: "absent" }],
      ["wrong kind model", { model: "muse-image" }],
      ["invalid step", { sampling_steps: "4" }],
      ["negative seed", { seed: -1 }],
      ["invalid source", { flow_source_job: 0 }],
      ["bad h3 mode", { h3: { mode: "other" } }],
      ["bad h3 id", { h3: { mode: "frames", first_frame: "x" } }],
      ["extra h3 field", { h3: { mode: "reference", files: [] } }],
      ["bad pack", { asset_packs: [{ id: ref, revision: 0, extra: true }] }],
      [
        "bad h3 list",
        { h3: { mode: "reference", video_audio: [true, 1, null] } },
      ],
    ] as const)
      await pair(
        label,
        path("video"),
        { uid: randomUUID(), prompt: "fixture", ...fields },
        422,
        { cookie: "" },
      );
    for (const prompt of [
      "a\0b 中文😀",
      "\\u0000 \\x00",
      "\ufeffhello\ufeff",
      "\u001chello\u001c",
      "\u0085hello\u0085",
    ]) {
      await submit("special text " + JSON.stringify(prompt), "video", {
        prompt,
      });
    }
    const first = await submit("H3 default submission", "video", {
      refs: [ref],
      sampling_steps: 4,
    });
    await submit("H3 mixed reference limits and trusted metadata", "video", {
      refs: [...visuals, ...nativeRefs],
      h3: { mode: "reference", video_audio: [nativeRefs[0]] },
    });
    await submit("H3 auto ratio without a visual reference", "video", {
      ratio: "auto",
      h3: { mode: "reference" },
    });
    await pair(
      "H3 retry returns original task despite changed content",
      path("video"),
      {
        ...first.body,
        prompt: "changed",
        refs: ["missing"],
        price_revision: 999,
      },
    );
    await pair(
      "H3 pre-retry validation remains ordered",
      path("video"),
      { ...first.body, ratio: "bad" },
      400,
    );
    await pair(
      "H3 identity cannot cross workspaces",
      path("video"),
      first.body,
      404,
      { workspace: "2" },
    );
    await submit("H3 parent inherits omitted sampling steps", "video", {
      parent: first.id,
      refs: [ref],
    });
    await submit("H3 explicit sampling steps override parent", "video", {
      parent: first.id,
      sampling_steps: 20,
    });
    await submit("H3 frames force auto ratio and freeze roles", "video", {
      ratio: "21:9",
      h3: { mode: "frames", first_frame: ref, last_frame: ref },
    });
    await submit("H3 accepts repeated plain references", "video", {
      refs: Array(9).fill(ref),
    });
    const withPack = await submit("H3 freezes pack content", "video", {
      asset_packs: [{ id: pack.body.id, revision: pack.body.revision }],
    });
    await pair("pack retry precedes model draft validation", path("video"), {
      ...withPack.body,
      ratio: "bad",
      asset_packs: [{ id: ref, revision: 999 }],
    });
    await submit("Breeze Chinese defaults", "audio");
    await submit("Breeze English instruction", "audio", {
      prompt: "Hello",
      instruction: "   ",
    });
    await submit("Muse video keeps native parameters", "video", {
      model: "muse-video",
      seconds: 6,
      quality: 999,
    });
    await submit("Muse image ignores native resolution hints", "image", {
      model: "muse-image",
      ratio: "3:4",
      resolution: "2K",
      refs: [ref, ref],
    });
    const image = await submit("image geometry and quality", "image", {
      ratio: "21:9",
      resolution: "2K",
      image_quality: "high",
      refs: [ref],
    });
    const flowVideo = flowOriginal.manifest.models.find(
      (m) =>
        !m.hidden &&
        m.kind === "video" &&
        (m.inputSchema["x-references"] as any).min === 0,
    )!;
    const flowImage = flowOriginal.manifest.models.find(
      (m) => m.kind === "image",
    )!;
    await submit("Flow video descriptor controls output geometry", "video", {
      model: flowVideo.id,
      seconds: 15,
      quality: 999,
      ratio: "ignored",
    });
    await pair(
      "hidden Flow image remains unavailable",
      path("image"),
      {
        uid: randomUUID(),
        prompt: "fixture",
        model: flowImage.id,
        ratio: "ignored",
        resolution: "4K",
        refs: [ref],
      },
      403,
    );
    for (const [kind, label, fields, status] of [
      ["video", "blank H3 prompt", { prompt: " \t" }, 400],
      ["video", "invalid H3 quality", { quality: 1 }, 400],
      ["video", "invalid H3 duration", { seconds: 6 }, 400],
      [
        "video",
        "missing native frame",
        { h3: { mode: "frames", first_frame: "0".repeat(32) } },
        400,
      ],
      [
        "video",
        "native frame rejects non-slot reference",
        { refs: [ref], h3: { mode: "frames" } },
        400,
      ],
      [
        "video",
        "native duplicate reference",
        { refs: [ref, ref], h3: { mode: "reference" } },
        400,
      ],
      [
        "video",
        "native audio role must name a video with sound",
        {
          refs: [...nativeRefs],
          h3: { mode: "reference", video_audio: [nativeRefs[1]] },
        },
        400,
      ],
      [
        "video",
        "H3 plain references reject video",
        { refs: [nativeRefs[0]] },
        400,
      ],
      ["video", "missing parent", { parent: 999999 }, 404],
      ["video", "stale price", { price_revision: 99999 }, 409],
      ["audio", "unknown audio model", { model: "absent" }, 400],
      ["audio", "blank audio prompt", { prompt: "  " }, 400],
      ["audio", "audio seed upper bound", { seed: 4294967296 }, 422],
      ["audio", "audio parent kind", { parent: first.id }, 404],
      [
        "video",
        "Muse native ratio",
        { model: "muse-video", ratio: "21:9" },
        400,
      ],
      [
        "video",
        "Muse native duration",
        { model: "muse-video", seconds: 7 },
        400,
      ],
      [
        "video",
        "Muse sampling steps",
        { model: "muse-video", sampling_steps: 4 },
        400,
      ],
      [
        "image",
        "Muse resolution",
        { model: "muse-image", resolution: "4K" },
        400,
      ],
      ["image", "image duplicate reference", { refs: [ref, ref] }, 400],
      ["image", "image resolution", { resolution: "4K" }, 400],
      [
        "video",
        "Flow cannot accept H3 controls",
        { model: flowVideo.id, h3: { mode: "reference" } },
        400,
      ],
      [
        "video",
        "Flow source only on extension models",
        { model: flowVideo.id, flow_source_job: first.id },
        400,
      ],
    ] as [string, string, Record<string, unknown>, number][])
      await pair(
        label,
        path(kind),
        { uid: randomUUID(), prompt: "fixture", ...fields },
        status,
      );
    // Malformed nested values must preserve every original Pydantic issue/location.
    for (const bad of [
      null,
      0,
      "x",
      [],
      { mode: 4 },
      {
        mode: "reference",
        first_frame: 5,
        last_frame: "X",
        video_audio: [null],
      },
      { mode: "reference", video_audio: Array(4).fill(ref) },
    ])
      if (bad !== null)
        await pair(
          "nested h3 " + JSON.stringify(bad),
          path("video"),
          { uid: randomUUID(), prompt: "fixture", h3: bad },
          422,
          { cookie: "" },
        );
    await submit(
      "integer coercion retains original underscore syntax",
      "video",
      {
        quality: "4_80",
        seconds: "5.0",
        seed: "4_2",
      },
    );
    await pair(
      "withdraw before removing original identity",
      `/api/jobs/${image.id}/cancel`,
      undefined,
    );
    await pair(
      "remove original identity",
      `/api/jobs/${image.id}`,
      undefined,
      200,
      { method: "DELETE" },
    );
    const reused = await pair(
      "deleted original UID can create a new version",
      path("image"),
      image.body,
    );
    assert.notEqual(reused.id, image.id);
    await submit("Breeze special instruction", "audio", {
      prompt: "\ufeffHello\0中文😀",
      instruction: "\u001c\ufeffinstruction\0\\u0000\u0085",
    });
    const beforeInvalid = (
      await f.db.query("SELECT public_id FROM jobs ORDER BY public_id")
    ).rows;
    const beforeWallet = (
      await f.db.query("SELECT balance,held FROM wallets ORDER BY workspace_id")
    ).rows;
    for (const [kind, fields] of [
      ["video", { prompt: "bad\ud800" }],
      ["image", { prompt: "bad\udc00", model: "muse-image" }],
      ["audio", { prompt: "valid", instruction: "bad\ud800" }],
    ] as const) {
      await pair(
        "unpaired surrogate " + kind,
        path(kind),
        { uid: randomUUID(), ...fields },
        500,
      );
    }
    assert.deepEqual(
      (await f.db.query("SELECT public_id FROM jobs ORDER BY public_id")).rows,
      beforeInvalid,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT balance,held FROM wallets ORDER BY workspace_id",
        )
      ).rows,
      beforeWallet,
    );
    await pair(
      "invalid Unicode is rejected before retry",
      path("video"),
      { ...first.body, prompt: "bad\ud800" },
      500,
    );
    // Close isolated queued tasks using the real API before the export guard.
    for (const job of source("SELECT id FROM jobs WHERE status='queued'")) {
      const cancelled = await request(0, `/api/jobs/${job.id}/cancel`);
      assert.equal(cancelled.status, 200);
    }
    // Import the actual Python-created special-text jobs through the full exporter.
    const history = await databaseFixture();
    const historyPath = join(f.directory, "special-history.json");
    try {
      execFileSync(
        python,
        [
          "scripts/export-legacy.py",
          "--database",
          join(f.directory, "data/studio.sqlite"),
          "--output",
          historyPath,
          "--source",
          "special-text-history",
          "--include-registration-codes",
        ],
        { stdio: "pipe" },
      );
      await importLegacy(
        history.p,
        JSON.parse(await readFile(historyPath, "utf8")),
        join(f.directory, "data/objects"),
      );
      for (const old of source("SELECT id,prompt,reference_packs FROM jobs")) {
        const imported = await one(
          history.db,
          "SELECT input,reference_packs FROM jobs WHERE public_id=$1",
          [old.id],
        );
        assert.equal(
          imported.input.prompt,
          old.prompt,
          "Python export/import prompt " + old.id,
        );
        assert.deepEqual(
          imported.reference_packs,
          JSON.parse(old.reference_packs),
          "Python export/import pack snapshot " + old.id,
        );
      }
      const historyIdentity = new OriginalIdentity(history.p);
      const historyActor = await historyIdentity.actor(
        await historyIdentity.login(credentials, "pack-history"),
      );
      const historyPacks = await new OriginalPacks(history.p).list(
        historyActor,
        "1",
      );
      const originalPacks = await request(0, packPath, undefined, listOptions);
      assert.equal(originalPacks.status, 200);
      assert.deepEqual(historyPacks, originalPacks.body);
      checks.push(
        "real Python export/import preserves live packs and frozen generation snapshots",
      );
    } finally {
      await history.cleanup();
    }
    await mkdir(".runtime-advanced/generation-parity", { recursive: true });
    await writeFile(
      ".runtime-advanced/generation-parity/report.json",
      JSON.stringify({ passed: true, checks }, null, 2) + "\n",
    );
    console.log(
      `Original/Nest generation parity: ${checks.length} HTTP and frozen task checks passed`,
    );
  }
} finally {
  await app?.close();
  legacy.kill("SIGTERM");
  if (legacy.exitCode === null)
    await new Promise<void>((r) => legacy.once("exit", () => r()));
  await f.cleanup();
  if (previous === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = previous;
}
