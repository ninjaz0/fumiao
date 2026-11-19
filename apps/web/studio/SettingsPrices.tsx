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
      {sections.map(([id, label]) => {
        const rows = pricing.items.filter(
          ({ model, kind }) =>
            !catalog?.[model]?.hidden &&
            (id === "flow:image" || id === "flow:video"
              ? model.startsWith("flow:") && id === "flow:" + kind
              : model === id),
        );
        if (!rows.length) return null;
        return <PriceSection key={id} label={label} rows={rows} />;
      })}
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
    <>
      <h3 className="credit-heading">{label}</h3>
      {rows.map((price) => (
        <label key={price.key} className="price-row">
          <span>{price.label}</span>
          <span>
            <input
              type="number"
              data-price={price.key}
              defaultValue={price.amount ?? ""}
              min="1"
              max="1000000000"
              step="1"
              placeholder="未定价"
              aria-label={label + " " + price.label}
            />
            <span>积分</span>
          </span>
        </label>
      ))}
    </>
  );
}
