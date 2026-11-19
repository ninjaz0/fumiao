import { useState, type FormEvent } from "react";
import type { InstalledSettingsPage } from "../../../packages/plugin-sdk/src/settings-pages";
import type { AdminSave } from "./settings-admin";

export function PluginSettingsPage({
  page,
  request,
  refresh,
  notify,
}: AdminSave & { page: InstalledSettingsPage }) {
  const [draft, setDraft] = useState<{
    revision: number;
    values: Record<string, string>;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const values = draft?.values ?? page.values;
  const stale = !!draft && draft.revision !== page.revision;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || stale || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `/api/admin/plugins/${page.plugin}/pages/${page.id}`,
        draft,
        "PUT",
      );
      await refresh();
      setDraft(undefined);
      notify("插件设置已保存");
    } catch (cause) {
      setError((cause as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section extension-settings">
      <h2>{page.title}</h2>
      <p className="muted">
        {page.label} · {page.version}
      </p>
      <form className="ledger-card" onSubmit={save}>
        <fieldset disabled={busy || page.removing}>
          {page.fields.map((field) => (
            <label className="setting-row" key={field.id}>
              {field.label}
              <select
                value={values[field.id]}
                onChange={(event) => {
                  setError("");
                  setDraft({
                    revision: draft?.revision ?? page.revision,
                    values: {
                      ...values,
                      [field.id]: event.currentTarget.value,
                    },
                  });
                }}
              >
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
          <button className="primary" disabled={!draft || stale}>
            保存
          </button>
          {stale && (
            <button
              className="quiet-button"
              type="button"
              onClick={() => {
                setDraft(undefined);
                setError("");
              }}
            >
              载入最新设置
            </button>
          )}
        </fieldset>
      </form>
      <p role="status">
        {page.removing
          ? "等待已受理任务结束后移除"
          : stale
            ? "设置已变化，当前修改尚未保存。"
            : error}
      </p>
    </section>
  );
}
