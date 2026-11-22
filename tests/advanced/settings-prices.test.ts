import assert from "node:assert/strict";
import test from "node:test";
import {
  PRICE_CREDIT_RATE_TEXT,
  isPriceUnset,
  pricesChanged,
  priceValues,
  summarizePrices,
  type PriceCatalogEntry,
  type PriceItem,
} from "../../apps/web/studio/settings-prices-helpers.js";

const catalog: Record<string, PriceCatalogEntry> = {
  "MiniMax H3": { label: "MiniMax H3", provider: "minimax" },
  "breeze-tts-2": { label: "Breeze TTS 2", provider: "breeze" },
  "flow:flux": { label: "Flow Flux", provider: "flow" },
  "hidden-model": { label: "Hidden", provider: "hidden", hidden: true },
  "custom-model": { label: "自定义模型", provider: "custom" },
};

const items: PriceItem[] = [
  {
    key: "MiniMax H3|768p|6s",
    model: "MiniMax H3",
    kind: "video",
    label: "768p · 6 秒",
    amount: null,
  },
  {
    key: "MiniMax H3|1080p|6s",
    model: "MiniMax H3",
    kind: "video",
    label: "1080p · 6 秒",
    amount: 0,
  },
  {
    key: "breeze-tts-2|standard",
    model: "breeze-tts-2",
    kind: "audio",
    label: "语音生成",
    amount: 1,
  },
  {
    key: "flow:flux|1K",
    model: "flow:flux",
    kind: "image",
    label: "Flow 1K",
    amount: null,
  },
  {
    key: "hidden-model|default",
    model: "hidden-model",
    kind: "image",
    label: "隐藏档位",
    amount: null,
  },
  {
    key: "custom-model|std",
    model: "custom-model",
    kind: "image",
    label: "标准",
    amount: null,
  },
];

test("summarizePrices treats blank values as unpriced and 0 as priced free open", () => {
  const values = priceValues(items);
  assert.equal(values["MiniMax H3|768p|6s"], "");
  assert.equal(values["MiniMax H3|1080p|6s"], "0");
  assert.equal(isPriceUnset(""), true);
  assert.equal(isPriceUnset("   "), true);
  assert.equal(isPriceUnset(undefined), true);
  assert.equal(isPriceUnset("0"), false);
  assert.equal(isPriceUnset("1"), false);

  const summary = summarizePrices(items, catalog, values);
  assert.equal(PRICE_CREDIT_RATE_TEXT, "¥1 = 10 积分");
  assert.equal(summary.total, 5);
  assert.equal(summary.priced, 2);
  assert.equal(summary.unpriced, 3);
  assert.deepEqual(
    summary.sections.map((section) => ({
      key: section.key,
      label: section.label,
      count: section.rows.length,
      unpriced: section.unpriced,
    })),
    [
      { key: "MiniMax H3", label: "MiniMax H3 · 视频", count: 2, unpriced: 1 },
      {
        key: "breeze-tts-2",
        label: "Breeze TTS 2 · 语音",
        count: 1,
        unpriced: 0,
      },
      { key: "flow:image", label: "Flow · 图片", count: 1, unpriced: 1 },
      { key: "custom-model", label: "自定义模型", count: 1, unpriced: 1 },
    ],
  );
});

test("summarizePrices updates counts live as draft inputs switch between blank, 0 and positive integers", () => {
  const values = {
    ...priceValues(items),
    "MiniMax H3|768p|6s": "0",
    "breeze-tts-2|standard": "",
  };
  assert.equal(pricesChanged(items, values), true);

  const summary = summarizePrices(items, catalog, values);
  assert.equal(summary.total, 5);
  assert.equal(summary.priced, 2);
  assert.equal(summary.unpriced, 3);
  assert.equal(
    summary.sections.find((s) => s.key === "MiniMax H3")?.unpriced,
    0,
  );
  assert.equal(
    summary.sections.find((s) => s.key === "breeze-tts-2")?.unpriced,
    1,
  );
});

test("summarizePrices handles an empty visible catalog cleanly", () => {
  const summary = summarizePrices([], {}, {});
  assert.deepEqual(summary, {
    sections: [],
    total: 0,
    priced: 0,
    unpriced: 0,
  });
});
