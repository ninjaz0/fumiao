import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";
import { one } from "@fumiao/platform/db.js";
import {
  ensureDerivativeQueued,
  generateDerivative,
  getReadyDerivative,
} from "@fumiao/platform/derivatives.js";
import type { OriginalActor } from "@fumiao/original-api/identity.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { canvasesFixture } from "../helpers/canvases.js";

const execFileAsync = promisify(execFile);

async function makeTestPng(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 42, g: 120, b: 220, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function makeTestMp4(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "fumiao-w3-vid-"));
  try {
    const out = join(dir, "sample.mp4");
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=orange:s=640x360:d=0.6:r=24",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("F038 asset derivatives generate WebP thumbs and video posters excluded from user quota and cascade-deleted with parent", async () => {
  const f = await canvasesFixture();
  try {
    const media = new OriginalMedia(f.p);
    const png = await makeTestPng(960, 640);
    const imgId = randomUUID();
    const imgKey = randomUUID().replaceAll("-", "");
    const imgObj = `img-${imgKey}`;
    await f.p.storage.put(imgObj, png, "image/png");
    await f.db.query(
      `INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind,object_modified)
       VALUES($1,$2,$3,$4,$5,'image/png',$6,'ready','{"width":960,"height":640}','ref',1700000000)`,
      [imgId, imgKey, f.team.id, f.admin.id, imgObj, png.length],
    );
    await ensureDerivativeQueued(f.db, imgId, "image/png");

    const usedBefore = Number(
      (
        await one(
          f.db,
          "SELECT COALESCE(SUM(size),0) AS bytes FROM assets WHERE workspace_id=$1",
          [f.team.id],
        )
      ).bytes,
    );

    const thumb = await generateDerivative(f.p, imgId, "thumb");
    assert.ok(thumb);
    assert.equal(thumb.state, "ready");
    assert.equal(thumb.mime, "image/webp");
    assert.ok(thumb.width <= 400 && thumb.height <= 400);

    // Confirm user quota (assets table sum) did NOT increase when derivative was stored (Q2).
    const usedAfter = Number(
      (
        await one(
          f.db,
          "SELECT COALESCE(SUM(size),0) AS bytes FROM assets WHERE workspace_id=$1",
          [f.team.id],
        )
      ).bytes,
    );
    assert.equal(usedAfter, usedBefore);

    const readyThumb = await getReadyDerivative(f.db, imgId, "thumb");
    assert.ok(readyThumb);
    assert.equal(readyThumb.object_key, thumb.object_key);
    assert.ok((await f.p.storage.stat(thumb.object_key)).size > 0);

    // Video poster derivative
    const mp4 = await makeTestMp4();
    const vidId = randomUUID();
    const vidKey = randomUUID().replaceAll("-", "");
    const vidObj = `vid-${vidKey}`;
    await f.p.storage.put(vidObj, mp4, "video/mp4");
    await f.db.query(
      `INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind,object_modified)
       VALUES($1,$2,$3,$4,$5,'video/mp4',$6,'ready','{"width":640,"height":360}','video',1700000000)`,
      [vidId, vidKey, f.team.id, f.admin.id, vidObj, mp4.length],
    );
    const poster = await generateDerivative(f.p, vidId, "poster");
    assert.ok(poster);
    assert.equal(poster.state, "ready");
    assert.equal(poster.mime, "image/jpeg");
    assert.ok(poster.width <= 480);

    // Removing the image asset cascades asset_derivatives row AND deletes derivative file from object storage.
    await media.remove(f.admin, imgKey, String(f.team.public_id));
    assert.equal(await getReadyDerivative(f.db, imgId, "thumb"), null);
    await assert.rejects(() => f.p.storage.stat(thumb.object_key));
  } finally {
    await f.cleanup();
  }
});

test("F022 + F009 AssetPack lock/unlock, admin-only global scope with strict media isolation, and turnaround views", async () => {
  const f = await canvasesFixture();
  try {
    const packs = new OriginalPacks(f.p);
    const media = new OriginalMedia(f.p);

    const ref1 = await f.asset(randomUUID().replaceAll("-", ""), "ref", f.team, f.admin);
    const ref2 = await f.asset(randomUUID().replaceAll("-", ""), "ref", f.team, f.admin);
    const privateRef = await f.asset(randomUUID().replaceAll("-", ""), "ref", f.team, f.admin);

    // Create a character pack in team workspace
    const created = await packs.save(
      f.admin,
      {
        name: "林岚",
        purpose: "subject",
        description: "黑色风衣与银色耳坠的赛博侦探",
        media: [ref1.public_id],
        expected_revision: null,
      },
      String(f.team.public_id),
    );
    assert.equal(created.locked, undefined);

    // F009: Attach turnaround views (front + sheet)
    const attached = await packs.turnaround(
      f.admin,
      created.id,
      { views: { front: ref1.public_id, sheet: ref2.public_id } },
      String(f.team.public_id),
    );
    assert.equal(attached.mode, "attached");
    assert.equal(attached.pack.turnaround_views?.front, ref1.public_id);
    assert.equal(attached.pack.turnaround_views?.sheet, ref2.public_id);

    // F022: Member cannot promote pack to global scope
    await assert.rejects(
      () =>
        packs.setScope(
          f.member,
          created.id,
          { scope: "global" },
          String(f.team.public_id),
        ),
      { status: 403 },
    );

    // Admin promotes pack to global scope
    const promoted = await packs.setScope(
      f.admin,
      created.id,
      { scope: "global" },
      String(f.team.public_id),
    );
    assert.equal(promoted.scope, "global");

    // Lock the pack -> edits and deletes must be rejected with 409!
    const locked = await packs.setLock(
      f.admin,
      created.id,
      true,
      String(f.team.public_id),
    );
    assert.equal(locked.locked, true);

    await assert.rejects(
      () =>
        packs.save(
          f.admin,
          {
            name: "林岚改名",
            purpose: "subject",
            description: "修改描述",
            media: [ref1.public_id],
            expected_revision: locked.revision,
          },
          String(f.team.public_id),
          created.id,
        ),
      { status: 409 },
    );
    await assert.rejects(
      () => packs.remove(f.admin, created.id, String(f.team.public_id)),
      { status: 409 },
    );

    // Another user in a completely different personal workspace sees the global pack
    // and can read its attached ref assets, but CANNOT read unrelated private assets!
    await f.identity.createMember(f.admin, {
      name: "outsider",
      nickname: "Outsider",
      password: "outsider-secret-password",
    });
    const outsider = (await one(
      f.db,
      "SELECT * FROM users WHERE name='outsider'",
    )) as OriginalActor;
    const outsiderWs = await f.identity.activeWorkspace(f.db, outsider);

    const outsiderList = await packs.list(outsider, String(outsiderWs.public_id));
    assert.ok(outsiderList.packs.some((p) => p.id === created.id && p.scope === "global"));

    // Allowed: asset inside global pack
    const globalRead = await media.resource(f.db, outsider, ref1.public_id);
    assert.equal(globalRead.public_id, ref1.public_id);

    // Denied: ordinary private asset in admin's team workspace NOT in global pack
    await assert.rejects(
      () => media.resource(f.db, outsider, privateRef.public_id),
      { status: 404 },
    );

    // Unlock allows editing again
    const unlocked = await packs.setLock(
      f.admin,
      created.id,
      false,
      String(f.team.public_id),
    );
    assert.equal(unlocked.locked, undefined);
  } finally {
    await f.cleanup();
  }
});
