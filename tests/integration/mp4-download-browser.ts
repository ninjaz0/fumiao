import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import { chromium } from "@playwright/test";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { databaseFixture } from "../helpers/database.js";

test("Chromium downloads preserve media extensions across parameterized MIME, consecutive dots, long CJK legacy names, and 200/304 cache revalidation", async () => {
  const f = await databaseFixture();
  const identity = new OriginalIdentity(f.p);
  const password = "mp4-download-browser-password";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const token = await identity.login({ name: "admin", password }, "browser");
  const app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  const apiUrl = new URL(await app.getUrl());

  const mp4Bytes = Buffer.from("000000186674797069736f6d", "hex");
  const modified = 1700000000;
  const workspace = (
    await f.db.query("SELECT id FROM workspaces WHERE kind='team'")
  ).rows[0] as { id: string };
  const admin = (
    await f.db.query("SELECT id FROM users WHERE name='admin'")
  ).rows[0] as { id: string };

  async function seedVideo(opts: {
    mime: string;
    originalKind?: string;
    originalName?: string;
  }): Promise<string> {
    const id = randomUUID();
    const key = randomUUID().replaceAll("-", "");
    const objectKey = "browser-video-" + id;
    await f.p.storage.put(objectKey, mp4Bytes, opts.mime);
    await f.db.query(
      "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,object_modified,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9,'{}')",
      [
        id,
        key,
        workspace.id,
        admin.id,
        objectKey,
        opts.mime,
        mp4Bytes.length,
        opts.originalKind ?? (opts.originalName ? "ref_video" : "video"),
        modified,
      ],
    );
    if (opts.originalName !== undefined) {
      await f.db.query(
        "INSERT INTO asset_reference_media(asset_id,seconds,fps,has_audio,name) VALUES($1,4,24,true,$2)",
        [id, opts.originalName],
      );
    }
    return key;
  }

  const cachedKey = await seedVideo({ mime: "video/mp4" });
  const paramKey = await seedVideo({
    mime: "video/mp4; codecs=avc1",
    originalName: "clip.v2.mp4",
  });
  const doubleDotKey = await seedVideo({
    mime: "video/mp4",
    originalName: "take..02.mov",
  });
  const longMp4Key = await seedVideo({
    mime: "video/mp4",
    originalName: "镜".repeat(70) + ".mp4",
  });
  const longOctetMp4Key = await seedVideo({
    mime: "application/octet-stream",
    originalName: "镜".repeat(70) + ".mp4",
  });
  const maxMp4FromMovKey = await seedVideo({
    mime: "video/mp4",
    originalName: "镜".repeat(116) + ".mov",
  });
  const maxOctetMovKey = await seedVideo({
    mime: "application/octet-stream",
    originalName: "镜".repeat(116) + ".mov",
  });

  let upgraded = false;
  const observedCachedStatuses: number[] = [];

  // Thin loopback HTTP front-door so Chromium exercises its real HTTP cache
  // against a pre-upgrade 200 (legacy ETag, no Content-Disposition) and then
  // against the real createOriginalApp /media/:key endpoint after upgrade.
  const proxy = createServer((req, res) => {
    if (req.url === "/__download_harness__") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><meta charset=utf-8><title>mp4-download</title>");
      return;
    }
    if (!upgraded && req.url === `/media/${cachedKey}`) {
      const legacyEtag =
        '"' +
        createHash("md5")
          .update(`${modified.toFixed(1)}-${mp4Bytes.length}`)
          .digest("hex") +
        '"';
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Last-Modified": new Date(modified * 1000).toUTCString(),
        ETag: legacyEtag,
        "Cache-Control": "private, no-cache",
        "Content-Length": String(mp4Bytes.length),
      });
      res.end(mp4Bytes);
      return;
    }
    const upstream = httpRequest(
      {
        hostname: apiUrl.hostname,
        port: Number(apiUrl.port),
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upRes) => {
        if (req.url === `/media/${cachedKey}`) {
          observedCachedStatuses.push(upRes.statusCode ?? 0);
        }
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addCookies([
      {
        name: "fm_session",
        value: token,
        url: origin,
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${origin}/__download_harness__`);

    async function triggerDownload(href: string, downloadAttr?: string) {
      const waitDownload = page.waitForEvent("download");
      await page.evaluate(
        ({ targetHref, attr }) => {
          const a = document.createElement("a");
          a.href = targetHref;
          if (attr !== undefined) a.download = attr;
          document.body.appendChild(a);
          a.click();
          a.remove();
        },
        { targetHref: href, attr: downloadAttr },
      );
      const dl = await waitDownload;
      return dl.suggestedFilename();
    }

    // 1. Warm Chromium's HTTP cache with pre-upgrade inline 200 (no Content-Disposition)
    const warm = await page.evaluate(async (url) => {
      const r = await fetch(url);
      await r.arrayBuffer();
      return {
        status: r.status,
        disposition: r.headers.get("content-disposition"),
      };
    }, `${origin}/media/${cachedKey}`);
    assert.equal(warm.status, 200);
    assert.equal(warm.disposition, null);

    // 2. Upgrade to real OriginalMedia + sendFile:
    //    - Revalidating the pre-upgrade cached inline entry misses the legacy ETag (server 200)
    //      and populates Content-Disposition in Chromium's HTTP cache.
    //    - Revalidating again hits 304 Not Modified on the wire while keeping Content-Disposition.
    //    - Inline download (download="" without ?download=true) saves with .mp4.
    upgraded = true;
    const expectedCachedName = `弗淼-${cachedKey.slice(0, 8)}.mp4`;
    const postUpgradeMiss = await page.evaluate(async (url) => {
      const r = await fetch(url);
      await r.arrayBuffer();
      return {
        status: r.status,
        disposition: r.headers.get("content-disposition"),
      };
    }, `${origin}/media/${cachedKey}`);
    assert.equal(postUpgradeMiss.status, 200);
    assert.ok(postUpgradeMiss.disposition?.startsWith("inline;"));

    const postUpgradeHit304 = await page.evaluate(async (url) => {
      const r = await fetch(url);
      await r.arrayBuffer();
      return {
        status: r.status,
        disposition: r.headers.get("content-disposition"),
      };
    }, `${origin}/media/${cachedKey}`);
    assert.equal(postUpgradeHit304.status, 200);
    assert.ok(postUpgradeHit304.disposition?.startsWith("inline;"));
    assert.deepEqual(observedCachedStatuses, [200, 304]);

    assert.equal(
      await triggerDownload(`/media/${cachedKey}`, ""),
      expectedCachedName,
    );
    assert.deepEqual(observedCachedStatuses, [200, 304, 200]);

    // 3. Parameterized MIME, consecutive dots, and long Chinese legacy filenames (video/mp4 + unmapped MIME)
    assert.equal(
      await triggerDownload(`/media/${paramKey}?download=true`),
      "clip.v2.mp4",
    );
    assert.equal(
      await triggerDownload(`/media/${doubleDotKey}?download=true`),
      "take..02.mp4",
    );
    const expectedTruncatedMp4 = "镜".repeat(66) + ".mp4";
    const expectedTruncatedMov = "镜".repeat(66) + ".mov";
    assert.equal(
      await triggerDownload(`/media/${longMp4Key}?download=true`),
      expectedTruncatedMp4,
    );
    assert.equal(
      await triggerDownload(`/media/${longOctetMp4Key}?download=true`),
      expectedTruncatedMp4,
    );
    assert.equal(
      await triggerDownload(`/media/${maxMp4FromMovKey}?download=true`),
      expectedTruncatedMp4,
    );
    assert.equal(
      await triggerDownload(`/media/${maxOctetMovKey}?download=true`),
      expectedTruncatedMov,
    );

    await context.close();
  } finally {
    await browser.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await app.close();
    await f.cleanup();
  }
});
