import { useRef, useState, type FormEvent } from "react";
import type { AdminSave } from "./settings-admin";
import type { StudioState } from "./state";

type PriceDraft = {
  pricing: StudioState["pricing"];
  catalog: StudioState["model_catalog"];
  values: Record<string, string>;
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

function priceValues(pricing: StudioState["pricing"]): Record<string, string> {
  return Object.fromEntries(
    pricing.items.map(({ key, amount }) => [
      key,
      amount === null ? "" : String(amount),
    ]),
  );
}

function changed(
  pricing: StudioState["pricing"],
  values: Record<string, string>,
) {
  return pricing.items.some(
    ({ key, amount }) => values[key] !== String(amount ?? ""),
  );
}

export function PriceSettings({
  state,
  visible,
  request,
  refresh,
  notify,
}: AdminSave & { state: StudioState; visible: boolean }) {
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [confirmed, setConfirmed] = useState<StudioState["pricing"] | null>(
    null,
  );
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!visible) return null;

  const latest =
    confirmed && confirmed.revision > state.pricing.revision
      ? confirmed
      : state.pricing;
  const pricing = draft?.pricing ?? latest;
  const catalog = draft?.catalog ?? state.model_catalog;
  const values = draft?.values ?? priceValues(pricing);
  const dirty = draft !== null && changed(pricing, values);
  const stale = latest.revision !== pricing.revision;

  function change(key: string, value: string) {
    const next = { ...values, [key]: value };
    setDraft(
      pending.current || changed(pricing, next)
        ? { pricing, catalog, values: next }
        : null,
    );
    setMessage("");
  }

  const labels = new Map<string, string>(sections);
  const groups = new Map<string, StudioState["pricing"]["items"]>(
    sections.map(([key]) => [key, []]),
  );
  for (const price of pricing.items) {
    if (!catalog[price.model] || catalog[price.model].hidden) continue;
    const key =
      catalog[price.model]?.provider === "flow" &&
      price.model.startsWith("flow:")
        ? "flow:" + price.kind
        : price.model;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(price);
  }
  for (const [key, prices] of groups) if (!prices.length) groups.delete(key);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === "" ? null : Number(value),
      ]),
    );
    pending.current = true;
    setDraft({ pricing, catalog, values });
    setBusy(true);
    setMessage("");
    try {
      const saved = (await request(
        "/api/settings/prices",
        { values: payload, expected_revision: pricing.revision },
        "PUT",
      )) as StudioState["pricing"];
      setConfirmed(saved);
      setDraft((current) => {
        if (!current || current.values === values) return null;
        // Carry only edits made after submission onto this save's acknowledged revision.
        const next = priceValues(saved);
        for (const key of Object.keys(next)) {
          if (current.values[key] !== values[key])
            next[key] = current.values[key];
        }
        return changed(saved, next)
          ? { pricing: saved, catalog, values: next }
          : null;
      });
      await refresh();
      notify("价格已保存");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
      setDraft((current) =>
        current && changed(current.pricing, current.values) ? current : null,
      );
    }
  }

  return (
    <div className="settings-content">
      <section className="settings-section">
        <h2>生成定价</h2>
        {dirty && (
          <div
            className="ledger-card"
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <span>
              {stale
                ? "有未保存的修改（服务端定价已更新，请核对或还原）"
                : "有未保存的修改"}
            </span>
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setMessage("");
              }}
            >
              还原
            </button>
          </div>
        )}
        <form id="price-form" onSubmit={save}>
          {Array.from(groups, ([key, rows]) => (
            <PriceSection
              key={key}
              label={labels.get(key) || catalog[key]?.label || key}
              rows={rows}
              values={values}
              onChange={change}
            />
          ))}
          <p className="form-message" role="status">
            {message}
          </p>
          <button className="primary" type="submit" disabled={busy}>
            保存价格
          </button>
        </form>
      </section>
    </div>
  );
}

function PriceSection({
  label,
  rows,
  values,
  onChange,
}: {
  label: string;
  rows: StudioState["pricing"]["items"];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <section className="ledger-card">
      <h3 className="credit-heading">{label}</h3>
      {rows.map((price) => (
        <label key={price.key} className="price-row">
          <span>{price.label}</span>
          <span>
            <input
              type="number"
              data-price={price.key}
              value={values[price.key] ?? ""}
              min="0"
              max="1000000000"
              step="1"
              placeholder="未定价"
              aria-label={label + " " + price.label}
              onChange={(event) =>
                onChange(price.key, event.currentTarget.value)
              }
            />
            <span>积分</span>
          </span>
        </label>
      ))}
    </section>
  );
}
