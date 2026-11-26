import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import express from "express";
import { Readable } from "node:stream";
import {
  asciiDispositionFilename,
  contentDisposition,
  mediaDownloadFilename,
  normalizeMediaMime,
} from "@fumiao/plugin-sdk/media-filename.js";
import { disposition, sendFile } from "@fumiao/original-api/files.js";
import {
  assetDownloadFilename,
  jobDownloadFilename,
} from "../../apps/web/studio/state.js";
import {
  canvasMediaDownloadFilename,
  newNode,
  type Job as CanvasJob,
} from "../../apps/web/canvas-editor/types.js";

test("mediaDownloadFilename and disposition handle parameterized/mixed-case MIME, preserve take..02.mov consecutive dots, and emit ASCII + UTF-8 filenames", () => {
  const key = "0123456789abcdef0123456789abcdef";
  assert.equal(normalizeMediaMime("video/mp4; codecs=avc1"), "video/mp4");
  assert.equal(normalizeMediaMime(" Video/MP4 ; codecs=\"avc1\" "), "video/mp4");

  assert.equal(mediaDownloadFilename(key, "video/mp4"), "弗淼-01234567.mp4");
  assert.equal(mediaDownloadFilename(key, "video/mp4", ""), "弗淼-01234567.mp4");
  assert.equal(
    mediaDownloadFilename(key, "video/mp4; codecs=avc1", "clip.v2.mp4"),
    "clip.v2.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "Video/MP4", "clip.v2.mp4"),
    "clip.v2.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "my.clip.2026.11.mov"),
    "my.clip.2026.11.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "scene.01.mp4"),
    "scene.01.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "take..02.mov"),
    "take..02.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "test.v2"),
    "test.v2.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "2026.11.19.镜头1.mov"),
    "2026.11.19.镜头1.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "产品演示.1080p"),
    "产品演示.1080p.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", ".mov"),
    "弗淼-01234567.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", 'a/b\\c"d\r\n.v2.MOV'),
    "a_b_cd.v2.mp4",
  );

  // Intentional ASCII consecutive dots are preserved in both filename and filename*
  assert.equal(asciiDispositionFilename("take..02.mp4"), "take..02.mp4");
  assert.equal(
    disposition("take..02.mp4"),
    "attachment; filename=\"take..02.mp4\"; filename*=UTF-8''take..02.mp4",
  );
  // Separators adjacent to stripped non-ASCII segments still collapse cleanly
  assert.equal(
    asciiDispositionFilename("2026.11.19.镜头1.mp4"),
    "2026.11.19.1.mp4",
  );
  assert.equal(
    asciiDispositionFilename("弗淼-01234567.mp4"),
    "fumiao-01234567.mp4",
  );
  assert.equal(asciiDispositionFilename("产品演示.mp4"), "fumiao.mp4");
  assert.equal(
    disposition("弗淼-01234567.mp4"),
    "attachment; filename=\"fumiao-01234567.mp4\"; filename*=UTF-8''%E5%BC%97%E6%B7%BC-01234567.mp4",
  );
  assert.equal(
    contentDisposition("弗淼-01234567.mp4", "inline"),
    "inline; filename=\"fumiao-01234567.mp4\"; filename*=UTF-8''%E5%BC%97%E6%B7%BC-01234567.mp4",
  );
});

test("Studio Download component, Composition MP4/project links, archived WebM jobs, and Canvas node downloads produce accurate extensions", async () => {
  (globalThis as Record<string, unknown>).React = React;
  const key = "abcdef0123456789abcdef0123456789";
  const assetMediaModule = "../../apps/web/studio/AssetMedia.tsx";
  const compositionModule = "../../apps/web/canvas-editor/Composition.tsx";
  const { Download } = (await import(assetMediaModule)) as {
    Download: (props: {
      id: string;
      filename?: string;
      detail?: boolean;
    }) => ReturnType<typeof createElement>;
  };
  const { CompositionDownloadLink } = (await import(compositionModule)) as {
    CompositionDownloadLink: (props: {
      result: string;
      exportResult?: {
        id: string;
        state: string;
        result: string | null;
        error: string;
        revision: number;
        created: number;
        exporter?: string;
        output_kind?: "composition" | "project";
        output_mime?: string;
        output_filename?: string | null;
      };
    }) => ReturnType<typeof createElement>;
  };

  const generatedJobName = jobDownloadFilename({
    result: key,
    kind: "video",
  });
  assert.equal(generatedJobName, "弗淼-abcdef01.mp4");

  // Archived WebM video jobs preserve .webm instead of forcing .mp4
  assert.equal(
    jobDownloadFilename({
      result: key,
      kind: "video",
      result_mime: "video/webm",
    }),
    "弗淼-abcdef01.webm",
  );

  // Parameterized MIME on uploaded video still produces .mp4
  assert.equal(
    assetDownloadFilename({
      id: key,
      kind: "ref_video",
      mime: "video/mp4; codecs=avc1",
      name: "clip.v2.mp4",
    }),
    "clip.v2.mp4",
  );

  const cardDownloadHtml = renderToStaticMarkup(
    createElement(Download, {
      id: key,
      filename: generatedJobName,
    }),
  );
  assert.match(
    cardDownloadHtml,
    new RegExp(`href="/media/${key}\\?download=true"`),
  );
  assert.match(cardDownloadHtml, /download="弗淼-abcdef01\.mp4"/);

  const dottedAssetName = assetDownloadFilename({
    id: key,
    kind: "ref_video",
    mime: "video/mp4",
    name: "my.clip.2026.11.mov",
  });
  assert.equal(dottedAssetName, "my.clip.2026.11.mp4");

  const detailDownloadHtml = renderToStaticMarkup(
    createElement(Download, {
      id: key,
      filename: dottedAssetName,
      detail: true,
    }),
  );
  assert.match(detailDownloadHtml, /class="download-action"/);
  assert.match(detailDownloadHtml, /download="my\.clip\.2026\.11\.mp4"/);

  const fallbackImageHtml = renderToStaticMarkup(
    createElement(Download, { id: key }),
  );
  assert.match(fallbackImageHtml, /download=""/);

  const compositionHtml = renderToStaticMarkup(
    createElement(CompositionDownloadLink, { result: key }),
  );
  assert.match(
    compositionHtml,
    new RegExp(`href="/media/${key}\\?download=true"`),
  );
  assert.match(compositionHtml, /download="弗淼-abcdef01\.mp4"/);
  assert.match(compositionHtml, />MP4<\/a>$/);

  const projectZipHtml = renderToStaticMarkup(
    createElement(CompositionDownloadLink, {
      result: key,
      exportResult: {
        id: "exp-1",
        state: "done",
        result: key,
        error: "",
        revision: 1,
        created: 1700000000,
        exporter: "jianying-exporter/draft",
        output_kind: "project",
        output_mime: "application/zip",
        output_filename: "jianying-draft.zip",
      },
    }),
  );
  assert.match(projectZipHtml, /download="jianying-draft\.zip"/);
  assert.match(projectZipHtml, />剪映草稿 ZIP<\/a>$/);

  const videoNode = newNode("video", 0, 0, 1);
  const canvasJob: CanvasJob = {
    id: 11,
    owner: 1,
    kind: "video",
    status: "done",
    result: key,
    result_mime: "video/mp4",
    note: "",
    prompt: "video",
    refs: [],
    width: 864,
    height: 480,
    created: 1700000000,
    seconds: 5,
    quality: 480,
    ratio: "16:9",
    image_quality: "medium",
    model: "MiniMax H3",
  };
  assert.equal(
    canvasMediaDownloadFilename(key, { runs: [canvasJob], node: videoNode }),
    "弗淼-abcdef01.mp4",
  );
  assert.equal(
    canvasMediaDownloadFilename(key, {
      runs: [{ ...canvasJob, result_mime: "video/webm" }],
      node: videoNode,
    }),
    "弗淼-abcdef01.webm",
  );
  assert.equal(
    canvasMediaDownloadFilename(key, {
      studio: {
        jobs: [],
        assets: [
          {
            id: key,
            kind: "ref_video",
            mime: "Video/MP4",
            name: "clip.v2.mp4",
            w: 1280,
            h: 720,
            owner: 1,
          },
        ],
      },
      node: videoNode,
    }),
    "clip.v2.mp4",
  );

  const root = process.cwd();
  const [librarySrc, historySrc, detailSrc, dialogSrc, workspaceSrc] =
    await Promise.all([
      readFile(join(root, "apps/web/studio/Library.tsx"), "utf8"),
      readFile(join(root, "apps/web/studio/History.tsx"), "utf8"),
      readFile(join(root, "apps/web/studio/AssetDetail.tsx"), "utf8"),
      readFile(join(root, "apps/web/studio/AssetDialog.tsx"), "utf8"),
      readFile(
        join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
        "utf8",
      ),
    ]);
  assert.match(
    librarySrc,
    /<Download id=\{asset\.id\} filename=\{assetDownloadFilename\(asset\)\} \/>/,
  );
  assert.match(
    historySrc,
    /<Download id=\{job\.result\} filename=\{jobDownloadFilename\(job\)\} \/>/,
  );
  assert.match(detailSrc, /filename=\{jobDownloadFilename\(job\)\}/);
  assert.match(detailSrc, /filename=\{assetDownloadFilename\(asset\)\}/);
  assert.match(dialogSrc, /filename=\{assetDownloadFilename\(asset\)\}/);
  assert.equal(
    (workspaceSrc.match(/canvasMediaDownloadFilename\(/g) ?? []).length,
    2,
  );
});

test("Chromium downloads preserve .mp4 for parameterized MIME, take..02.mov, and pre-upgrade cached inline 200 revalidated after upgrade", async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Playwright Chromium binary is not installed in this environment");
    return;
  }
  const mp4Bytes = Buffer.from("000000186674797069736f6d", "hex");
  const modified = 1700000000;
  const cachedKey = "11223344556677889900aabbccddeeff";
  const paramKey = "aabbccdd11223344556677889900ff00";
  const doubleDotKey = "99887766554433221100ffeeddccbbaa";
  let upgraded = false;

  const app = express();
  app.get("/page", (_req, res) => {
    res
      .type("html")
      .send("<!doctype html><meta charset=utf-8><title>download-check</title>");
  });
  app.get("/media/:key", (req, res) => {
    const { key } = req.params;
    const download = req.query.download === "true";
    if (!upgraded && key === cachedKey) {
      // Simulate pre-upgrade inline 200 response: legacy MD5 ETag and NO Content-Disposition
      const legacyEtag =
        '"' +
        createHash("md5")
          .update(`${modified.toFixed(1)}-${mp4Bytes.length}`)
          .digest("hex") +
        '"';
      res.set({
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Last-Modified": new Date(modified * 1000).toUTCString(),
        ETag: legacyEtag,
        "Cache-Control": "private, no-cache",
        "Content-Length": String(mp4Bytes.length),
      });
      res.status(200).end(mp4Bytes);
      return;
    }
    const mime =
      key === paramKey ? "video/mp4; codecs=avc1" : "video/mp4";
    const originalName =
      key === paramKey
        ? "clip.v2.mp4"
        : key === doubleDotKey
          ? "take..02.mov"
          : undefined;
    const filename = mediaDownloadFilename(key, mime, originalName);
    void sendFile(
      req,
      res,
      {
        revalidate: !download,
        size: mp4Bytes.length,
        mime,
        modified,
        open: async (start = 0, end = mp4Bytes.length - 1) =>
          Readable.from([mp4Bytes.subarray(start, end + 1)]),
      },
      filename,
      download ? "attachment" : "inline",
    );
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${origin}/page`);

    // Step 1: Populate Chromium's HTTP cache with pre-upgrade inline 200 (no Content-Disposition)
    const warmStatus = await page.evaluate(async (url) => {
      const r = await fetch(url);
      await r.arrayBuffer();
      return {
        status: r.status,
        disposition: r.headers.get("content-disposition"),
      };
    }, `${origin}/media/${cachedKey}`);
    assert.equal(warmStatus.status, 200);
    assert.equal(warmStatus.disposition, null);

    // Step 2: Upgrade server and trigger save/download of the cached inline URL (download="" without ?download=true)
    upgraded = true;
    const cachedDownloadPromise = page.waitForEvent("download");
    await page.evaluate((key) => {
      const a = document.createElement("a");
      a.href = `/media/${key}`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
    }, cachedKey);
    const cachedDownload = await cachedDownloadPromise;
    assert.equal(cachedDownload.suggestedFilename(), "弗淼-11223344.mp4");

    // Step 3: Parameterized MIME ("video/mp4; codecs=avc1") with dotted name "clip.v2.mp4"
    const paramDownloadPromise = page.waitForEvent("download");
    await page.evaluate((key) => {
      const a = document.createElement("a");
      a.href = `/media/${key}?download=true`;
      document.body.appendChild(a);
      a.click();
    }, paramKey);
    const paramDownload = await paramDownloadPromise;
    assert.equal(paramDownload.suggestedFilename(), "clip.v2.mp4");

    // Step 4: Consecutive dots ("take..02.mov") downloaded in Chromium
    const doubleDotDownloadPromise = page.waitForEvent("download");
    await page.evaluate((key) => {
      const a = document.createElement("a");
      a.href = `/media/${key}?download=true`;
      document.body.appendChild(a);
      a.click();
    }, doubleDotKey);
    const doubleDotDownload = await doubleDotDownloadPromise;
    assert.equal(doubleDotDownload.suggestedFilename(), "take..02.mp4");

    await context.close();
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
