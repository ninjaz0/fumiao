import { test } from "node:test";
import assert from "node:assert/strict";
import {
  subtitleCues,
  timestamp,
  webVtt,
} from "@fumiao/platform/composition/subtitles.js";

test("original subtitle weighting uses Unicode code points, punctuation and offsets", () => {
  assert.deepEqual(subtitleCues("猫。\n😀!", 1, 4, 3), [
    "3\n00:00:01,000 --> 00:00:03,000\n猫。\n",
    "4\n00:00:03,000 --> 00:00:05,000\n😀!\n",
  ]);
  assert.deepEqual(subtitleCues(" \n ", 0, 2, 1), []);
});
test("original Python millisecond ties and VTT conversion", () => {
  assert.equal(timestamp(0.0005), "00:00:00,000");
  assert.equal(timestamp(0.0015), "00:00:00,002");
  assert.equal(timestamp(3661.125), "01:01:01,125");
  assert.equal(
    webVtt("1\n00:00:00,000 --> 00:00:01,000\n你好\n"),
    "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n你好\n",
  );
});
test("Python strip preserves BOM but strips information separators", () => {
  assert.deepEqual(subtitleCues("\u001c猫\u001c", 0, 1, 1), [
    "1\n00:00:00,000 --> 00:00:01,000\n猫\n",
  ]);
  assert.deepEqual(subtitleCues("\ufeff猫\ufeff", 0, 1, 1), [
    "1\n00:00:00,000 --> 00:00:01,000\n\ufeff猫\ufeff\n",
  ]);
});
