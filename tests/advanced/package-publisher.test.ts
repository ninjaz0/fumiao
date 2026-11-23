import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  signPackage,
  verifyPackageSignature,
} from "@fumiao/plugin-sdk/package-signing.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { StudioUpdates } from "@fumiao/platform/studio-updates.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
import { databaseFixture } from "../helpers/database.js";

const example = async () =>
  JSON.parse(
    await readFile(
      "plugins/example-reading-time/example-reading-time.fmplugin.json",
      "utf8",
    ),
  );
async function fixture(t: test.TestContext) {
  const f = await databaseFixture();
  t.after(f.cleanup);
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p),
    creds = { name: "admin", password: randomUUID() };
  await identity.bootstrap({ ...creds, nickname: "测试" });
  const actor = await identity.actor(await identity.login(creds, "publisher"));
  return { ...f, actor, pkgs: new StudioPackages(f.p) };
}
test("Ed25519 covers the publisher and complete JSON payload and survives JSONB key ordering", async () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const file = signPackage(await example(), "测试作者", key);
  assert.deepEqual(
    verifyPackageSignature(Object.fromEntries(Object.entries(file).reverse())),
    file.signature,
  );
  for (const alter of [
    (p: any) => (p.label += "!"),
    (p: any) => (p.signature.publisher += "!"),
    (p: any) => (p.contributes.chatTools[0].program += " "),
    (p: any) => (p.signature.value = "AAAA"),
  ]) {
    const changed = structuredClone(file);
    alter(changed);
    assert.throws(() => verifyPackageSignature(changed));
  }
  assert.throws(() => signPackage({ n: Infinity }, "测试作者", key));
});
test("Studio pins the first key, binds rotation approval to one release and enforces it across removal and rollback", async (t) => {
  const { pkgs, actor, db } = await fixture(t),
    base = await example();
  const a = generateKeyPairSync("ed25519").privateKey,
    b = generateKeyPairSync("ed25519").privateKey;
  const first = signPackage(base, "甲", a);
  const second = signPackage({ ...base, version: "1.1.0" }, "乙", b);
  const state = async () =>
    (await pkgs.list(actor)).find((p) => p.id === base.id)!;
  const preview = await pkgs.preview(actor, first);
  assert.equal(preview.publisher.name, "甲");
  assert.equal(preview.publisher.change, null);
  await pkgs.install(actor, first);
  const review = (await pkgs.preview(actor, second)).publisher;
  assert.equal(review.previousFingerprint, preview.publisher.fingerprint);
  assert.notEqual(review.fingerprint, preview.publisher.fingerprint);
  assert.ok(review.change);
  await assert.rejects(pkgs.install(actor, second, 1), /重新确认/);
  await assert.rejects(
    pkgs.install(actor, { ...base, version: "1.1.0" }, 1),
    /已签名/,
  );
  const substitute = signPackage({ ...base, version: "1.1.1" }, "乙", b);
  await assert.rejects(
    pkgs.install(actor, substitute, 1, false, {}, review.change),
    /重新确认/,
  );
  await Promise.all([
    pkgs.install(actor, second, 1, false, {}, review.change),
    pkgs.install(actor, second, 1, false, {}, review.change),
  ]);
  const installed = await state();
  assert.equal(installed.revision, 2);
  assert.equal(installed.publisher.name, "乙");
  await assert.rejects(pkgs.install(actor, first, 2, true), /重新确认/);
  await pkgs.install(
    actor,
    first,
    2,
    true,
    {},
    installed.rollbackPublisher.change,
  );
  const restored = (
    await one(
      db,
      "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
      [base.id, base.version],
    )
  ).package;
  assert.deepEqual(verifyPackageSignature(restored), first.signature);
  await pkgs.change(actor, base.id, 3, "remove");
  await assert.rejects(pkgs.install(actor, base), /已签名/);
  const back = (await pkgs.preview(actor, second)).publisher;
  assert.equal(back.previousFingerprint, preview.publisher.fingerprint);
  await assert.rejects(pkgs.install(actor, second), /重新确认/);
  await pkgs.install(actor, second, undefined, false, {}, back.change!);
  assert.equal((await state()).publisher.fingerprint, review.fingerprint);
});
test("remote update review and apply preserve signed bytes before schema defaults", async (t) => {
  const { pkgs, actor, p } = await fixture(t),
    base = await example(),
    updates = new StudioUpdates(p);
  const first = signPackage(
    base,
    "第一把公钥",
    generateKeyPairSync("ed25519").privateKey,
  );
  const second = signPackage(
    { ...base, version: "1.1.0" },
    "第二把公钥",
    generateKeyPairSync("ed25519").privateKey,
  );
  const raw = JSON.stringify(second),
    sha256 = createHash("sha256").update(raw).digest("hex");
  const info = {
    id: base.id,
    version: second.version,
    notes: "换钥",
    package: "package.json",
    sha256,
  };
  const server = createServer((req, res) =>
    res.end(req.url === "/update.json" ? JSON.stringify(info) : raw),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  await pkgs.install(actor, first);
  await updates.configure(actor, base.id, {
    revision: 1,
    url:
      "http://127.0.0.1:" +
      (server.address() as AddressInfo).port +
      "/update.json",
  });
  await updates.check(base.id);
  const review = await updates.review(actor, base.id);
  const apply = { actor, revision: 2, sha256 };
  await assert.rejects(updates.check(base.id, apply), /重新确认/);
  await updates.check(base.id, {
    ...apply,
    confirmPublisher: review.publisher.change!,
  });
  assert.equal(
    (await pkgs.list(actor)).find((p) => p.id === base.id)?.version,
    "1.1.0",
  );
});

test("unsigned first installs are labeled, an unsigned installation can adopt its first key, and same-key updates proceed", async (t) => {
  const { actor, pkgs } = await fixture(t),
    base = await example();
  assert.equal((await pkgs.preview(actor, base)).publisher.fingerprint, null);
  await pkgs.install(actor, base);
  const state = async () =>
    (await pkgs.list(actor)).find((p) => p.id === base.id)!;
  assert.equal((await state()).publisher.name, null);
  const key = generateKeyPairSync("ed25519").privateKey;
  const signed = signPackage({ ...base, version: "1.1.0" }, "作者", key);
  assert.equal((await pkgs.preview(actor, signed)).publisher.change, null);
  await pkgs.install(actor, signed, 1);
  const later = signPackage({ ...base, version: "1.2.0" }, "作者", key);
  assert.equal((await pkgs.preview(actor, later)).publisher.change, null);
  await pkgs.install(actor, later, 2);
  assert.equal((await state()).publisher.name, "作者");
  await assert.rejects(
    pkgs.preview(actor, { ...base, version: "1.3.0" }),
    /已签名/,
  );
});
