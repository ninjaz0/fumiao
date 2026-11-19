import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { join } from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { one } from "../packages/platform/src/db.js";
import type { Actor, Platform } from "../packages/platform/src/platform.js";
import type { chatProviderFixture } from "../tests/helpers/chat-provider.js";
import type { studioPayment } from "./studio-nest-payment.js";
import {
  prepareStudioMediaRestore,
  until,
  type FixtureMedia,
  type mediaProviderFixture,
} from "./studio-nest-restore-media.js";

type Bucket = {
  endpoint: string;
  bucket: string;
  openClient(): S3Client;
};
type ObjectRecord = {
  key: string;
  size: number;
  sha256: string;
  contentType?: string;
  metadata?: Record<string, string>;
};

const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const timeout = () => ({ abortSignal: AbortSignal.timeout(10_000) });

async function objectKeys(client: S3Client, bucket: string) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      timeout(),
    );
    for (const entry of page.Contents ?? []) {
      assert.ok(entry.Key);
      keys.push(entry.Key);
    }
    token = page.NextContinuationToken;
    assert.equal(Boolean(token), Boolean(page.IsTruncated));
  } while (token);
  return keys.sort();
}

async function readObject(client: S3Client, bucket: string, key: string) {
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    timeout(),
  );
  const bytes = await object.Body!.transformToByteArray();
  assert.equal(bytes.length, object.ContentLength);
  const record: ObjectRecord = {
    key,
    size: bytes.length,
    sha256: checksum(bytes),
    contentType: object.ContentType,
    metadata: object.Metadata,
  };
  return { bytes, record };
}

/** Export bytes by object key, without depending on the bucket's local volumes. */
export async function backupStudioObjects(source: Bucket, directory: string) {
  const files = join(directory, "objects");
  await mkdir(files, { mode: 0o700 });
  const client = source.openClient();
  try {
    const keys = await objectKeys(client, source.bucket);
    assert.equal(keys.length, 2);
    const manifest: ObjectRecord[] = [];
    for (const [index, key] of keys.entries()) {
      const { bytes, record } = await readObject(client, source.bucket, key);
      await writeFile(join(files, String(index)), bytes, { mode: 0o600 });
      manifest.push(record);
    }
    await writeFile(join(directory, "objects.json"), JSON.stringify(manifest), {
      mode: 0o600,
    });
    return manifest.length;
  } finally {
    client.destroy();
  }
}

export async function restoreStudioObjects(target: Bucket, directory: string) {
  const manifest: ObjectRecord[] = JSON.parse(
    await readFile(join(directory, "objects.json"), "utf8"),
  );
  const client = target.openClient();
  try {
    for (const [index, record] of manifest.entries()) {
      const bytes = await readFile(join(directory, "objects", String(index)));
      assert.equal(bytes.length, record.size);
      assert.equal(checksum(bytes), record.sha256);
      await client.send(
        new PutObjectCommand({
          Bucket: target.bucket,
          Key: record.key,
          Body: bytes,
          ContentType: record.contentType,
          Metadata: record.metadata,
        }),
        timeout(),
      );
      assert.deepEqual(
        (await readObject(client, target.bucket, record.key)).record,
        record,
      );
    }
    assert.deepEqual(
      await objectKeys(client, target.bucket),
      manifest.map(({ key }) => key),
    );
  } finally {
    client.destroy();
  }
}

export async function restoreSnapshot(
  platform: Platform,
  includeQueueHealth = true,
) {
  const tables = [
    "users",
    "workspaces",
    "members",
    "sessions",
    "wallets",
    "ledger",
    "payment_channels",
    "original_recharge_orders",
    "assets",
    "connections",
    "plugin_versions",
    "studio_catalog",
    "studio_policy",
    "studio_prices",
    "jobs",
    "job_runs",
    "job_assets",
    "job_events",
    "outbox",
    "gpu_nodes",
    "gpu_pairings",
    "documents",
    "document_assets",
    "canvas_documents",
    "canvas_nodes",
    "chat_conversations",
    "chat_messages",
    "chat_turns",
    "chat_charges",
    "chat_outbox",
    "schema_migrations",
  ];
  const { system_identifier: cluster } = await one(
    platform.db,
    "SELECT system_identifier FROM pg_control_system()",
  );
  const rows = Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => {
        // The live worker refreshes provider health independently of replay.
        const record =
          table === "connections" && !includeQueueHealth
            ? "(to_jsonb(t) - '{queue_health,queue_health_revision,queue_refresh_token,queue_refresh_until}'::text[])"
            : "row_to_json(t)";
        const { rows } = await platform.db.query(
          `SELECT ${record}::text AS snapshot FROM ${table} t ORDER BY snapshot`,
        );
        return [table, rows.map(({ snapshot }) => snapshot)];
      }),
    ),
  );
  return { cluster, rows };
}

function studio(origin: string, cookie = "") {
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const binary = body instanceof Uint8Array;
    const response = await fetch(origin + path, {
      method,
      redirect: "manual",
      headers: {
        origin,
        cookie,
        ...(body === undefined
          ? {}
          : {
              "content-type": binary ? "image/png" : "application/json",
            }),
        ...extra,
      },
      body: binary ? new Uint8Array(body) : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.headers.get("x-fumiao-web"), "next", path);
    return response;
  }
  async function json(response: Response, status = 200) {
    const data = await response.json();
    assert.equal(
      response.status,
      status,
      response.url + " " + JSON.stringify(data),
    );
    return data;
  }
  async function signIn(path: string, body: object) {
    const response = await request(path, "POST", body);
    assert.deepEqual(await json(response), { ok: true });
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.match(cookie, /^fm_session=.+$/);
  }
  return {
    get cookie() {
      return cookie;
    },
    request,
    json,
    signIn,
    read: async (path: string) => json(await request(path)),
    write: async (path: string, body: unknown, method = "POST") =>
      json(await request(path, method, body)),
  };
}

export type StudioClient = ReturnType<typeof studio>;

async function verifyMedia(
  client: ReturnType<typeof studio>,
  other: ReturnType<typeof studio>,
  anonymous: ReturnType<typeof studio>,
  s3: Bucket,
  media: FixtureMedia,
) {
  const path = "/media/" + media.id;
  for (const [denied, status] of [
    [anonymous, 401],
    [other, 404],
  ] as const) {
    const response = await denied.request(path);
    assert.equal(response.headers.get("location"), null);
    await denied.json(response, status);
  }
  const options = {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  } as const;
  const requestRange = { range: "bytes=3-18" };
  for (const headers of [{}, requestRange] as Record<string, string>[]) {
    const redirect = await client.request(path, "GET", undefined, headers);
    assert.equal(redirect.status, 307);
    const signed = new URL(redirect.headers.get("location")!);
    assert.equal(signed.origin, s3.endpoint);
    assert.equal(signed.pathname, `/${s3.bucket}/${media.key}`);
    assert.match(
      signed.searchParams.get("X-Amz-Signature") ?? "",
      /^[a-f0-9]{64}$/,
    );
    await redirect.body?.cancel();
    const response = await fetch(signed, { ...options, headers });
    assert.equal(response.headers.get("content-type"), media.mime);
    if (headers.range) {
      assert.equal(response.status, 206);
      assert.equal(
        response.headers.get("content-range"),
        `bytes 3-18/${media.bytes.length}`,
      );
      assert.deepEqual(
        Buffer.from(await response.bytes()),
        media.bytes.subarray(3, 19),
      );
    } else {
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.bytes()), media.bytes);
      const unsigned = await fetch(
        new URL(signed.pathname, signed.origin),
        options,
      );
      assert.equal(unsigned.status, 403);
      await unsigned.body?.cancel();
    }
  }
}

function merchantCheckout(
  url: URL,
  certificate: Buffer,
  returnOrigin: string,
  order: string,
) {
  return new Promise<void>((resolve, reject) => {
    const request = get(
      url,
      { ca: certificate, signal: AbortSignal.timeout(5000) },
      (response) => {
        response.resume();
        try {
          assert.equal(response.statusCode, 303);
          assert.equal(
            response.headers.location,
            `${returnOrigin}/payments/return?out_trade_no=${order}`,
          );
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
  });
}

async function reconcileWallets(platform: Platform) {
  const result = await platform.db.query(
    `SELECT w.public_id,w.name,b.balance,b.held,l.balance_snapshot,l.held_snapshot
      FROM wallets b JOIN workspaces w ON w.id=b.workspace_id
      LEFT JOIN LATERAL (
        SELECT balance_snapshot,held_snapshot FROM ledger
        WHERE workspace_id=w.id ORDER BY public_id DESC NULLS LAST LIMIT 1
      ) l ON true ORDER BY w.public_id`,
  );
  assert.ok(result.rows.length >= 2);
  for (const row of result.rows) {
    assert.equal(row.balance, row.balance_snapshot ?? "0", row.name);
    assert.equal(row.held, row.held_snapshot ?? "0", row.name);
  }
}

export async function prepareStudioRestore(
  source: Platform,
  origin: string,
  s3: Bucket,
  user: { name: string; password: string },
  payment: Awaited<ReturnType<typeof studioPayment>>,
  provider: Awaited<ReturnType<typeof chatProviderFixture>>,
  mediaProvider: Awaited<ReturnType<typeof mediaProviderFixture>>,
  pauseWorker: () => void,
) {
  const client = studio(origin);
  const member = studio(origin);
  const anonymous = studio(origin);
  const admin = (await one(
    source.db,
    "SELECT id,name,nickname,role FROM users WHERE name=$1",
    [user.name],
  )) as Actor;
  await payment.configure(source, admin);
  await client.signIn("/api/login", user);
  const page = await client.request("/studio");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src="\/_next\/static\//);
  const invite = () =>
    client.write("/api/invite-codes", {
      name: "Restore fixture",
      expires: null,
      grant_credits: false,
      initial_credits: 0,
      team_id: null,
    });
  const idOf = async (session: ReturnType<typeof studio>) => {
    const { me, workspace_id } = await session.read("/api/state");
    assert.ok(Number.isSafeInteger(me.id) && me.id > 0);
    assert.ok(Number.isSafeInteger(workspace_id) && workspace_id > 0);
    return { user: me.id, name: me.name, workspace: workspace_id };
  };
  const state = await idOf(client);
  await member.signIn("/api/register", {
    name: "restore-member",
    nickname: "恢复测试成员",
    password: randomBytes(18).toString("base64url"),
    code: (await invite()).code,
  });
  const memberState = await idOf(member);
  assert.notEqual(memberState.workspace, state.workspace);

  const media: FixtureMedia[] = [];
  for (const background of ["#84aabe", "#3672a1"]) {
    const png = await sharp({
      create: { width: 24, height: 24, channels: 3, background },
    })
      .png()
      .toBuffer();
    const { id } = await client.write("/api/assets", png);
    assert.match(id, /^[a-f0-9]{32}$/);
    const { object_key: key } = await one(
      source.db,
      "SELECT object_key FROM assets WHERE public_id=$1",
      [id],
    );
    const item = { id, key, bytes: png, mime: "image/png" };
    await verifyMedia(client, member, anonymous, s3, item);
    media.push(item);
  }

  const canvas = await client.write("/api/canvases", { title: "备份恢复画布" });
  const canvasPath = "/api/canvases/" + canvas.id;
  const canvasEdit = {
    title: canvas.title,
    expected_revision: canvas.revision,
    document: {
      nodes: [
        { id: "script", type: "text", x: 20, y: 10, text: "备份恢复验收" },
        { id: "image", type: "image", x: 460, y: 10, media_id: media[0].id },
      ],
      edges: [{ id: "script-image", source: "script", target: "image" }],
    },
  };
  await client.write(canvasPath + "/document", canvasEdit, "PUT");
  const canvasBefore = await client.read(canvasPath);
  assert.equal(canvasBefore.revision, canvas.revision + 1);
  assert.equal(canvasBefore.document.nodes[1].media_id, media[0].id);

  const orderRequest = {
    yuan: 1,
    workspace: state.workspace,
    method: "alipay",
    uid: randomUUID(),
  };
  const pending = await client.write("/api/recharge/orders", orderRequest);
  assert.equal(pending.state, "pending");
  const checkout = await client.request(pending.payment_url);
  assert.equal(checkout.status, 303);
  const gateway = new URL(checkout.headers.get("location")!);
  assert.equal(gateway.origin, payment.origin);
  await checkout.body?.cancel();
  await merchantCheckout(
    gateway,
    await readFile(payment.certificate),
    origin,
    pending.id,
  );
  const orderPath = "/api/recharge/orders/" + pending.id;
  const paid = await client.read(orderPath);
  assert.equal(paid.state, "paid");
  assert.equal(paid.credits, 10);
  await payment.verifyCallback(paid.id);
  const rechargeBefore = await client.read("/api/recharge");

  async function chat(text: string) {
    const { conversation } = await client.write("/api/chats", {});
    const { pricing } = await client.read("/api/chat/config");
    const path = "/api/chats/" + conversation.id;
    const draft = {
      text,
      uid: randomUUID(),
      model: "deepseek-flash",
      expected_revision: conversation.revision,
      price_revision: pricing.revision,
    };
    const accepted = await client.write(path + "/messages", draft);
    assert.equal(accepted.messages.at(-1).state, "running");
    return { path, draft };
  }
  const streams = () =>
    provider.requests
      .filter(({ body }) => body?.stream)
      .map(({ body }) => body.messages.at(-1).content);
  const completed = await chat("停写前已结算");
  const waitForChat = (
    session: ReturnType<typeof studio>,
    path: string,
    state: string,
    ms?: number,
  ) =>
    until(
      `Chat ${state}`,
      async () => {
        const view = await session.read(path);
        return view.messages.at(-1).state === state ? view : undefined;
      },
      ms,
    );
  const history = await waitForChat(client, completed.path, "complete");
  assert.equal(history.messages.at(-1).content, "隔离验收回复");
  const cleanCredit = await client.read("/api/credits");
  assert.equal(cleanCredit.wallet.reserved, 0);
  assert.deepEqual(
    cleanCredit.history
      .filter((row: { action: string }) => row.action === "recharge")
      .map((row: { amount: number }) => row.amount),
    [10],
  );

  const durableTurn = (uid: string) =>
    one(
      source.db,
      `SELECT t.started,t.lease_token,t.lease_until,o.sent_at,c.state
     FROM chat_turns t JOIN chat_charges c ON c.turn_id=t.id
     JOIN chat_outbox o ON o.turn_id=t.id WHERE t.uid=$1`,
      [uid],
    );
  provider.stallNextStream();
  const interrupted = await chat("已请求上游但无回执");
  await until("Source chat reached its upstream", async () =>
    streams().includes(interrupted.draft.text) ? true : undefined,
  );
  const inflight = await prepareStudioMediaRestore(
    source,
    client,
    admin,
    mediaProvider,
  );
  pauseWorker();
  await inflight.checkpoint();
  const queued = await chat("停机时尚未提交上游");
  const runningRow = await durableTurn(interrupted.draft.uid);
  assert.equal(runningRow.state, "held");
  assert.ok(
    runningRow.started &&
      runningRow.lease_token &&
      runningRow.lease_until > Date.now() / 1000,
  );
  assert.deepEqual(await durableTurn(queued.draft.uid), {
    started: null,
    lease_token: null,
    lease_until: null,
    sent_at: null,
    state: "held",
  });
  assert.deepEqual(streams(), [completed.draft.text, interrupted.draft.text]);
  await reconcileWallets(source);
  console.log(
    "Source checkpoint includes settled data, claimed and unclaimed chats, Muse task IDs, Flow receipts, unknown submissions and ordinary GPU leases.",
  );

  return async (target: Platform, targetOrigin: string, targetS3: Bucket) => {
    const recovered = studio(targetOrigin, client.cookie);
    const recoveredMember = studio(targetOrigin, member.cookie);
    const { outputs, spent } = await inflight.verify(target, recovered);
    assert.deepEqual(await idOf(recovered), state);
    assert.deepEqual(await idOf(recoveredMember), memberState);
    const fresh = studio(targetOrigin);
    await fresh.signIn("/api/login", user);
    assert.notEqual(fresh.cookie, client.cookie);
    assert.deepEqual(await idOf(fresh), state);
    const restoredPage = await fresh.request("/studio");
    assert.equal(restoredPage.status, 200);
    assert.ok(
      restoredPage.headers
        .get("content-security-policy")
        ?.includes(targetS3.endpoint),
    );
    assert.match(await restoredPage.text(), /src="\/_next\/static\//);
    const newMember = studio(targetOrigin);
    const { code } = await recovered.write("/api/invite-codes", {
      name: "Restore sequence fixture",
      expires: null,
      grant_credits: false,
      initial_credits: 0,
      team_id: null,
    });
    await newMember.signIn("/api/register", {
      name: "restore-new-member",
      nickname: "恢复后新增成员",
      password: randomBytes(18).toString("base64url"),
      code,
    });
    const newIds = await idOf(newMember);
    assert.ok(newIds.user > Math.max(state.user, memberState.user));
    assert.ok(
      newIds.workspace > Math.max(state.workspace, memberState.workspace),
    );
    await recoveredMember.json(
      await recoveredMember.request("/api/state", "GET", undefined, {
        "x-workspace-id": String(state.workspace),
      }),
      403,
    );
    for (const item of [...media, ...outputs])
      await verifyMedia(
        fresh,
        recoveredMember,
        studio(targetOrigin),
        targetS3,
        item,
      );
    const restoredKeys = [...media, ...outputs].map(({ key }) => key).sort();
    async function verifyBucket() {
      const assets = await target.db.query("SELECT object_key FROM assets");
      assert.deepEqual(
        assets.rows.map(({ object_key }) => object_key).sort(),
        restoredKeys,
      );
      const s3Client = targetS3.openClient();
      try {
        assert.deepEqual(
          await objectKeys(s3Client, targetS3.bucket),
          restoredKeys,
        );
      } finally {
        s3Client.destroy();
      }
    }
    await verifyBucket();
    assert.deepEqual(await recovered.read(canvasPath), canvasBefore);
    await recovered.json(
      await recovered.request(canvasPath + "/document", "PUT", canvasEdit),
      409,
    );
    assert.deepEqual(await recovered.read(canvasPath), canvasBefore);
    await recoveredMember.json(await recoveredMember.request(canvasPath), 404);
    assert.deepEqual(await recovered.read(completed.path), history);
    assert.deepEqual(await recovered.read("/api/recharge"), rechargeBefore);
    assert.deepEqual(await recovered.read(orderPath), paid);
    console.log(
      "Restored old sessions, fresh login, public IDs and sequences, private full and ranged bytes, canvas revisions, completed chat, and paid order history.",
    );

    const restoredQueue = await waitForChat(recovered, queued.path, "complete");
    assert.equal(restoredQueue.messages.at(-1).content, "隔离验收回复");
    await waitForChat(recovered, interrupted.path, "interrupted", 70_000);
    const after = await recovered.read("/api/credits");
    assert.equal(after.wallet.reserved, 0);
    const actions = async (uid: string) =>
      (
        await target.db.query(
          `SELECT l.action FROM ledger l JOIN chat_turns t ON t.id=l.chat_turn_id
       WHERE t.uid=$1 ORDER BY l.public_id`,
          [uid],
        )
      ).rows.map(({ action }) => action);
    assert.deepEqual(await actions(completed.draft.uid), ["reserve", "spend"]);
    assert.deepEqual(await actions(queued.draft.uid), ["reserve", "spend"]);
    assert.deepEqual(await actions(interrupted.draft.uid), [
      "reserve",
      "refund",
    ]);
    assert.deepEqual(streams(), [
      completed.draft.text,
      interrupted.draft.text,
      queued.draft.text,
    ]);
    const queuedSpend = after.history.find(
      (row: { chat_turn: string; action: string }) =>
        row.chat_turn === restoredQueue.messages.at(-1).turn &&
        row.action === "spend",
    );
    assert.ok(queuedSpend.amount > 0);
    assert.equal(
      after.wallet.balance,
      cleanCredit.wallet.balance - queuedSpend.amount - spent,
    );
    await reconcileWallets(target);

    const beforeReplay = await restoreSnapshot(target, false);
    await inflight.replay(recovered);
    for (const turn of [completed, interrupted, queued]) {
      const view = await recovered.read(turn.path);
      assert.deepEqual(
        await recovered.write(turn.path + "/messages", turn.draft),
        view,
      );
    }
    const { warning, ...paidSummary } = paid;
    assert.equal(warning, "");
    assert.deepEqual(
      await recovered.write("/api/recharge/orders", orderRequest),
      paidSummary,
    );
    await payment.verifyCallback(paid.id, targetOrigin);
    await payment.verifyCallback(paid.id, targetOrigin);
    assert.deepEqual(
      (await restoreSnapshot(target, false)).rows,
      beforeReplay.rows,
    );
    await verifyBucket();
    assert.deepEqual(await recovered.read("/api/credits"), after);
    assert.deepEqual(streams(), [
      completed.draft.text,
      interrupted.draft.text,
      queued.draft.text,
    ]);
    console.log(
      "Empty Redis redispatched the unclaimed chat once. The expired claimed chat was refunded without resubmission. Replayed chat UIDs, recharge UID, and signed callbacks changed no rows.",
    );
    console.log(
      "Restored media settled once. Muse polled saved task IDs, Flow reused saved receipts, and unknown submissions were refunded without a new generation. GPU resumed the live ticket, reassigned the expired lease and refunded the exhausted lease. Stale tickets and successful delivery replays produced no extra charges or objects.",
    );
  };
}
