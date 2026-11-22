export const PRICE_CREDIT_RATE_TEXT = "¥1 = 10 积分";

export type PriceItem = {
  key: string;
  model: string;
  kind: string;
  label: string;
  amount: number | null;
};

export type PriceCatalogEntry = {
  label: string;
  provider?: string;
  hidden?: boolean;
};

export type PriceSectionSummary<T extends PriceItem = PriceItem> = {
  key: string;
  label: string;
  rows: T[];
  unpriced: number;
};

export type PriceSummary<T extends PriceItem = PriceItem> = {
  sections: PriceSectionSummary<T>[];
  total: number;
  priced: number;
  unpriced: number;
};

// The original settings page orders and labels these price sections explicitly.
const sections = [
  ["MiniMax H3", "MiniMax H3 · 视频"],
  ["muse-video", "Muse · 视频"],
  ["gpt-image-2.6-sunburst", "gpt-image-2.6 · 图片"],
  ["muse-image", "Muse · 图片"],
  ["breeze-tts-2", "Breeze TTS 2 · 语音"],
  ["deepseek-flash", "DeepSeek Flash · 对话"],
  ["gpt-4.1", "GPT-4.1 · 对话"],
  ["flow:image", "Flow · 图片"],
  ["flow:video", "Flow · 视频"],
] as const;

const sectionLabels = new Map<string, string>(sections);

export function priceValues(
  items: readonly PriceItem[],
): Record<string, string> {
  return Object.fromEntries(
    items.map(({ key, amount }) => [
      key,
      amount === null ? "" : String(amount),
    ]),
  );
}

export function pricesChanged(
  items: readonly PriceItem[],
  values: Record<string, string>,
): boolean {
  return items.some(({ key, amount }) => values[key] !== String(amount ?? ""));
}

export function isPriceUnset(value: string | undefined): boolean {
  return (value ?? "").trim() === "";
}

export function summarizePrices<T extends PriceItem>(
  items: readonly T[],
  catalog: Record<string, PriceCatalogEntry>,
  values: Record<string, string>,
): PriceSummary<T> {
  const groups = new Map<string, T[]>(sections.map(([key]) => [key, []]));
  for (const price of items) {
    const entry = catalog[price.model];
    if (!entry || entry.hidden) continue;
    const key =
      entry.provider === "flow" && price.model.startsWith("flow:")
        ? "flow:" + price.kind
        : price.model;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(price);
  }
  const visibleSections: PriceSectionSummary<T>[] = [];
  let total = 0;
  let unpriced = 0;
  for (const [key, rows] of groups) {
    if (!rows.length) continue;
    const sectionUnpriced = rows.filter((price) =>
      isPriceUnset(values[price.key]),
    ).length;
    total += rows.length;
    unpriced += sectionUnpriced;
    visibleSections.push({
      key,
      label: sectionLabels.get(key) || catalog[key]?.label || key,
      rows,
      unpriced: sectionUnpriced,
    });
  }
  return {
    sections: visibleSections,
    total,
    priced: total - unpriced,
    unpriced,
  };
}
