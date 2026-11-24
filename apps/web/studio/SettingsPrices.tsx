import { useRef, useState, type FocusEvent, type FormEvent } from "react";
import type { AdminSave } from "./settings-admin";
import {
  PRICE_CREDIT_RATE_TEXT,
  pricesChanged,
  priceValues,
  summarizePrices,
} from "./settings-prices-helpers";
import type { StudioState } from "./state";

type PriceDraft = {
  pricing: StudioState["pricing"];
  catalog: StudioState["model_catalog"];
  values: Record<string, string>;
};

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
  const actions = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  if (!visible) return null;

  const latest =
    confirmed && confirmed.revision > state.pricing.revision
      ? confirmed
      : state.pricing;
  const pricing = draft?.pricing ?? latest;
  const catalog = draft?.catalog ?? state.model_catalog;
  const values = draft?.values ?? priceValues(pricing.items);
  const dirty = draft !== null && pricesChanged(pricing.items, values);
  const stale = latest.revision !== pricing.revision;

  function change(key: string, value: string) {
    const next = { ...values, [key]: value };
    setDraft(
      pending.current || pricesChanged(pricing.items, next)
        ? { pricing, catalog, values: next }
        : null,
    );
    setSaveError("");
  }

  const summary = summarizePrices(pricing.items, catalog, values);

  function revealFocusedPrice({ target }: FocusEvent<HTMLFormElement>) {
    if (!(target instanceof HTMLInputElement)) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== target) return;
      const bar = actions.current?.getBoundingClientRect();
      const input = target.getBoundingClientRect();
      if (bar && input.top < bar.bottom && input.bottom > bar.top)
        window.scrollBy({ top: input.bottom - bar.top + 8, behavior: "instant" });
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !dirty) return;
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === "" ? null : Number(value),
      ]),
    );
    pending.current = true;
    setDraft({ pricing, catalog, values });
    setBusy(true);
    setSaveError("");
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
        const next = priceValues(saved.items);
        for (const key of Object.keys(next)) {
          if (current.values[key] !== values[key])
            next[key] = current.values[key];
        }
        return pricesChanged(saved.items, next)
          ? { pricing: saved, catalog, values: next }
          : null;
      });
      await refresh();
      notify("价格已保存");
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
      setDraft((current) =>
        current && pricesChanged(current.pricing.items, current.values)
          ? current
          : null,
      );
    }
  }

  return (
    <div className="settings-content">
      <section className="settings-section price-settings">
        <h2>生成定价</h2>
        <p className="console-description">
          设置每种生成规格消耗的积分，保存后对新任务生效。留空表示未定价（成员暂不可发起该档位生成）；填{" "}
          <code>0</code> 表示免费开放。
        </p>
        <dl className="console-stats price-stats">
          <div>
            <dt>未定价档位</dt>
            <dd className={summary.unpriced > 0 ? "is-unpriced" : undefined}>
              {summary.unpriced}
            </dd>
          </div>
          <div>
            <dt>已定价档位</dt>
            <dd>
              {summary.priced}
              <small>{` / ${summary.total}`}</small>
            </dd>
          </div>
          <div className="price-rate-stat">
            <dt>积分换算参考</dt>
            <dd className="price-rate">{PRICE_CREDIT_RATE_TEXT}</dd>
          </div>
        </dl>
        <form id="price-form" onSubmit={save} onFocus={revealFocusedPrice}>
          {summary.sections.map((section) => (
            <PriceSection
              key={section.key}
              label={section.label}
              rows={section.rows}
              unpriced={section.unpriced}
              values={values}
              onChange={change}
            />
          ))}
          <div className="price-form-actions" ref={actions}>
            <div className="price-form-action-row">
              <span className="price-form-status" role="status">
                {dirty &&
                  (stale
                    ? "有未保存的修改（服务端定价已更新，请核对或还原）"
                    : "有未保存的修改")}
              </span>
              <div className="price-form-buttons">
                <button
                  type="button"
                  className="quiet-button"
                  disabled={busy || !dirty}
                  onClick={() => {
                    setDraft(null);
                    setSaveError("");
                  }}
                >
                  还原
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !dirty}
                >
                  保存价格
                </button>
              </div>
            </div>
            <p className="form-message" role="alert">
              {saveError}
            </p>
          </div>
        </form>
      </section>
    </div>
  );
}

function PriceSection({
  label,
  rows,
  unpriced,
  values,
  onChange,
}: {
  label: string;
  rows: StudioState["pricing"]["items"];
  unpriced: number;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <section className="ledger-card">
      <h3 className="credit-heading console-model-heading price-card-heading">
        <span>{label}</span>
        <span
          className={
            unpriced > 0
              ? "price-section-badge is-unpriced"
              : "price-section-badge is-complete"
          }
        >
          {unpriced > 0
            ? `${unpriced} / ${rows.length} 未定价`
            : `全部已定价（${rows.length}）`}
        </span>
      </h3>
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
