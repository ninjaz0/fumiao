import { useRef, useState, type FormEvent } from "react";
import type { AdminSave } from "./settings-admin";
import type { StudioState } from "./state";

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

export function PriceSettings({
  state,
  request,
  refresh,
  notify,
}: AdminSave & { state: StudioState }) {
  const [visit, setVisit] = useState(0);
  return (
    <section className="settings-section">
      <h2>生成定价</h2>
      <PriceForm
        key={visit}
        state={state}
        request={request}
        notify={notify}
        refresh={async () => {
          await refresh();
          setVisit((current) => current + 1);
        }}
      />
    </section>
  );
}

function PriceForm({
  state,
  request,
  refresh,
  notify,
}: AdminSave & { state: StudioState }) {
  // An SSE update must not rebase edits onto a revision the administrator never saw.
  const [{ pricing, model_catalog: catalog }] = useState(state);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
    const form = event.currentTarget;
    const values = Object.fromEntries(
      pricing.items.map(({ key, amount }) => [key, amount]),
    );
    for (const input of form.querySelectorAll<HTMLInputElement>(
      "[data-price]",
    )) {
      values[input.dataset.price!] =
        input.value === "" ? null : input.valueAsNumber;
    }
    pending.current = true;
    setBusy(true);
    try {
      await request(
        "/api/settings/prices",
        { values, expected_revision: pricing.revision },
        "PUT",
      );
      await refresh();
      notify("价格已保存");
    } catch (error) {
      setMessage((error as Error).message);
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form id="price-form" onSubmit={save}>
      {Array.from(groups, ([key, rows]) => (
        <PriceSection
          key={key}
          label={labels.get(key) || catalog[key]?.label || key}
          rows={rows}
        />
      ))}
      <p className="form-message" role="status">
        {message}
      </p>
      <button className="primary" type="submit" disabled={busy}>
        保存价格
      </button>
    </form>
  );
}

function PriceSection({
  label,
  rows,
}: {
  label: string;
  rows: StudioState["pricing"]["items"];
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
              defaultValue={price.amount ?? ""}
              min="0"
              max="1000000000"
              step="1"
              placeholder="未定价"
              aria-label={label + " " + price.label}
            />
            <span>积分</span>
          </span>
        </label>
      ))}
    </section>
  );
}
