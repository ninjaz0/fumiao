"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  ImporterEntry,
  ImportResult,
} from "@fumiao/plugin-sdk/importers.js";
import { api } from "./api";
import styles from "./PluginImport.module.css";

type Props = {
  entries?: ImporterEntry[];
  target: ImporterEntry["target"];
  workspace: string;
  onImported: (result: ImportResult) => void | Promise<void>;
};

export function PluginImport({
  entries,
  target,
  workspace,
  onImported,
}: Props) {
  const available = (entries ?? []).filter((item) => item.target === target);
  const label = target === "assets" ? "导入素材" : "导入画布";
  const key = (item: ImporterEntry) =>
    [item.plugin, item.id, item.version].join("/");
  const [selected, setSelected] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ input: string; requestId: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const titleId = useId();
  const entry =
    available.find((item) => key(item) === selected) ?? available[0];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!entry) return null;
  async function submit() {
    if (busy || !source.trim()) return;
    const input = JSON.stringify([workspace, key(entry), source.trim()]);
    if (retry.current?.input !== input)
      retry.current = { input, requestId: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await api<ImportResult>(
        workspace,
        `/api/plugins/${entry.plugin}/importers/${entry.id}`,
        {
          source,
          version: entry.version,
          requestId: retry.current.requestId,
        },
      );
      if (!mounted.current) return;
      await onImported(result);
      if (!mounted.current) return;
      dialog.current?.close();
      setSource("");
      retry.current = null;
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : "导入失败");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="quiet-button secondary"
        onClick={() => dialog.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className={styles.dialog}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 id={titleId}>{label}</h2>
          <label>
            导入方式
            <select
              value={key(entry)}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value);
                setSource("");
                setError("");
              }}
            >
              {available.map((item) => (
                <option key={key(item)} value={key(item)}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {entry.inputLabel}
            <textarea
              required
              maxLength={65536}
              rows={5}
              value={source}
              disabled={busy}
              placeholder={entry.placeholder}
              onChange={(event) => {
                setSource(event.target.value);
                setError("");
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => dialog.current?.close()}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !source.trim()}
            >
              {busy ? "正在导入…" : "导入"}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
