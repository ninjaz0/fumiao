import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import type { HttpTransport } from "@fumiao/platform/plugin-host.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { databaseFixture } from "../helpers/database.js";

test("管理员在 HTTP 路径创建带前缀的连接、只读发现、保存和续编有修订的草稿", async (t) => {
  const f = await databaseFixture();
  t.after(f.cleanup);
  const identity = new OriginalIdentity(f.p);
  const password = "catalog-session-fixture";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const cookie = await identity.login({ name: "admin", password }, "test");
  await identity.createMember(await identity.actor(cookie), {
    name: "member",
    nickname: "成员",
    password,
  });
  const member = await identity.login({ name: "member", password }, "test");
  const testKey = "ordinary.catalog-fixture";
  const requests: { method: string; path: string }[] = [];
  let status = 200;
  let models: unknown[] = [
    { id: "same" },
    { id: "same" },
    { id: "missing-next" },
  ];
  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    requests.push({ method: init.method, path: url.pathname });
    assert.equal(init.headers.Authorization, "Bearer " + testKey);
    if (status === 504) throw new DOMException("upstream", "TimeoutError");
    return {
      status,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ data: models, debug: testKey })),
    };
  };
  const app = await createOriginalApp(f.p, { modelAccessHttp: http });
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const root = (await app.getUrl()) + "/api/admin/model-access";
  async function call(
    method: string,
    suffix = "",
    body?: unknown,
    session = cookie,
  ) {
    const response = await fetch(root + suffix, {
      method,
      headers: {
        Cookie: "fm_session=" + session,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(JSON.stringify(data).includes(testKey), false);
    return { status: response.status, data };
  }
  const create = { base_url: "https://1.1.1.1/team/v1/", api_key: testKey };
  assert.equal((await call("GET", "", undefined, "")).status, 401);
  assert.equal(
    (await call("POST", "/connections", create, member)).status,
    403,
  );
  const added = await call("POST", "/connections", create);
  assert.equal(added.status, 200);
  const c = added.data;
  assert.equal(c.credentials_configured, true);
  assert.equal(c.directory_url, "https://1.1.1.1/team/v1/models");
  assert.equal(requests.length, 0);
  const path = "/connections/" + c.id;
  assert.equal((await call("GET", "", undefined, member)).status, 403);
  assert.equal(
    (
      await call(
        "PATCH",
        path,
        { expected_revision: 1, name: "blocked" },
        member,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("POST", path + "/discover", { expected_revision: 1 }, member))
      .status,
    403,
  );
  const discover = () =>
    call("POST", path + "/discover", { expected_revision: 1 });
  const listed = (await discover()).data;
  assert.deepEqual(
    requests.map((r) => [r.method, r.path]),
    [["GET", "/team/v1/models"]],
  );
  assert.deepEqual(listed.candidates.map((r: any) => r.upstream_id).sort(), [
    "missing-next",
    "same",
  ]);
  const draftPath = "/drafts/" + randomUUID();
  const draft = {
    expected_revision: 0,
    connection_id: c.id,
    connection_revision: 1,
    upstream_id: "manual",
    purpose: "video",
    price: "0.25",
    overrides: { durations: [4, 8] },
  };
  assert.equal((await call("PUT", draftPath, draft, member)).status, 403);
  const saved = await call("PUT", draftPath, draft);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.draft.status, "draft");
  const race = await Promise.all(
    ["new-api-videos", "openrouter-videos"].map((protocol) =>
      call("PUT", draftPath, {
        ...draft,
        expected_revision: 1,
        overrides: { ...draft.overrides, protocol },
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(race.find((r) => r.status === 200)!.data.draft.status, "ready");
  models = [{ id: "same", name: "now named" }, { id: "new" }];
  const changed = (await discover()).data.candidates;
  assert.deepEqual(
    Object.fromEntries(changed.map((r: any) => [r.upstream_id, r.change])),
    { same: "changed", new: "added", "missing-next": "missing" },
  );
  for (const [code, expected] of [
    [403, "forbidden"],
    [401, "invalid_credentials"],
    [504, "timeout"],
    [200, "empty"],
  ] as const) {
    status = code;
    models = [];
    assert.equal((await discover()).data.directories.models, expected);
  }
  const refreshed = (await call("GET")).data;
  assert.equal(refreshed.drafts[0].price, "0.25");
  assert.equal(refreshed.drafts[0].revision, 2);
  assert.equal(
    (
      await call("PATCH", path, {
        expected_revision: 1,
        base_url: "https://1.1.1.1/another",
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("PATCH", path, { expected_revision: 1, api_key: "rotated" }))
      .status,
    200,
  );
  assert.equal(
    (await call("PATCH", path, { expected_revision: 1, name: "late" })).status,
    409,
  );
  assert.equal((await discover()).status, 409);
  assert.equal(
    (await call("PUT", draftPath, { ...draft, expected_revision: 2 })).status,
    409,
  );
  assert.ok(requests.every((r) => r.method === "GET"));
  const stored = await f.db.query(
    "select * from model_access_connection_revisions where connection_id=$1",
    [c.id],
  );
  assert.equal(stored.rows.length, 2);
  assert.equal(JSON.stringify(stored.rows).includes(testKey), false);
});

test("OpenRouter 合并专用目录，保留有界参数、歧义和部分失败的资料", async () => {
  const { discoverModels } =
    await import("@fumiao/platform/model-access/discovery.js");
  const image = {
    id: "studio/edit",
    architecture: { input_modalities: ["image"], output_modalities: ["image"] },
    supported_parameters: {
      input_references: { type: "range", min: 1, max: 5 },
      aspect_ratio: { type: "enum", values: ["1:1", "16:9"] },
    },
  };
  const docs = {
    models: [
      {
        id: "studio/vision",
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
        context_length: 8192,
        top_provider: { max_completion_tokens: 2048 },
        supported_parameters: ["tools"],
      },
      {
        id: "studio/edit",
        architecture: { output_modalities: ["text", "image"] },
        pricing: { prompt: "79" },
      },
      {
        id: "studio/auto",
        architecture: { output_modalities: ["text", "image"] },
      },
    ],
    "images/models": [image],
    "videos/models": [
      {
        id: "studio/movie",
        supported_durations: [-1, 4, 8],
        supported_sizes: ["1280x720"],
        supported_frame_images: ["first_frame", "last_frame"],
      },
      {
        id: "studio/unknown",
        supported_durations: null,
        supported_frame_images: null,
      },
      {
        id: "studio/upscale",
        upscale_factor: { min: 1.5, max: 3 },
        supported_durations: null,
      },
    ],
  };
  let denyImages = false;
  const paths: string[] = [];
  const read = (previous?: Awaited<ReturnType<typeof discoverModels>>) =>
    discoverModels(
      "https://openrouter.ai/api/v1",
      async (path) => {
        paths.push(path);
        return {
          status: denyImages && path === "images/models" ? 403 : 200,
          contentType: "application/json",
          body: Buffer.from(JSON.stringify({ data: docs[path] })),
        };
      },
      () => false,
      previous,
    );
  const first = await read();
  assert.deepEqual(paths, ["models", "images/models", "videos/models"]);
  const by = (id: string) =>
    first.candidates.find((c) => c.upstream_id === "studio/" + id)!;
  assert.equal(first.candidates.length, 6);
  assert.equal(by("vision").purpose, "chat");
  assert.equal(by("vision").parameters.context_length, 8192);
  assert.equal(by("vision").parameters.max_completion_tokens, 2048);
  assert.equal(by("auto").purpose, null);
  assert.deepEqual(by("auto").parameters.output_modalities, ["text", "image"]);
  assert.deepEqual(by("edit").directories, ["models", "images/models"]);
  assert.equal(by("edit").purpose_source, "image_directory");
  assert.deepEqual(
    by("edit").parameters.definitions,
    image.supported_parameters,
  );
  assert.equal(JSON.stringify(first).includes("pricing"), false);
  assert.deepEqual(by("movie").parameters.durations, [4, 8]);
  assert.deepEqual(by("movie").parameters.frame_images, [
    "first_frame",
    "last_frame",
  ]);
  assert.equal(by("movie").parameters.automatic_duration, true);
  assert.equal(by("unknown").metadata_status, "needs_confirmation");
  assert.equal(by("upscale").parameters.upscale_only, true);
  const second = await read(JSON.parse(JSON.stringify(first)));
  assert.ok(second.candidates.every((c) => c.change === "unchanged"));
  denyImages = true;
  const partial = await read(second);
  assert.equal(partial.directories["images/models"], "forbidden");
  assert.equal(
    partial.candidates.find((c) => c.upstream_id === "studio/edit")
      ?.metadata_status,
    "stale",
  );
  assert.equal(
    partial.candidates.find((c) => c.upstream_id === "studio/movie")
      ?.metadata_status,
    "declared",
  );
});

test("加密凭据修订绑定目标和端点，旧修订续用，宿主二进制请求保留原始字节", async (t) => {
  const { ModelAccessConnections, resolveConnectionRevision } =
    await import("@fumiao/platform/model-access/connections.js");
  const f = await databaseFixture();
  t.after(f.cleanup);
  const service = new ModelAccessConnections(f.db, f.p.vault);
  for (const invalid of [
    "http://1.1.1.1/v1",
    "https://127.0.0.1",
    "https://localhost/v1",
    "https://user:pass@1.1.1.1/v1",
    "https://1.1.1.1/v1?token=example",
  ]) {
    await assert.rejects(
      service.create({ base_url: invalid, api_key: "ordinary" }),
      { status: 400 },
    );
  }
  const base = "https://1.1.1.1/team/v1";
  const c = await service.create({ base_url: base, api_key: "old-fixture" });
  const updated = await service.edit(c.id, {
    expected_revision: 1,
    base_url: "https://1.0.0.1/new",
    api_key: "new-fixture",
  });
  const requests: {
    url: URL;
    body?: string | Uint8Array;
    authorization: string;
  }[] = [];
  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    requests.push({
      url,
      body: init.body,
      authorization: init.headers.Authorization,
    });
    return {
      status: 200,
      contentType: "application/json",
      body: Buffer.from("{}"),
    };
  };
  const prev = await resolveConnectionRevision(
    f.db,
    f.p.vault,
    c.revision_id,
    http,
  );
  const now = await resolveConnectionRevision(
    f.db,
    f.p.vault,
    updated.revision_id,
    http,
  );
  const signal = AbortSignal.timeout(1000);
  const bytes = Buffer.from([0, 128, 255, 10]);
  await prev.request(
    {
      method: "POST",
      endpoint: "images/edits",
      body: bytes,
      content_type: "application/octet-stream",
    },
    signal,
  );
  await now.request({ method: "GET", endpoint: "models" }, signal);
  assert.equal(requests[0].url.href, base + "/images/edits");
  assert.equal(requests[0].authorization, "Bearer old-fixture");
  assert.deepEqual(requests[0].body, bytes);
  assert.equal(requests[1].url.href, "https://1.0.0.1/new/models");
  assert.equal(requests[1].authorization, "Bearer new-fixture");
  await assert.rejects(
    f.db.query(
      "UPDATE model_access_connection_revisions SET config='x' WHERE id=$1",
      [c.revision_id],
    ),
    /immutable/,
  );
  // A future migration can mint a revision with a narrower, original grant.
  const limitedId = randomUUID();
  await f.db.query(
    "INSERT INTO model_access_connection_revisions(id,connection_id,revision,config,credential_scope) VALUES($1,$2,3,$3,$4)",
    [
      limitedId,
      c.id,
      f.p.vault.seal({
        base_url: base,
        api_key: "borrowed",
        default_video_protocol: null,
      }),
      JSON.stringify({
        endpoints: ["models", "chat/completions"],
        upstream_ids: ["only-this"],
      }),
    ],
  );
  const limited = await resolveConnectionRevision(
    f.db,
    f.p.vault,
    limitedId,
    http,
  );
  await assert.rejects(
    limited.request(
      { endpoint: "images", method: "POST", model: "only-this" },
      signal,
    ),
    { status: 403 },
  );
  await assert.rejects(
    limited.request(
      {
        endpoint: "chat/completions",
        method: "POST",
        model: "only-this",
        body: JSON.stringify({ model: "other" }),
        content_type: "application/json",
      },
      signal,
    ),
    { status: 403 },
  );
  assert.equal(requests.length, 2);
  await limited.request(
    {
      endpoint: "chat/completions",
      method: "POST",
      model: "only-this",
      body: '{"model":"only-this"}',
      content_type: "application/json",
    },
    signal,
  );
  assert.equal(requests[2].authorization, "Bearer borrowed");
});

test("自建视频按单条覆盖、已确认连接默认值、待确认取格式，缺项可续编且同名跨连接独立", async (t) => {
  const { ModelAccessConnections } =
    await import("@fumiao/platform/model-access/connections.js");
  const f = await databaseFixture();
  t.after(f.cleanup);
  const service = new ModelAccessConnections(f.db, f.p.vault);
  const create = { base_url: "https://1.1.1.1/v1", api_key: "custom-key" };
  const a = await service.create({
    ...create,
    default_video_protocol: "new-api-videos",
  });
  const b = await service.create(create);
  const selection = {
    expected_revision: 0,
    connection_id: a.id,
    connection_revision: 1,
    upstream_id: "same",
    purpose: "video",
    price: "0",
    overrides: { durations: [4] },
  };
  const fromDefault = (await service.saveDraft(randomUUID(), selection)).draft;
  assert.equal(fromDefault.protocol, "new-api-videos");
  assert.equal(fromDefault.status, "ready");
  const unresolved = (
    await service.saveDraft(randomUUID(), { ...selection, connection_id: b.id })
  ).draft;
  assert.equal(unresolved.protocol, null);
  assert.equal(unresolved.status, "draft");
  const exception = (
    await service.saveDraft(randomUUID(), {
      ...selection,
      upstream_id: "exception",
      overrides: {
        protocol: "openrouter-videos",
        duration_range: { min: 2, max: 12 },
      },
    })
  ).draft;
  assert.equal(exception.protocol, "openrouter-videos");
  assert.equal(exception.status, "ready");
  const incomplete = (
    await service.saveDraft(randomUUID(), {
      ...selection,
      upstream_id: "untimed",
      overrides: {},
    })
  ).draft;
  assert.deepEqual(incomplete.missing, ["durations"]);
  const chat = (
    await service.saveDraft(randomUUID(), {
      ...selection,
      upstream_id: "dialogue",
      purpose: "chat",
      price: null,
      chat_prices: {
        input: "0",
        output: "0.5",
        cache_read: null,
        cache_write: "0",
      },
    })
  ).draft;
  assert.deepEqual(chat.chat_prices, {
    input: "0",
    output: "0.5",
    cache_read: null,
    cache_write: "0",
  });
  assert.equal(chat.status, "ready");
  const badPrice = { ...selection, upstream_id: "invalid", price: "0.0000001" };
  await assert.rejects(service.saveDraft(randomUUID(), badPrice), {
    status: 400,
  });
  const again = (await service.view()).drafts;
  assert.ok(again.some((d) => d.status === "ready"));
  assert.ok(again.some((d) => d.status === "draft"));
});

test("从 056 升级保留旧连接的插件、配置和修订，数据库拒绝混合来源", async (t) => {
  const { migrate } = await import("@fumiao/platform/db.js");
  const f = await databaseFixture("056_credit_precision.sql");
  t.after(f.cleanup);
  const id = randomUUID();
  const config = f.p.vault.seal({ example: "legacy" });
  await f.db.query(
    "INSERT INTO plugin_versions(id,version,manifest) VALUES('fixture-legacy','1','{}')",
  );
  await f.db.query(
    "INSERT INTO connections(id,name,plugin_id,plugin_version,config,revision) VALUES($1,'existing','fixture-legacy','1',$2,7)",
    [id, config],
  );
  await migrate(f.db);
  const row = (
    await f.db.query(
      "SELECT plugin_id,plugin_version,source_kind,config,revision FROM connections WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(row, {
    plugin_id: "fixture-legacy",
    plugin_version: "1",
    source_kind: "plugin",
    config,
    revision: 7,
  });
  await assert.rejects(
    f.db.query("UPDATE connections SET plugin_id=NULL WHERE id=$1", [id]),
    { code: "23514" },
  );
  await assert.rejects(
    f.db.query("UPDATE connections SET source_kind='builtin' WHERE id=$1", [
      id,
    ]),
    { code: "23514" },
  );
});

test("并发刷新和改地址拒绝迟到结果，设置默认格式保留同一目的地的目录", async (t) => {
  const { ModelAccessConnections } =
    await import("@fumiao/platform/model-access/connections.js");
  const f = await databaseFixture();
  t.after(f.cleanup);
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }
  let entered = gate();
  let release = gate();
  let slow = true;
  const http: HttpTransport<string | Uint8Array> = async () => {
    const id = slow ? "older-result" : "current-result";
    if (slow) {
      entered.resolve();
      await release.promise;
    }
    return {
      status: 200,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ data: [{ id }] })),
    };
  };
  const s = new ModelAccessConnections(f.db, f.p.vault, http);
  const c = await s.create({
    base_url: "https://1.1.1.1/prefix",
    api_key: "key",
  });
  const old = s.discover(c.id, { expected_revision: 1 });
  await entered.promise;
  slow = false;
  await s.discover(c.id, { expected_revision: 1 });
  release.resolve();
  await assert.rejects(old, { status: 409 });
  await s.edit(c.id, {
    expected_revision: 1,
    default_video_protocol: "new-api-videos",
  });
  assert.equal(
    (await s.view()).discoveries[0].candidates[0].upstream_id,
    "current-result",
  );
  slow = true;
  entered = gate();
  release = gate();
  const beforeRotation = s.discover(c.id, { expected_revision: 2 });
  await entered.promise;
  await s.edit(c.id, {
    expected_revision: 2,
    base_url: "https://1.0.0.1/next",
    api_key: "new-key",
  });
  release.resolve();
  await assert.rejects(beforeRotation, { status: 409 });
  assert.deepEqual((await s.view()).discoveries, []);
});

test("普通密钥与本地字段重名时仍可发现，忽略上游反射密钥的行", async (t) => {
  const { ModelAccessConnections } =
    await import("@fumiao/platform/model-access/connections.js");
  const f = await databaseFixture();
  t.after(f.cleanup);
  const service = new ModelAccessConnections(
    f.db,
    f.p.vault,
    async (_url, init) => {
      const key = init.headers.Authorization.slice("Bearer ".length);
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from(
          JSON.stringify({
            data: [
              { id: "tiny-model" },
              { id: "bad-name", name: "Bearer " + key },
              { id: "bad-parameter", supported_parameters: [key] },
            ],
          }),
        ),
      };
    },
  );
  for (const key of ["parameters", "name"]) {
    const c = await service.create({
      base_url: "https://1.1.1.1/v1",
      api_key: key,
    });
    const result = await service.discover(c.id, { expected_revision: 1 });
    assert.deepEqual(
      result.candidates.map((m) => m.upstream_id),
      ["tiny-model"],
    );
  }
});

test("管理员可为目录漏列的 OpenRouter 图片模型确认专用协议，内置连接保留空站插件配置", async (t) => {
  const { ModelAccessConnections } =
    await import("@fumiao/platform/model-access/connections.js");
  const f = await databaseFixture();
  t.after(f.cleanup);
  const id = randomUUID();
  await f.db.query(
    "INSERT INTO connections(id,name,source_kind,config,enabled) VALUES($1,'fixture','builtin',$2,true)",
    [id, f.p.vault.seal({})],
  );
  await f.db.query(
    "INSERT INTO model_access_connection_revisions(id,connection_id,revision,config,credential_scope) VALUES($1,$2,1,$3,$4)",
    [
      randomUUID(),
      id,
      f.p.vault.seal({
        base_url: "https://openrouter.ai/api/v1",
        api_key: "private-fixture",
        default_video_protocol: null,
      }),
      JSON.stringify({
        endpoints: ["models", "images/models", "videos/models", "images"],
        upstream_ids: null,
      }),
    ],
  );
  const s = new ModelAccessConnections(f.db, f.p.vault);
  const manual = {
    expected_revision: 0,
    connection_id: id,
    connection_revision: 1,
    upstream_id: "manual/image",
    purpose: "image",
    price: "0.1",
  };
  const draftId = randomUUID();
  assert.equal((await s.saveDraft(draftId, manual)).draft.status, "draft");
  const saved = (
    await s.saveDraft(draftId, {
      ...manual,
      expected_revision: 1,
      overrides: { protocol: "openrouter-images" },
    })
  ).draft;
  assert.equal(saved.protocol, "openrouter-images");
  assert.equal(saved.status, "ready");
  await f.p.registry.initializeStudio(f.db, false);
  assert.equal(
    (await f.db.query("SELECT mode FROM studio_plugin_profile")).rows[0].mode,
    "explicit",
  );
});
