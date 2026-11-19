import { useRef, useState, type FormEvent, type RefObject } from "react";
import type { AdminSave } from "./settings-admin";
import type { StudioState } from "./state";

export type PriceDraft = {
  workspace: number;
  revision: number;
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

export function PriceSettings({
  state,
  draft,
  request,
  refresh,
  notify,
}: AdminSave & {
  state: StudioState;
  draft: RefObject<PriceDraft | null>;
}) {
  const [visit, setVisit] = useState(0);
  return (
    <section className="settings-section">
      <h2>生成定价</h2>
      <PriceForm
        key={visit}
        state={state}
        draft={draft}
        request={request}
        notify={notify}
        reset={() => {
          draft.current = null;
          setVisit((current) => current + 1);
        }}
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
  draft,
  request,
  refresh,
  reset,
  notify,
}: AdminSave & {
  state: StudioState;
  draft: RefObject<PriceDraft | null>;
  reset: () => void;
}) {
  // An SSE update must not rebase edits onto a revision the administrator never saw.
  const [initial] = useState(() => {
    const saved =
      draft.current && draft.current.workspace === state.workspace_id
        ? draft.current
        : null;
    const pricing = saved ? saved.pricing : state.pricing;
    const catalog = saved ? saved.catalog : state.model_catalog;
    const baseline = Object.fromEntries(
      pricing.items.map(({ key, amount }) => [
        key,
        amount === null ? "" : String(amount),
      ]),
    );
    const values = saved ? { ...baseline, ...saved.values } : baseline;
    return {
      workspace: state.workspace_id,
      pricing,
      catalog,
      baseline,
      values,
    };
  });
  const { pricing, catalog } = initial;
  const [values, setValues] = useState(initial.values);
  const valuesRef = useRef(initial.values);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = Object.keys(initial.baseline).some(
    (key) => values[key] !== initial.baseline[key],
  );
  const stale = state.pricing.revision !== pricing.revision;

  function change(key: string, value: string) {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    const changed = Object.keys(initial.baseline).some(
      (itemKey) => next[itemKey] !== initial.baseline[itemKey],
    );
    draft.current = changed
      ? {
          workspace: initial.workspace,
          revision: pricing.revision,
          pricing,
          catalog,
          values: next,
        }
      : null;
    setValues(next);
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
    const form = event.currentTarget;
    const payload = Object.fromEntries(
      pricing.items.map(({ key, amount }) => [key, amount]),
    );
    for (const input of form.querySelectorAll<HTMLInputElement>(
      "[data-price]",
    )) {
      payload[input.dataset.price!] =
        input.value === "" ? null : input.valueAsNumber;
    }
    pending.current = true;
    setBusy(true);
    try {
      await request(
        "/api/settings/prices",
        { values: payload, expected_revision: pricing.revision },
        "PUT",
      );
      if (
        draft.current?.workspace === initial.workspace &&
        draft.current.revision === pricing.revision
      ) {
        draft.current = null;
      }
      await refresh();
      notify("价格已保存");
    } catch (error) {
      setMessage((error as Error).message);
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
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
            onClick={reset}
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
            initialValues={initial.values}
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
    </>
  );
}

function PriceSection({
  label,
  rows,
  initialValues,
  onChange,
}: {
  label: string;
  rows: StudioState["pricing"]["items"];
  initialValues: Record<string, string>;
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
              defaultValue={initialValues[price.key] ?? ""}
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
