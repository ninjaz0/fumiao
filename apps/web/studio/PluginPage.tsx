import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { viewLeaves } from "@fumiao/plugin-sdk/view-blocks";
import type {
  ActionRequest,
  ActionResult,
  PluginPageEntry,
  View,
  ViewBlock,
  ViewButton,
  ViewField,
  ViewLeaf,
} from "@fumiao/plugin-sdk/contributions";
import { ApiError } from "../canvas/api";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import { mediaURL } from "./state";
import type { AdminOpen } from "./settings-admin";
import "./plugin-page.css";

export function pluginPageClient(
  workspace: number,
  plugin: string,
  page: string,
) {
  const path = `/api/plugins/${encodeURIComponent(plugin)}/pages/${encodeURIComponent(page)}`;
  return {
    view: <T = View,>() => api<T>(String(workspace), path + "/view", {}),
    action: (id: string, body: ActionRequest) =>
      api<ActionResult>(
        String(workspace),
        path + "/actions/" + encodeURIComponent(id),
        body,
      ),
  };
}
export type PluginPageClient = ReturnType<typeof pluginPageClient>;
type FormBlock = Extract<ViewBlock, { type: "form" }>;
type FieldValue = string | string[] | boolean;
type Values = Record<string, FieldValue>;

function ViewTabs({
  block,
  render,
}: {
  block: Extract<ViewBlock, { type: "tabs" }>;
  render: (block: ViewLeaf) => ReactNode;
}) {
  const prefix = useId();
  const [selected, setSelected] = useState(block.tabs[0].id);
  const active = block.tabs.some((tab) => tab.id === selected)
    ? selected
    : block.tabs[0].id;
  return (
    <div className="plugin-tabs">
      <div role="tablist" aria-label={block.label}>
        {block.tabs.map((tab, index) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            id={prefix + "-tab-" + tab.id}
            aria-controls={prefix + "-panel-" + tab.id}
            aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setSelected(tab.id)}
            onKeyDown={(event) => {
              const count = block.tabs.length;
              const next = {
                ArrowLeft: (index + count - 1) % count,
                ArrowRight: (index + 1) % count,
                Home: 0,
                End: count - 1,
              }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              const id = block.tabs[next].id;
              setSelected(id);
              document.getElementById(prefix + "-tab-" + id)?.focus();
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {block.tabs.map((tab) => (
        <section
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
          id={prefix + "-panel-" + tab.id}
          aria-labelledby={prefix + "-tab-" + tab.id}
          hidden={tab.id !== active}
        >
          {tab.blocks.map((child, index) => (
            <Fragment key={child.type === "form" ? child.id : index}>
              {render(child)}
            </Fragment>
          ))}
        </section>
      ))}
    </div>
  );
}

function initialValues(
  form: FormBlock,
  payload?: ViewButton["payload"],
): Values {
  return Object.fromEntries(
    form.fields.map((field) => {
      const value =
        payload && Object.hasOwn(payload, field.name)
          ? payload[field.name]
          : field.value;
      if (field.type === "checkbox") return [field.name, value === true];
      if (field.type === "multiselect")
        return [
          field.name,
          Array.isArray(value)
            ? value.filter((v) => typeof v === "string")
            : [],
        ];
      return [
        field.name,
        typeof value === "number" || typeof value === "string"
          ? String(value)
          : "",
      ];
    }),
  );
}

function Field({
  field,
  value,
  change,
}: {
  field: ViewField;
  value: FieldValue;
  change: (value: FieldValue) => void;
}) {
  const id = useId();
  const common = {
    id,
    name: field.name,
    required: field.required,
    "aria-describedby": field.help ? id + "-help" : undefined,
  };
  let control: ReactNode;
  switch (field.type) {
    case "checkbox":
      control = (
        <input
          {...common}
          type="checkbox"
          checked={value === true}
          onChange={(e) => change(e.target.checked)}
        />
      );
      break;
    case "select":
    case "multiselect": {
      const multiple = field.type === "multiselect";
      control = (
        <select
          {...common}
          multiple={multiple}
          value={value as string | string[]}
          onChange={(e) =>
            change(
              multiple
                ? Array.from(e.target.selectedOptions, (o) => o.value)
                : e.target.value,
            )
          }
        >
          {!multiple && !field.options?.some((o) => o.value === "") && (
            <option value="">{field.placeholder || "请选择"}</option>
          )}
          {field.options?.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
              {o.detail && " · " + o.detail}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "textarea":
      control = (
        <textarea
          {...common}
          rows={3}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(e) => change(e.target.value)}
        />
      );
      break;
    default:
      control = (
        <input
          {...common}
          type={field.type}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.type === "number" ? "any" : undefined}
          maxLength={field.maxLength}
          value={String(value)}
          onChange={(e) => change(e.target.value)}
        />
      );
  }
  return (
    <div className="plugin-field" data-type={field.type}>
      <label htmlFor={id}>{field.label}</label>
      {control}
      {field.help && <small id={id + "-help"}>{field.help}</small>}
    </div>
  );
}

function PageForm({
  block,
  trigger,
  disabled,
  submit,
  reload,
}: {
  block: FormBlock;
  trigger?: ViewButton;
  disabled: boolean;
  submit: (
    id: string,
    body: ActionRequest,
    element: HTMLElement,
  ) => Promise<void>;
  reload: () => Promise<View>;
}) {
  // Keep the fields and revision the user started editing together, including
  // when another form or action refreshes this page.
  const [draft, setDraft] = useState<{ form: FormBlock; values: Values }>();
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = draft?.form ?? block;
  const values = draft?.values ?? initialValues(form, trigger?.payload);
  const dialog = form.presentation === "dialog";
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (dialog)
      formRef.current
        ?.querySelector<HTMLElement>("input, textarea, select")
        ?.focus();
  }, [dialog]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || disabled || conflict) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const element =
      submitter instanceof HTMLElement ? submitter : e.currentTarget;
    setBusy(true);
    setError("");
    const payload: Record<string, unknown> = { ...trigger?.payload };
    for (const field of form.fields) {
      const value = values[field.name];
      if (field.type === "number" && value === "") delete payload[field.name];
      else
        payload[field.name] = field.type === "number" ? Number(value) : value;
    }
    try {
      await submit(
        form.submit.action,
        { target: trigger?.target, payload, revision: form.revision },
        element,
      );
      setDraft(undefined);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDraft({ form, values });
        setConflict(true);
        setError(cause.message + "。本次输入已保留。");
      } else setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function replaceDraft() {
    setBusy(true);
    try {
      const latest = viewLeaves((await reload()).blocks).find(
        (b): b is FormBlock =>
          b.type === "form" &&
          b.id === form.id &&
          b.presentation === form.presentation,
      );
      if (!latest) throw Error("此表单已移除");
      setDraft({ form: latest, values: initialValues(latest) });
      setConflict(false);
      setError("");
    } catch (cause) {
      setError((cause as Error).message + "。本次输入已保留。");
    } finally {
      setBusy(false);
    }
  }

  const title = form.title || trigger?.label || form.submit.label;
  return (
    <form
      ref={formRef}
      className="plugin-page-form"
      aria-label={title}
      onSubmit={save}
    >
      {dialog ? (
        <h2 id="modal-heading">{title}</h2>
      ) : (
        form.title && <h3>{title}</h3>
      )}
      <fieldset disabled={busy || disabled}>
        {form.fields.map((field) => (
          <Field
            key={field.name}
            field={field}
            value={values[field.name]}
            change={(value) =>
              setDraft({ form, values: { ...values, [field.name]: value } })
            }
          />
        ))}
        {error && <p role="alert">{error}</p>}
        <div className="plugin-page-actions">
          <button className="ledger-button ledger-primary" disabled={conflict}>
            {form.submit.label}
          </button>
          {conflict && (
            <button
              type="button"
              className="ledger-button"
              onClick={() => void replaceDraft()}
            >
              用最新值替换本次输入
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function CopyResult({
  result,
  notify,
}: {
  result: NonNullable<ActionResult["result"]>;
  notify: (message: string) => void;
}) {
  const value = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    value.current?.focus();
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.value);
      notify("已复制");
    } catch {
      value.current?.select();
      notify("请选中内容后手动复制");
    }
  }
  return (
    <>
      <h2 id="modal-heading">{result.title}</h2>
      {result.instructions && <p>{result.instructions}</p>}
      <label className="formlabel">
        {result.label}
        <textarea
          className="mono"
          rows={4}
          ref={value}
          readOnly
          value={result.value}
        />
      </label>
      <button className="primary" onClick={() => void copy()}>
        复制
      </button>
    </>
  );
}

function Confirmation({
  confirm,
  run,
}: {
  confirm: NonNullable<ViewButton["confirm"]>;
  run: (source: HTMLElement) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <h2 id="modal-heading">{confirm.title}</h2>
      <p>{confirm.summary}</p>
      {error && <p role="alert">{error}</p>}
      <div className="buttons">
        <button
          className="primary"
          disabled={busy}
          onClick={async (e) => {
            const source = e.currentTarget;
            setBusy(true);
            try {
              await run(source);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          确定
        </button>
        <button
          className="ghost"
          onClick={(e) => openDialogFor(e.currentTarget)?.close()}
        >
          取消
        </button>
      </div>
    </>
  );
}

export function PluginPage({
  page,
  client,
  open,
  refresh,
  notify,
}: {
  page: PluginPageEntry;
  client: PluginPageClient;
  open: AdminOpen;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const reading = useRef(0);
  const pending = useRef(false);
  const writable = page.audience === "admin";

  const load = useCallback(async () => {
    const seq = ++reading.current;
    try {
      const next = await client.view();
      if (seq === reading.current) {
        setView(next);
        setError("");
      }
      return next;
    } catch (cause) {
      if (seq === reading.current) {
        if (
          cause instanceof ApiError &&
          [401, 403, 404].includes(cause.status)
        ) {
          setView(undefined);
          if (modal.current) openDialogFor(modal.current)?.close();
        }
        setError(
          cause instanceof ApiError && cause.status === 422
            ? "插件设置页输出无效"
            : (cause as Error).message,
        );
      }
      throw cause;
    }
  }, [client]);
  const reread = () => load().catch(() => {}); // The page offers a retry on failure.
  useEffect(() => {
    void load().catch(() => {});
    return () => {
      ++reading.current;
    };
  }, [load]);
  useLayoutEffect(
    () => () => {
      if (modal.current) openDialogFor(modal.current)?.close();
    },
    [],
  );

  function show(body: ReactNode, opener: HTMLElement) {
    open(
      <div className="plugin-page-dialog" ref={modal}>
        {body}
      </div>,
      opener,
    );
  }

  async function act(id: string, body: ActionRequest, source: HTMLElement) {
    if (!root.current || !writable) throw Error("此设置页不可操作");
    if (pending.current) throw Error("请等待当前操作完成");
    const dialog = openDialogFor(source);
    pending.current = true;
    setBusy(true);
    try {
      const reply = await client.action(id, body);
      if (root.current) {
        if (reply.notice) notify(reply.notice);
        if (source.isConnected && (!dialog || dialog.open)) {
          if (reply.result)
            show(<CopyResult result={reply.result} notify={notify} />, source);
          else dialog?.close();
        }
        await Promise.all([
          reread(),
          reply.refresh && refresh().catch((e) => notify(e.message)),
        ]);
      } else if (reply.refresh) await refresh();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function button(b: ViewButton, primary = false) {
    if (!writable) return null;
    async function run(source: HTMLElement) {
      if (b.opensForm) {
        const form = viewLeaves(view?.blocks ?? []).find(
          (f): f is FormBlock =>
            f.type === "form" &&
            f.id === b.opensForm &&
            f.presentation === "dialog",
        );
        if (!form) throw Error("找不到插件表单");
        show(
          <PageForm
            block={form}
            trigger={b}
            disabled={false}
            submit={act}
            reload={load}
          />,
          source,
        );
      } else
        await act(
          b.action,
          { target: b.target, payload: b.payload ?? {} },
          source,
        );
    }
    return (
      <button
        type="button"
        disabled={busy || !!error}
        data-tone={b.tone}
        className={primary ? "ledger-button ledger-primary" : "ledger-button"}
        onClick={(e) => {
          const source = e.currentTarget;
          if (b.confirm)
            show(<Confirmation confirm={b.confirm} run={run} />, source);
          else void run(source).catch((cause) => notify(cause.message));
        }}
      >
        {b.label}
      </button>
    );
  }

  function blockContent(block: ViewBlock): ReactNode {
    switch (block.type) {
      case "tabs":
        return <ViewTabs block={block} render={blockContent} />;
      case "table":
        return (
          <div className="plugin-table">
            <table>
              <caption>{block.title}</caption>
              <thead>
                <tr>
                  {block.columns.map((column, i) => (
                    <th key={i} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "progress": {
        const percent =
          block.max > 0
            ? Math.min(100, Math.round((block.value / block.max) * 100))
            : 0;
        return (
          <div className="plugin-progress" data-complete={percent >= 100}>
            <div className="plugin-progress-head">
              <span>{block.label}</span>
              <span className="plugin-progress-count">
                <strong>{block.value}</strong> / {block.max}
                <small>{percent}%</small>
              </span>
            </div>
            <progress
              value={block.value}
              max={block.max}
              aria-label={block.label}
            />
          </div>
        );
      }
      case "media": {
        const url = mediaURL(block.asset);
        return (
          <figure className="plugin-media">
            {block.kind === "image" ? (
              <img src={url} alt={block.label} loading="lazy" />
            ) : block.kind === "video" ? (
              <video
                src={url}
                controls
                preload="metadata"
                aria-label={block.label}
              />
            ) : (
              <audio
                src={url}
                controls
                preload="metadata"
                aria-label={block.label}
              />
            )}
            <figcaption>{block.label}</figcaption>
          </figure>
        );
      }
      case "notice":
        return (
          <p className="plugin-notice" role="status" data-tone={block.tone}>
            {block.text}
          </p>
        );
      case "text":
        return <p className="plugin-text">{block.text}</p>;
      case "stats":
        return (
          <dl className="ledger-tally plugin-stats">
            {block.items.map((item, i) => (
              <div key={i}>
                <dt>{item.label}</dt>
                <dd>
                  {item.value}
                  {item.hint && <small>{item.hint}</small>}
                </dd>
              </div>
            ))}
          </dl>
        );
      case "keyValue":
        return (
          <dl className="ledger-card ledger-facts plugin-facts">
            {block.items.map((item, i) => (
              <div key={i}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        );
      case "list":
        return (
          <section className="list-surface">
            {block.title && <h3>{block.title}</h3>}
            {block.rows.length ? (
              block.rows.map((row) => (
                <article className="node-row" key={row.id}>
                  <div className="node-heading">
                    {row.icon && (
                      <span className="node-icon">
                        <Icon name={row.icon} />
                      </span>
                    )}
                    <h4>{row.title}</h4>
                    {row.status && (
                      <span className="node-state" data-tone={row.tone}>
                        {row.status}
                      </span>
                    )}
                  </div>
                  {!!row.metadata.length && (
                    <div className="metadata">
                      {row.metadata.map((item, i) => (
                        <span key={i}>{item}</span>
                      ))}
                    </div>
                  )}
                  {row.detail && <p className="install-detail">{row.detail}</p>}
                  {writable && !!row.actions.length && (
                    <div className="plugin-page-actions">
                      {row.actions.map((b, i) => (
                        <span key={i}>{button(b)}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))
            ) : (
              <div className="empty-state">{block.empty}</div>
            )}
          </section>
        );
      case "form":
        return block.presentation === "inline" ? (
          <div className="ledger-card">
            <PageForm
              block={block}
              disabled={!writable || busy || !!error}
              submit={act}
              reload={load}
            />
          </div>
        ) : null;
    }
  }

  return (
    <div className="settings-section plugin-page" ref={root}>
      <div className="page-heading">
        <h2>{view?.title ?? page.title}</h2>
        {view?.primary && button(view.primary, true)}
      </div>
      {error && (
        <div className="ledger-card plugin-alert plugin-page-error">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="ledger-button"
            onClick={() => void reread()}
          >
            重试
          </button>
        </div>
      )}
      {!view && !error && <p role="status">正在加载…</p>}
      {view?.description && <p className="plugin-text">{view.description}</p>}
      {view && !view.blocks.length && (
        <div className="empty-state">暂无内容</div>
      )}
      {view?.blocks.map((block, i) => (
        <Fragment key={block.type === "form" ? "form:" + block.id : i}>
          {blockContent(block)}
        </Fragment>
      ))}
    </div>
  );
}
