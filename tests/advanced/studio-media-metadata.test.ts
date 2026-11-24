import assert from "node:assert/strict";
import test from "node:test";
import {
  PREVIEW_LABELS,
  assetMetadataItems,
  deleteAssetPrompt,
  formatCardDuration,
  formatMediaSeconds,
} from "../../apps/web/studio/media-metadata.js";

test("uploaded video and audio metadata format resolution, duration and audio track", () => {
  assert.deepEqual(
    assetMetadataItems({
      kind: "ref_video",
      w: 320,
      h: 180,
      seconds: 4.032,
      has_audio: 1,
    }),
    ["320 × 180", "4s", "含音轨"],
  );
  assert.deepEqual(
    assetMetadataItems({
      kind: "ref_video",
      w: 1280,
      h: 720,
      seconds: 6.46,
      has_audio: false,
    }),
    ["1280 × 720", "6.5s", "无音轨"],
  );
  assert.deepEqual(
    assetMetadataItems({
      kind: "ref_video",
      w: 640,
      h: 360,
      seconds: 3,
      has_audio: 0,
    }),
    ["640 × 360", "3s", "无音轨"],
  );
  assert.deepEqual(
    assetMetadataItems({
      kind: "ref_audio",
      w: 0,
      h: 0,
      seconds: 4,
      has_audio: true,
    }),
    ["4s"],
  );
  assert.deepEqual(
    assetMetadataItems({
      kind: "ref",
      w: 320,
      h: 180,
    }),
    ["320 × 180"],
  );
  assert.deepEqual(assetMetadataItems(undefined, "ref_video"), []);
});

test("card duration, seconds formatting, accessible preview labels and delete prompts", () => {
  assert.equal(formatCardDuration(4.2), "00:04");
  assert.equal(formatCardDuration(65), "01:05");
  assert.equal(formatCardDuration(0), "");
  assert.equal(formatCardDuration(undefined), "");

  assert.equal(formatMediaSeconds(4), "4s");
  assert.equal(formatMediaSeconds(12.25), "12.3s");
  assert.equal(formatMediaSeconds(0), "");
  assert.equal(formatMediaSeconds(Number.NaN), "");

  assert.deepEqual(PREVIEW_LABELS, {
    ref: "图片预览",
    ref_video: "视频预览",
    ref_audio: "音频预览",
  });

  assert.deepEqual(deleteAssetPrompt("ref_video"), {
    title: "删除该视频？",
    summary: "正在被任务或作品引用的视频会保留。",
  });
  assert.deepEqual(deleteAssetPrompt("ref_audio"), {
    title: "删除该音频？",
    summary: "正在被任务或作品引用的音频会保留。",
  });
  assert.deepEqual(deleteAssetPrompt("ref"), {
    title: "删除该图片？",
    summary: "正在被任务或作品引用的图片会保留。",
  });
});
