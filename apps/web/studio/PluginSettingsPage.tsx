import { useState, type FormEvent } from "react";
import type { InstalledSettingsPage } from "@fumiao/plugin-sdk/settings-pages";
import type { AdminSave } from "./settings-admin";

export function PluginSettingsPage({
  page,
  request,
  refresh,
  notify,
}: AdminSave & { page: InstalledSettingsPage }) {
  const [draft, setDraft] = useState<{
    revision: number;
    fields: InstalledSettingsPage["fields"];
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
        { revision: draft.revision, values: draft.values },
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
  const status = page.removing
    ? "等待已受理任务结束后移除"
    : stale
      ? "设置已变化，当前修改尚未保存。"
      : error;
  const isError = !page.removing && (stale || Boolean(error));
  return (
    <section className="settings-section extension-settings">
      <h2>{page.title}</h2>
      <p className="console-description">
        {page.label} · {page.version}
      </p>
      <form className="ledger-card" onSubmit={save}>
        <fieldset disabled={busy || page.removing}>
          {(draft?.fields ?? page.fields).map((field) => (
            <label className="setting-row" key={field.id}>
              <span>{field.label}</span>
              <select
                value={values[field.id]}
                onChange={(event) => {
                  setError("");
                  setDraft({
                    revision: draft?.revision ?? page.revision,
                    fields: draft?.fields ?? page.fields,
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
          <div className="extension-settings-actions">
            <button
              className="primary"
              type="submit"
              disabled={!draft || stale}
            >
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
          </div>
        </fieldset>
      </form>
      <p
        className={
          isError
            ? "extension-settings-status is-error"
            : "extension-settings-status"
        }
        role="status"
      >
        {status}
      </p>
    </section>
  );
}
