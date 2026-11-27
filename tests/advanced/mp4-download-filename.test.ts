import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  asciiDispositionFilename,
  contentDisposition,
  mediaDownloadFilename,
  normalizeMediaMime,
} from "@fumiao/plugin-sdk/media-filename.js";
import { disposition } from "@fumiao/original-api/files.js";
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

test("Studio Download component, archived WebM jobs, and Canvas node downloads produce accurate extensions", async () => {
  (globalThis as Record<string, unknown>).React = React;
  const key = "abcdef0123456789abcdef0123456789";
  const assetMediaModule = "../../apps/web/studio/AssetMedia.tsx";
  const { Download } = (await import(assetMediaModule)) as {
    Download: (props: {
      id: string;
      filename?: string;
      detail?: boolean;
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

test("long Chinese legacy filenames (<= 120 chars, > 200 UTF-8 bytes) preserve trailing media extensions for both mapped and unmapped MIME types", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const cjk70Mp4 = "镜".repeat(70) + ".mp4";
  const cjk116Mov = "镜".repeat(116) + ".mov";
  const cjk65DottedMp4 = "镜".repeat(65) + ".v2.mp4";
  const truncatedStem66 = "镜".repeat(66);

  assert.equal(cjk70Mp4.length, 74);
  assert.equal(cjk116Mov.length, 120);

  // Mapped video/mp4 preserves .mp4 after 200-byte UTF-8 stem truncation
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", cjk70Mp4),
    truncatedStem66 + ".mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", cjk116Mov),
    truncatedStem66 + ".mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", cjk65DottedMp4),
    "镜".repeat(65) + ".v2.mp4",
  );

  // Unmapped MIME (e.g. application/octet-stream, video/quicktime, empty) separates and preserves recognizable trailing media extension before truncation
  assert.equal(
    mediaDownloadFilename(key, "application/octet-stream", cjk70Mp4),
    truncatedStem66 + ".mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "application/octet-stream", "镜".repeat(70) + ".MP4"),
    truncatedStem66 + ".mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "application/octet-stream", cjk116Mov),
    truncatedStem66 + ".mov",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/quicktime", cjk116Mov),
    truncatedStem66 + ".mov",
  );
  assert.equal(
    mediaDownloadFilename(key, "application/octet-stream", cjk65DottedMp4),
    "镜".repeat(65) + ".v2.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "", cjk70Mp4),
    truncatedStem66 + ".mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "application/octet-stream", ".mp4"),
    "弗淼-01234567.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "application/octet-stream", "镜".repeat(70)),
    truncatedStem66,
  );

  // Content-Disposition and Studio/Canvas helpers also preserve .mp4 for long Chinese legacy names
  assert.equal(asciiDispositionFilename(truncatedStem66 + ".mp4"), "fumiao.mp4");
  assert.equal(
    contentDisposition(truncatedStem66 + ".mp4"),
    `attachment; filename="fumiao.mp4"; filename*=UTF-8''${encodeURIComponent(truncatedStem66 + ".mp4")}`,
  );
  assert.equal(
    assetDownloadFilename({
      id: key,
      kind: "ref_video",
      mime: "application/octet-stream",
      name: cjk70Mp4,
    }),
    truncatedStem66 + ".mp4",
  );
  assert.equal(
    canvasMediaDownloadFilename(key, {
      studio: {
        jobs: [],
        assets: [
          {
            id: key,
            kind: "ref_video",
            mime: "application/octet-stream",
            name: cjk70Mp4,
            w: 1280,
            h: 720,
            owner: 1,
          },
        ],
      },
    }),
    truncatedStem66 + ".mp4",
  );
});
