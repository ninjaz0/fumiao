import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  asciiDispositionFilename,
  contentDisposition,
  mediaDownloadFilename,
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

test("mediaDownloadFilename and disposition preserve dotted stems, enforce .mp4, and emit ASCII + UTF-8 filenames", () => {
  const key = "0123456789abcdef0123456789abcdef";
  assert.equal(mediaDownloadFilename(key, "video/mp4"), "弗淼-01234567.mp4");
  assert.equal(mediaDownloadFilename(key, "video/mp4", ""), "弗淼-01234567.mp4");
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "my.clip.2026.11.mov"),
    "my.clip.2026.11.mp4",
  );
  assert.equal(
    mediaDownloadFilename(key, "video/mp4", "scene.01.mp4"),
    "scene.01.mp4",
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

test("Studio Download component, Composition MP4 link, and Canvas node downloads produce explicit .mp4 attributes", async () => {
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
    }) => ReturnType<typeof createElement>;
  };

  const generatedJobName = jobDownloadFilename({
    result: key,
    kind: "video",
  });
  assert.equal(generatedJobName, "弗淼-abcdef01.mp4");

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
      studio: {
        jobs: [],
        assets: [
          {
            id: key,
            kind: "ref_video",
            mime: "video/mp4",
            name: "scene.01.mp4",
            w: 1280,
            h: 720,
            owner: 1,
          },
        ],
      },
      node: videoNode,
    }),
    "scene.01.mp4",
  );

  const root = process.cwd();
  const [librarySrc, historySrc, detailSrc, workspaceSrc] = await Promise.all([
    readFile(join(root, "apps/web/studio/Library.tsx"), "utf8"),
    readFile(join(root, "apps/web/studio/History.tsx"), "utf8"),
    readFile(join(root, "apps/web/studio/AssetDetail.tsx"), "utf8"),
    readFile(join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"), "utf8"),
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
  assert.equal(
    (workspaceSrc.match(/canvasMediaDownloadFilename\(/g) ?? []).length,
    2,
  );
});
