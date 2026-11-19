import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "./api";
import { Icon } from "./Icon";
import { openDialogFor } from "./AssetDialog";
import type { AdminConfirm, AdminOpen, AdminRequest } from "./settings-admin";
import type { StudioState } from "./state";

type Form = {
  label: string;
  nameLabel: string;
  group: string;
  namePath: string;
  path: string;
  nameField: string;
  optionsField: string;
  button: string;
  options: {
    value: string;
    label: string;
    detail: string;
    selected: boolean;
  }[];
  resultLabel: string;
  instructions: string;
};
type Panel = {
  title: string;
  notice?: string;
  empty: string;
  icon: "gpu";
  add: Form;
  rows: {
    id: number;
    title: string;
    status: string;
    metadata: string[];
    detail: string;
    actions: { op: string; label: string; summary: string; path: string }[];
  }[];
};

// Imported descriptions can only invoke the broker operations granted to this slot.
function allowedPath(path: string) {
  if (
    !/^\/api\/(pairs(?:\/default-name)?|nodes\/\d+\/(drain|stop|resume|remove))$/.test(
      path,
    )
  )
    throw Error("插件操作未授权");
  return path;
}
function PanelForm({
  form,
  workspace,
  name,
  notify,
}: {
  form: Form;
  workspace: string;
  name: string;
  notify: (s: string) => void;
}) {
  const [result, setResult] = useState<{ name: string; command: string }>(),
    [busy, setBusy] = useState(false);
  const pending = useRef(false),
    command = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const dialog = command.current && openDialogFor(command.current);
    if (!dialog) return;
    const clear = () => setResult(undefined);
    dialog.addEventListener("close", clear);
    return () => dialog.removeEventListener("close", clear);
  }, [result]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const element = e.currentTarget,
      data = new FormData(element),
      value = String(data.get("node") || "").trim();
    try {
      const reply = await api<{ name: string; command: string }>(
        workspace,
        allowedPath(form.path),
        {
          [form.nameField]: value === name ? "" : value,
          [form.optionsField]: data.getAll("models"),
        },
      );
      if (openDialogFor(element)) setResult(reply);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (result)
    return (
      <>
        <h2 id="modal-heading">
          {form.resultLabel} · {result.name}
        </h2>
        <p>{form.instructions}</p>
        <label className="formlabel">
          <textarea
            className="mono"
            ref={command}
            rows={4}
            readOnly
            value={result.command}
          />
        </label>
        <button
          className="primary"
          id="copy"
          onClick={() =>
            void navigator.clipboard.writeText(result.command).then(
              () => notify("已复制"),
              () => notify("请选中内容后手动复制"),
            )
          }
        >
          复制
        </button>
      </>
    );
  return (
    <>
      <h2 id="modal-heading">{form.label}</h2>
      <form id="pair" onSubmit={submit}>
        <label className="formlabel">
          {form.nameLabel}
          <input name="node" defaultValue={name} required maxLength={45} />
        </label>
        <fieldset className="install-models">
          <legend>{form.group}</legend>
          {form.options.map((o) => (
            <label className="check" key={o.value}>
              <input
                type="checkbox"
                name="models"
                value={o.value}
                defaultChecked={o.selected}
              />
              {o.label}
              <small>{o.detail}</small>
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={busy}>
          {form.button}
        </button>
      </form>
    </>
  );
}

export function PluginPanel({
  state,
  open,
  confirm,
  manage,
  notify,
}: {
  state: StudioState;
  open: AdminOpen;
  confirm: AdminConfirm;
  manage: AdminRequest;
  notify: (s: string) => void;
}) {
  const [view, setView] = useState<Panel>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const workspace = String(state.workspace_id),
    extension = state.gpu_node_settings!;
  const input = JSON.stringify({
    enabled: extension.enabled,
    pending: extension.pending,
    nodes: state.nodes,
    models: state.gpu_models,
    jobs: state.jobs.map(({ id, status, node }) => ({ id, status, node })),
  });
  useEffect(() => {
    let active = true;
    void api<Panel>(
      workspace,
      "/api/admin/plugins/" + extension.id + "/panel",
      JSON.parse(input),
    ).then(
      (v) => {
        if (active) {
          setError("");
          setView(v);
        }
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [workspace, extension.id, extension.version, input]);
  if (error) return <p role="alert">{error}</p>;
  if (!view) return null;
  async function add(button: HTMLButtonElement, form: Form) {
    setBusy(true);
    try {
      const { name } = await api<{ name: string }>(
        workspace,
        allowedPath(form.namePath),
      );
      if (button.isConnected)
        open(
          <PanelForm
            form={form}
            name={name}
            workspace={workspace}
            notify={notify}
          />,
          button,
        );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="management-view">
      <div className="page-heading">
        <h2>{view.title}</h2>
        <button
          className="primary"
          data-act="pair"
          disabled={busy}
          onClick={(e) => void add(e.currentTarget, view.add)}
        >
          <Icon name="plus" />
          {view.add.label}
        </button>
      </div>
      {view.notice && <p role="status">{view.notice}</p>}
      <div className="list-surface">
        {view.rows.length ? (
          view.rows.map((r) => (
            <article className="node-row" key={r.id}>
              <div className="node-heading">
                <span className="node-icon">
                  <Icon name="gpu" />
                </span>
                <h2>{r.title}</h2>
                <span className="node-state">{r.status}</span>
              </div>
              <div className="metadata">
                {r.metadata.map((m, i) => (
                  <span key={i}>{m}</span>
                ))}
              </div>
              {r.detail && <p className="install-detail">{r.detail}</p>}
              <div className="node-actions">
                {r.actions.map((a) => (
                  <button
                    key={a.op}
                    className="quiet-button"
                    data-act="node"
                    data-id={r.id}
                    data-op={a.op}
                    onClick={(e) =>
                      confirm(
                        a.label + "？",
                        a.summary,
                        async () => {
                          await manage(allowedPath(a.path), {});
                        },
                        e.currentTarget,
                      )
                    }
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">{view.empty}</div>
        )}
      </div>
    </div>
  );
}
