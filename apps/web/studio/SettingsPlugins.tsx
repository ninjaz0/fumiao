import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Boxes,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import type { SettingsTab } from "./settings-tabs";
import { api } from "./api";
import {
  MAX_SERVICE_CONCURRENCY,
  MIN_SERVICE_CONCURRENCY,
  buildUpdateSourcePayload,
  defaultServiceConcurrency,
  describeSavedService,
  findDuplicateModelIds,
  formatFieldDefault,
  modelKindLabels,
  isStringArrayField,
  parseFieldValue,
  parseServiceConcurrency,
  pluginFieldHint as fieldHint,
  pluginFieldLabel as label,
  readPluginFile,
  type PluginConfigField as Field,
} from "./settings-plugins-helpers";
import "./settings-plugins.css";

type Service = {
  values: Record<string, unknown>;
  configuredFields: string[];
  addressPause?: "non-public" | "unresolved";
  id: string;
  name: string;
  plugin_id: string;
  plugin_version: string;
  revision: number;
  enabled: boolean;
  concurrency: number;
};
type ServiceReport = {
  ready: boolean;
  models?: string[];
  available?: string[];
};
type Publisher = {
  name: string | null;
  fingerprint: string | null;
  previousFingerprint: string | null;
  change: string | null;
};
function PublisherInfo({ publisher }: { publisher: Publisher }) {
  if (!publisher.fingerprint) return <p>发布者签名 · 未签名</p>;
  return <div className="plugin-publisher">
    <p>发布者 · {publisher.name}</p>
    {publisher.change && <p>原公钥指纹 <code>{publisher.previousFingerprint}</code></p>}
    <p>{publisher.change ? "新公钥指纹" : "公钥指纹"} <code>{publisher.fingerprint}</code></p>
  </div>;
}
type Plugin = {
  publisher?: Publisher;
  rollbackPublisher?: Publisher | null;
  id: string;
  label: string;
  version: string;
  adapterVersion: string;
  removing: boolean;
  enabled: boolean;
  revision: number;
  mode: string;
  defaultConcurrency?: number;
  configSchema: { properties?: Record<string, Field>; required?: string[] };
  choices: {
    id: string;
    kind?: keyof typeof modelKindLabels;
    label: string;
    enabled: boolean;
    service: string | null;
    services: { id: string; name: string }[];
  }[];
  paymentMethods?: {id:string; title:string; enabled:boolean; configured:boolean}[];
  previousVersion: string | null;
  updateUrl: string | null;
  hasUpdateToken: boolean;
  checkedAt: string | null;
  updateInfo: {
    version?: string;
    notes?: string;
    sha256?: string;
    error?: string;
  } | null;
};
type Preview = {
  publisher?: Publisher;
  endpoint?: string;
  missing: { id: string; name: string; fields: (Field & { key: string })[] }[];
  changes: string[];
  id: string;
  label: string;
  version: string;
  models: string[];
  fields: string[];
  nodes: boolean;
};

function ServiceForm({
  plugin,
  service,
  save,
  onCancel,
}: {
  plugin: Plugin;
  service?: Service;
  save: (body: object) => Promise<void>;
  onCancel?: () => void;
}) {
  const [error, setError] = useState("");
  const prefix = useId();
  const entries = Object.entries(plugin.configSchema.properties || {});
  const requiredSet = new Set(plugin.configSchema.required || []);
  const requiredEntries = entries.filter(([key]) => requiredSet.has(key));
  const optionalEntries = entries.filter(([key]) => !requiredSet.has(key));
  const pluginDefaultConcurrency = defaultServiceConcurrency(plugin);
  const fallbackConcurrency =
    service?.concurrency ?? pluginDefaultConcurrency;
  const hasSavedOptional = Boolean(
    service &&
      optionalEntries.some(([key]) => service.configuredFields.includes(key)),
  );

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const config: Record<string, unknown> = {};
    let concurrency: number;
    try {
      for (const [key, field] of entries) {
        const raw = String(form.get(key) ?? "").trim();
        if (!raw) continue;
        const parsed = parseFieldValue(key, field, raw);
        if (Array.isArray(parsed) && parsed.length === 0 && !raw.startsWith("["))
          continue;
        config[key] = parsed;
      }
      concurrency = parseServiceConcurrency(
        String(form.get("$concurrency") ?? ""),
        fallbackConcurrency,
      );
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("请检查")
          ? err.message
          : "请检查服务设置的格式",
      );
      return;
    }
    await save(
      service
        ? {
            revision: service.revision,
            enabled: service.enabled,
            preserveCredentials: true,
            concurrency,
            config,
          }
        : {
            name: String(form.get("name") ?? "").trim(),
            pluginId: plugin.id,
            version: plugin.adapterVersion,
            concurrency,
            config,
          },
    );
  }

  function renderField(key: string, f: Field) {
    const schemaRequired = requiredSet.has(key);
    const configured = Boolean(service?.configuredFields.includes(key));
    const required = schemaRequired && !configured;
    const inputId = `${prefix}-${key}`;
    const hint = fieldHint(key, f, Boolean(service), configured);
    const hintId = hint ? `${inputId}-hint` : undefined;
    const tagText =
      service && f.writeOnly && configured
        ? "已保存"
        : schemaRequired
          ? "必填"
          : "可选";
    const placeholder =
      configured && service?.values[key] === undefined
        ? "已保存，留空沿用"
        : key === "baseUrl"
          ? "https://api.example.com"
          : key === "publicUrl"
            ? "https://media.example.com"
            : key === "artifactOrigins"
              ? "https://cdn.example.com"
              : undefined;

    return (
      <div className="plugin-field" key={key}>
        <div className="plugin-field-head">
          <label htmlFor={inputId}>{label(key, f)}</label>
          <span
            className="plugin-field-tag"
            data-tone={
              service && f.writeOnly && configured
                ? "ok"
                : schemaRequired
                  ? "required"
                  : "optional"
            }
          >
            {tagText}
          </span>
        </div>
        {f.type === "string" && f.enum && !f.writeOnly ? (
          <select
            id={inputId}
            aria-describedby={hintId}
            name={key}
            required={required}
            defaultValue={String(service?.values[key] ?? "")}
          >
            <option value="">
              {configured ? "沿用当前选项" : "请选择"}
            </option>
            {f.enum.map((value) => (
              <option key={String(value)} value={String(value)}>
                {String(value)}
              </option>
            ))}
          </select>
        ) : isStringArrayField(f) && !f.writeOnly ? (
          <textarea
            id={inputId}
            aria-describedby={hintId}
            name={key}
            rows={2}
            autoComplete="off"
            defaultValue={f.writeOnly ? "" : formatFieldDefault(f, service?.values[key])}
            placeholder={placeholder}
            required={required}
          />
        ) : (
          <input
            id={inputId}
            aria-describedby={hintId}
            name={key}
            type={
              f.writeOnly
                ? "password"
                : key === "baseUrl" || key === "publicUrl"
                  ? "url"
                  : "text"
            }
            autoComplete="off"
            defaultValue={f.writeOnly ? "" : formatFieldDefault(f, service?.values[key])}
            placeholder={placeholder}
            required={required}
          />
        )}
        {hint && (
          <p id={hintId} className="plugin-field-hint">
            {hint}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="plugin-form" onSubmit={submit}>
      {!service && (
        <div className="plugin-field">
          <div className="plugin-field-head">
            <label htmlFor={`${prefix}-name`}>服务名称</label>
            <span className="plugin-field-tag" data-tone="required">
              必填
            </span>
          </div>
          <input
            id={`${prefix}-name`}
            name="name"
            required
            maxLength={80}
            defaultValue={plugin.label}
            aria-describedby={`${prefix}-name-hint`}
          />
          <p id={`${prefix}-name-hint`} className="plugin-field-hint">
            用于区分同一插件下的不同服务实例，例如「主服务」或「备用节点」。
          </p>
        </div>
      )}
      {requiredEntries.map(([key, f]) => renderField(key, f))}
      <div className="plugin-field">
        <div className="plugin-field-head">
          <label htmlFor={`${prefix}-concurrency`}>并行任务数量</label>
          <span className="plugin-field-tag" data-tone="optional">
            可选
          </span>
        </div>
        <input
          id={`${prefix}-concurrency`}
          name="$concurrency"
          type="number"
          min={MIN_SERVICE_CONCURRENCY}
          max={MAX_SERVICE_CONCURRENCY}
          step={1}
          inputMode="numeric"
          defaultValue={fallbackConcurrency}
          placeholder={String(fallbackConcurrency)}
          aria-describedby={`${prefix}-concurrency-hint`}
        />
        <p id={`${prefix}-concurrency-hint`} className="plugin-field-hint">
          单条服务允许同时执行的任务上限（1–100 的整数，默认{" "}
          {pluginDefaultConcurrency}），可按上游配额或吞吐能力调整。
        </p>
      </div>
      {optionalEntries.length > 0 && (
        <details
          className="plugin-optional-fields"
          open={hasSavedOptional || undefined}
        >
          <summary>
            <span>可选设置</span>
            <small>
              {optionalEntries.map(([key, f]) => label(key, f)).join("、")}
            </small>
            <ChevronDown size={14} />
          </summary>
          <div className="plugin-optional-body">
            {optionalEntries.map(([key, f]) => renderField(key, f))}
          </div>
        </details>
      )}
      {error && (
        <p className="plugin-feedback is-error" role="alert">
          {error}
        </p>
      )}
      <div className="plugin-form-actions">
        <button type="submit" className="console-primary">
          保存服务设置
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </form>
  );
}

function PluginDrawer({
  plugin,
  close,
  children,
}: {
  plugin: Plugin;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="plugin-drawer"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          close();
      }}
    >
      <header className="plugin-drawer-head">
        <div className="plugin-drawer-title">
          <span className="plugin-mark plugin-drawer-mark" aria-hidden="true">
            {plugin.id.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h3 id={heading}>{plugin.label} · 设置</h3>
            <p className="plugin-drawer-meta">
              <code>v{plugin.version}</code>
              <span>{plugin.mode === "pull" ? "节点服务" : "接口服务"}</span>
              <code>{plugin.id}</code>
            </p>
          </div>
        </div>
        <button
          type="button"
          className="plugin-drawer-close"
          aria-label="关闭插件设置"
          onClick={close}
        >
          <X size={16} />
        </button>
      </header>
      <div className="plugin-drawer-body">{children}</div>
    </dialog>
  );
}

export function PluginSettings({
  workspace,
  refresh,
  navigate,
  gpuTab,
}: {
  workspace: number;
  refresh: () => Promise<void>;
  navigate: (tab: SettingsTab) => void;
  gpuTab?: SettingsTab;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>();
  const [services, setServices] = useState<Service[]>();
  const [pluginsError, setPluginsError] = useState("");
  const [servicesError, setServicesError] = useState("");
  const [loadingPlugins, setLoadingPlugins] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [reports, setReports] = useState<Record<string, ServiceReport>>({});
  const [reportErrors, setReportErrors] = useState<Record<string, string>>({});
  const [testingService, setTestingService] = useState("");
  const [opened, setOpened] = useState(""),
    [editing, setEditing] = useState(""),
    [renamingModel, setRenamingModel] = useState(""),
    [confirmAction, setConfirmAction] = useState<"" | "rollback" | "remove">(
      "",
    );
  const [pending, setPending] = useState<{
    file?: unknown;
    sha256?: string;
    notes?: string;
    preview: Preview;
  }>();
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    locked = useRef(false),
    pluginsReq = useRef(0),
    servicesReq = useRef(0),
    picker = useRef<HTMLInputElement>(null),
    drawerAlert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error && opened)
      drawerAlert.current?.scrollIntoView({ block: "nearest" });
  }, [error, opened]);
  const call = <T,>(path: string, body?: object, method?: string) =>
    api<T>(String(workspace), "/api/admin/" + path, body, method);
  function openDrawer(id: string) {
    setOpened(id);
    setEditing("");
    setRenamingModel("");
    setConfirmAction("");
    setError("");
    setMessage("");
  }
  function closeDrawer() {
    setOpened("");
    setEditing("");
    setRenamingModel("");
    setConfirmAction("");
  }
  function clearReport(id: string) {
    setReports((old) => {
      if (!(id in old)) return old;
      const next = { ...old };
      delete next[id];
      return next;
    });
    setReportErrors((old) => {
      if (!(id in old)) return old;
      const next = { ...old };
      delete next[id];
      return next;
    });
  }
  async function loadPlugins() {
    const seq = ++pluginsReq.current;
    if (active.current) setLoadingPlugins(true);
    try {
      const list = await call<Plugin[]>("plugins");
      if (active.current && seq === pluginsReq.current) {
        setPlugins(list);
        setPluginsError("");
      }
    } catch (e) {
      if (active.current && seq === pluginsReq.current) {
        setPluginsError((e as Error).message || "读取插件列表失败");
      }
    } finally {
      if (active.current && seq === pluginsReq.current) {
        setLoadingPlugins(false);
      }
    }
  }
  async function loadServices() {
    const seq = ++servicesReq.current;
    if (active.current) setLoadingServices(true);
    try {
      const list = await call<Service[]>("connections");
      if (active.current && seq === servicesReq.current) {
        setServices(list);
        setServicesError("");
      }
    } catch (e) {
      if (active.current && seq === servicesReq.current) {
        setServicesError((e as Error).message || "读取服务清单失败");
      }
    } finally {
      if (active.current && seq === servicesReq.current) {
        setLoadingServices(false);
      }
    }
  }
  async function load() {
    await Promise.allSettled([loadPlugins(), loadServices()]);
  }
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      ++pluginsReq.current;
      ++servicesReq.current;
    };
  }, [workspace]);
  async function run(
    action: () => Promise<unknown>,
    success = "",
    reload = true,
  ) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      if (reload) {
        await load();
        await refresh();
      }
      if (active.current) setMessage(success);
    } catch (e) {
      if (active.current) {
        setError((e as Error).message);
        if (reload) await load();
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const existing = plugins?.find((p) => p.id === pending?.preview.id);
  const sameVersion =
    Boolean(pending) && existing?.version === pending?.preview.version;
  const expandedPlugin = plugins?.find((p) => p.id === opened);
  const showingInlineServiceError = Boolean(
    expandedPlugin && expandedPlugin.mode !== "pull",
  );
  const enabled = plugins?.filter((p) => p.enabled).length ?? 0;
  return (
    <section className="settings-section studio-plugins">
      <fieldset disabled={busy}>
        <header className="plugin-heading">
          <div>
            <h2>插件</h2>
            <p>管理生成服务的版本、连接和可用模型。开关对全平台生效。</p>
          </div>
          <div className="plugin-actions">
            <button
              className="console-primary"
              onClick={() => picker.current?.click()}
            >
              <Plus size={15} />
              导入插件
            </button>
            <input
              ref={picker}
              hidden
              type="file"
              accept=".json,application/json"
              aria-label="选择插件文件"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                setPending(undefined);
                if (file)
                  void run(
                    async () => {
                      if (file.size > 3 * 1024 * 1024)
                        throw Error("插件文件过大");
                      const content = await readPluginFile(file);
                      const preview = await call<Preview>(
                        "plugins/preview",
                        content,
                      );
                      setPending({ file: content, preview });
                    },
                    "",
                    false,
                  );
              }}
            />
            {plugins?.some((p) => p.updateUrl) && (
              <button
                onClick={() =>
                  void run(async () => {
                    for (const p of plugins.filter((x) => x.updateUrl))
                      await call("plugins/" + p.id + "/check", {});
                  }, "已检查更新")
                }
              >
                检查更新
              </button>
            )}
          </div>
        </header>
        {!expandedPlugin && error && (
          <p className="plugin-feedback is-error" role="alert">
            {error}
          </p>
        )}
        {!expandedPlugin && message && (
          <p className="plugin-feedback is-ok" role="status">
            {message}
          </p>
        )}
        {pending && (
          <form
            className="ledger-card plugin-overview plugin-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (sameVersion) return;
              const form = new FormData(e.currentTarget);
              void run(
                async () => {
                  const supplements = Object.fromEntries(
                    pending.preview.missing.map((s) => [
                      s.id,
                      Object.fromEntries(
                        s.fields.map((f) => {
                          const value = String(
                            form.get(s.id + "-" + f.key) ?? "",
                          );
                          return [
                            f.key,
                            !f.type || f.type === "string"
                              ? value
                              : JSON.parse(value),
                          ];
                        }),
                      ),
                    ]),
                  );
                  const confirmPublisher = form.get("confirmPublisher") || undefined;
                  if (pending.sha256)
                    await call("plugins/" + pending.preview.id + "/update", {
                      revision: existing?.revision,
                      sha256: pending.sha256,
                      confirmPublisher,
                      supplements,
                    });
                  else
                    await call("plugins/import", {
                      file: pending.file,
                      confirmPublisher,
                      revision: existing?.revision,
                      supplements,
                    });
                  setOpened(pending.preview.id);
                  setEditing("");
                  setRenamingModel("");
                  setConfirmAction("");
                  setPending(undefined);
                },
                existing ? "插件已更新" : "插件已导入",
              );
            }}
          >
            <h3>
              {pending.preview.label} · {pending.preview.version}
            </h3>
            {pending.preview.publisher && <PublisherInfo publisher={pending.preview.publisher} />}
            {pending.preview.publisher?.change && (
              <label key={pending.preview.publisher.change}>
                <input type="checkbox" name="confirmPublisher" value={pending.preview.publisher.change} required />
                我已核对新公钥指纹，同意更换发布者公钥
              </label>
            )}
            <details>
              <summary>模型（{pending.preview.models.length}）</summary>
              <p>{pending.preview.models.join("、")}</p>
            </details>
            {pending.preview.endpoint && (
              <p>插件服务地址 · {pending.preview.endpoint}</p>
            )}
            {pending.preview.fields.length > 0 && (
              <p>
                需要配置{pending.preview.fields.map((k) => label(k)).join("、")}
              </p>
            )}
            {pending.preview.changes.map((c) => (
              <p key={c}>{c}</p>
            ))}
            {pending.preview.nodes && (
              <p>
                增加管理员设置「GPU 节点」，用于配对机器、分配任务和回传结果。
              </p>
            )}
            {pending.notes && <p>{pending.notes}</p>}
            {pending.preview.missing.map((service) => (
              <fieldset key={service.id}>
                <legend>{service.name} · 补充新版必填设置</legend>
                {service.fields.map((f) => (
                  <label key={f.key}>
                    {label(f.key, f)}
                    <input
                      required
                      name={service.id + "-" + f.key}
                      type={f.writeOnly ? "password" : "text"}
                      autoComplete="off"
                    />
                  </label>
                ))}
              </fieldset>
            ))}
            {sameVersion && (
              <p className="muted" role="status">
                当前已安装相同版本，无需重复导入
              </p>
            )}
            <div className="plugin-actions">
              <button type="submit" disabled={sameVersion}>
                {sameVersion ? "已安装" : existing ? "确认更新" : "确认导入"}
              </button>
              <button type="button" onClick={() => setPending(undefined)}>
                取消
              </button>
            </div>
          </form>
        )}
        {pluginsError && (
          <div className="ledger-card plugin-alert" role="alert">
            <span>插件列表读取失败：{pluginsError}</span>
            <button
              type="button"
              disabled={loadingPlugins}
              onClick={() => void (servicesError ? load() : loadPlugins())}
            >
              {loadingPlugins ? "重试中…" : "重试"}
            </button>
          </div>
        )}
        {servicesError &&
          plugins !== undefined &&
          !showingInlineServiceError && (
            <div className="ledger-card plugin-alert" role="alert">
              <span>服务清单读取失败：{servicesError}</span>
              <button
                type="button"
                disabled={loadingServices}
                onClick={() => void loadServices()}
              >
                {loadingServices ? "重试中…" : "重试"}
              </button>
            </div>
          )}
        {plugins && !plugins.length && !pending && (
          <div className="plugins-empty">
            <Boxes size={30} />
            <h3>暂无已安装的插件</h3>
            <p>导入 .fmplugin.json 插件包后，可在这里配置服务和模型。</p>
          </div>
        )}
        <div className="plugin-connections">
          {plugins?.map((p) => {
            const base = "plugins/" + p.id + "/",
              pluginServices = (services ?? []).filter(
                (s) =>
                  s.plugin_id === p.id && s.plugin_version === p.adapterVersion,
              );
            const action = (path: string, body: object, success?: string) =>
              run(
                () => call(base + path, { revision: p.revision, ...body }),
                success,
              );
            const toggle = (
              <label className="plugin-inline">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={p.label + "开关"}
                  checked={p.enabled}
                  disabled={p.removing}
                  onChange={(e) =>
                    void action(
                      "state",
                      {
                        action: e.target.checked ? "enable" : "disable",
                      },
                      e.target.checked
                        ? `${p.label} 已开启（全平台生效）`
                        : `${p.label} 已停用（全平台生效）`,
                    )
                  }
                />
                {p.removing
                  ? "等待已受理任务结束后移除"
                  : p.enabled
                    ? "已开启"
                    : "已关闭"}
              </label>
            );
            return (
              <article className="plugin-connection" key={p.id}>
                <div className="plugin-card-head">
                  <span className="plugin-mark" aria-hidden="true">
                    {p.id.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{p.label}</strong> <code>{p.version}</code>
                    <small>
                      {p.mode === "extension" ? "工作区扩展" : p.choices.length + " 个模型 · " + (p.mode === "pull" ? "节点服务" : "接口服务")}
                    </small>
                  </div>
                  {opened !== p.id && toggle}
                </div>
                <div className="plugin-card-status">
                  <span data-enabled={p.enabled}>
                    {p.removing
                      ? "等待任务结束后移除"
                      : p.enabled
                        ? "已启用"
                        : "已停用"}
                  </span>
                  {p.updateInfo?.version && <span>有可用更新</span>}
                </div>
                <div className="plugin-card-foot">
                  <small>
                    {p.mode === "extension" ? "在宿主沙箱中运行" : p.mode === "pull"
                      ? "由配对节点处理任务"
                      : servicesError
                        ? "服务清单读取失败"
                        : !services
                          ? "正在读取服务…"
                          : pluginServices.length
                            ? pluginServices
                                .map((service) => service.name)
                                .join("、")
                            : "尚未配置服务"}
                  </small>
                  <button
                    aria-expanded={opened === p.id}
                    onClick={() =>
                      opened === p.id ? closeDrawer() : openDrawer(p.id)
                    }
                  >
                    设置
                  </button>
                  {p.updateInfo?.version && (
                    <button
                      onClick={() => {
                        void run(async () => {
                          const preview = await call<Preview>(
                            base + "review",
                            {},
                          );
                          setPending({
                            sha256: p.updateInfo!.sha256,
                            notes: p.updateInfo!.notes,
                            preview,
                          });
                        });
                      }}
                    >
                      更新到 {p.updateInfo.version}
                    </button>
                  )}
                </div>
                {opened === p.id && (() => {
                  const enabledModelCount = p.choices.filter(
                    (c) => c.enabled,
                  ).length;
                  const duplicateIds = findDuplicateModelIds(p.id, plugins);
                  const needsService =
                    p.mode === "request" &&
                    services !== undefined &&
                    pluginServices.length === 0;
                  return (
                    <PluginDrawer plugin={p} close={closeDrawer}>
                      {error && (
                        <p
                          ref={drawerAlert}
                          className="plugin-feedback is-error"
                          role="alert"
                        >
                          {error}
                        </p>
                      )}
                      {message && (
                        <p className="plugin-feedback is-ok" role="status">
                          {message}
                        </p>
                      )}

                      <section
                        className="plugin-drawer-card plugin-master-card"
                        aria-label="插件总开关"
                      >
                        <div className="plugin-drawer-state">
                          <div className="plugin-master-title">
                            <h4>插件总开关</h4>
                            <span className="plugin-scope-pill">全平台生效</span>
                          </div>
                          {toggle}
                        </div>
                        <p className="plugin-section-desc">
                          {p.removing
                            ? "已提交移除请求；待已受理任务结束后自动卸载，期间不再受理新任务。"
                            : p.mode === "extension"
                              ? (p.enabled ? "此扩展已启用。" : "开启后，工作区可以使用此扩展。")
                            : p.enabled
                              ? "关闭后，所有工作区将停止接收新任务。已受理的任务继续运行。"
                              : needsService
                                ? "当前未开启。请先在下方添加并保存至少一个服务配置，再开启此插件。"
                                : "当前已停用，所有工作区均不可发起此插件任务。开启后，下方已勾选模型将按全站及团队策略对外开放。"}
                        </p>
                      </section>

                      {p.enabled &&
                        p.paymentMethods?.map((method) => {
                          const prefix = `payment-${p.id}-${method.id}`;
                          return (
                            <section
                              className="plugin-drawer-card"
                              key={method.id}
                            >
                              <div className="plugin-drawer-state">
                                <div className="plugin-master-title">
                                  <h4>{method.title}</h4>
                                  <span
                                    className="plugin-pill"
                                    data-tone={
                                      !method.configured
                                        ? "warn"
                                        : method.enabled
                                          ? "ok"
                                          : undefined
                                    }
                                  >
                                    {!method.configured
                                      ? "未配置"
                                      : method.enabled
                                        ? "已启用"
                                        : "已停用"}
                                  </span>
                                </div>
                                {method.configured && (
                                  <label className="plugin-inline">
                                    <input
                                      type="checkbox"
                                      checked={method.enabled}
                                      disabled={busy}
                                      onChange={(e) =>
                                        void action(
                                          "payment-methods/" + method.id,
                                          { enabled: e.target.checked },
                                          "渠道已更新",
                                        )
                                      }
                                    />
                                    允许新充值
                                  </label>
                                )}
                              </div>
                              <details className="plugin-drawer-details">
                                <summary>
                                  <span className="plugin-details-title">
                                    {method.configured
                                      ? "更换商户配置"
                                      : "配置商户"}
                                  </span>
                                  <span className="plugin-details-meta">
                                    <ChevronDown size={15} />
                                  </span>
                                </summary>
                                <div className="plugin-details-body">
                                  <form
                                    className="plugin-form"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const form = e.currentTarget;
                                      const data = new FormData(form);
                                      void run(async () => {
                                        await call(
                                          base + "payment-methods/" + method.id,
                                          {
                                            revision: p.revision,
                                            enabled: method.configured
                                              ? method.enabled
                                              : true,
                                            config: {
                                              gateway: data.get("gateway"),
                                              pid: data.get("pid"),
                                              key: data.get("key"),
                                              cid:
                                                data.get("cid") || undefined,
                                            },
                                          },
                                        );
                                        form.reset();
                                      }, "商户配置已保存");
                                    }}
                                  >
                                    <div className="plugin-field">
                                      <div className="plugin-field-head">
                                        <label htmlFor={`${prefix}-gateway`}>
                                          网关 HTTPS 地址
                                        </label>
                                        <span
                                          className="plugin-field-tag"
                                          data-tone="required"
                                        >
                                          必填
                                        </span>
                                      </div>
                                      <input
                                        id={`${prefix}-gateway`}
                                        type="url"
                                        name="gateway"
                                        required
                                      />
                                    </div>
                                    <div className="plugin-field">
                                      <div className="plugin-field-head">
                                        <label htmlFor={`${prefix}-pid`}>
                                          商户号
                                        </label>
                                        <span
                                          className="plugin-field-tag"
                                          data-tone="required"
                                        >
                                          必填
                                        </span>
                                      </div>
                                      <input
                                        id={`${prefix}-pid`}
                                        name="pid"
                                        required
                                      />
                                    </div>
                                    <div className="plugin-field">
                                      <div className="plugin-field-head">
                                        <label htmlFor={`${prefix}-key`}>
                                          商户密钥
                                        </label>
                                        <span
                                          className="plugin-field-tag"
                                          data-tone="required"
                                        >
                                          必填
                                        </span>
                                      </div>
                                      <input
                                        id={`${prefix}-key`}
                                        type="password"
                                        name="key"
                                        autoComplete="new-password"
                                        required
                                      />
                                    </div>
                                    <div className="plugin-field">
                                      <div className="plugin-field-head">
                                        <label htmlFor={`${prefix}-cid`}>
                                          通道号（可选）
                                        </label>
                                        <span
                                          className="plugin-field-tag"
                                          data-tone="optional"
                                        >
                                          可选
                                        </span>
                                      </div>
                                      <input id={`${prefix}-cid`} name="cid" />
                                    </div>
                                    <div className="plugin-form-actions">
                                      <button
                                        type="submit"
                                        className="console-primary"
                                        disabled={busy}
                                      >
                                        保存商户配置
                                      </button>
                                    </div>
                                  </form>
                                </div>
                              </details>
                            </section>
                          );
                        })}
                      {p.mode !== "extension" && <>
                      <section className="plugin-drawer-section">
                        <div className="plugin-drawer-section-head">
                          <div className="plugin-section-title">
                            <h4>
                              {p.mode === "pull" ? "运行方式" : "服务连接"}
                            </h4>
                            {p.mode !== "pull" && services !== undefined && (
                              <span className="plugin-count-pill">
                                {pluginServices.length} 个服务
                              </span>
                            )}
                          </div>
                          {p.mode !== "pull" &&
                            services !== undefined &&
                            pluginServices.length > 0 &&
                            editing !== "add" && (
                              <button
                                type="button"
                                className="plugin-btn-sm"
                                onClick={() => setEditing("add")}
                              >
                                <Plus size={14} />
                                添加服务
                              </button>
                            )}
                        </div>
                        {p.mode === "pull" ? (
                          <div className="plugin-drawer-card plugin-node-note">
                            <p className="plugin-section-desc">
                              此插件采用节点拉取模式，由已配对的 GPU
                              节点主动领单并回传结果，无需配置外部接口地址或密钥。
                            </p>
                            {gpuTab && (
                              <button
                                type="button"
                                className="plugin-btn-sm"
                                onClick={() => {
                                  closeDrawer();
                                  navigate(gpuTab);
                                }}
                              >
                                前往 GPU 节点
                                <ArrowUpRight size={14} />
                              </button>
                            )}
                          </div>
                        ) : (
                          <>
                            <p className="plugin-section-desc">
                              点击「测试连接」检查当前配置能否访问服务。
                            </p>
                            {servicesError && (
                              <div
                                className="plugin-alert plugin-feedback is-error"
                                role="alert"
                              >
                                <span>服务清单读取失败：{servicesError}</span>
                                <button
                                  type="button"
                                  disabled={loadingServices}
                                  onClick={() => void loadServices()}
                                >
                                  {loadingServices ? "重试中…" : "重试"}
                                </button>
                              </div>
                            )}
                            {loadingServices &&
                            services === undefined &&
                            !servicesError ? (
                              <p
                                className="plugin-section-desc"
                                role="status"
                              >
                                正在读取服务…
                              </p>
                            ) : services !== undefined ? (
                              <div className="plugin-service-list">
                                {pluginServices.map((s) => {
                                  const savedRows = describeSavedService(p, s);
                                  const report = reports[s.id];
                                  const probeError = reportErrors[s.id];
                                  const isTesting = testingService === s.id;
                                  const statusLabel = isTesting
                                    ? "测试中…"
                                    : report?.ready
                                      ? report.models
                                        ? "连接正常"
                                        : "服务可达"
                                      : probeError
                                        ? "连接失败"
                                        : "未测试";
                                  const statusTone = isTesting
                                    ? "neutral"
                                    : report?.ready
                                      ? "ok"
                                      : probeError
                                        ? "error"
                                        : "neutral";
                                  return (
                                    <div
                                      className="plugin-drawer-card plugin-service-card"
                                      key={s.id}
                                    >
                                      {s.addressPause && (
                                        <p
                                          className="plugin-alert plugin-feedback is-error"
                                          role="status"
                                        >
                                          {s.addressPause === "unresolved"
                                            ? "无法确认服务地址解析到公网。"
                                            : "当前服务地址不符合公网 HTTPS 要求。"}
                                          此连接已暂停接收新任务。请编辑服务地址并保存。
                                        </p>
                                      )}
                                      <div className="plugin-service-head">
                                        <div className="plugin-service-name">
                                          <strong>{s.name}</strong>
                                          {!s.enabled && (
                                            <span
                                              className="plugin-pill"
                                              data-tone="warn"
                                            >
                                              已停用
                                            </span>
                                          )}
                                        </div>
                                        <span
                                          className="plugin-pill"
                                          data-tone={statusTone}
                                        >
                                          {statusLabel}
                                        </span>
                                      </div>

                                      {savedRows.length > 0 && (
                                        <dl className="plugin-service-meta">
                                          {savedRows.map((row) => (
                                            <div key={row.key}>
                                              <dt>{row.label}</dt>
                                              <dd data-tone={row.tone}>
                                                {row.mono ? (
                                                  <code>{row.value}</code>
                                                ) : (
                                                  row.value
                                                )}
                                              </dd>
                                            </div>
                                          ))}
                                        </dl>
                                      )}

                                      <div className="plugin-service-actions">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void run(
                                              async () => {
                                                clearReport(s.id);
                                                setTestingService(s.id);
                                                try {
                                                  const health =
                                                    await call<ServiceReport>(
                                                      "connections/" +
                                                        s.id +
                                                        "/health",
                                                      {},
                                                    );
                                                  if (!health.ready) {
                                                    if (active.current)
                                                      setReportErrors(
                                                        (old) => ({
                                                          ...old,
                                                          [s.id]:
                                                            "连接检查未通过，请核对服务地址、网络连通性与密钥配置",
                                                        }),
                                                      );
                                                    return;
                                                  }
                                                  if (active.current)
                                                    setReports((old) => ({
                                                      ...old,
                                                      [s.id]: health,
                                                    }));
                                                } catch (err) {
                                                  if (active.current)
                                                    setReportErrors((old) => ({
                                                      ...old,
                                                      [s.id]:
                                                        (err as Error)
                                                          .message ||
                                                        "连接测试失败，请稍后重试",
                                                    }));
                                                } finally {
                                                  if (active.current)
                                                    setTestingService("");
                                                }
                                              },
                                              "",
                                              false,
                                            )
                                          }
                                        >
                                          {isTesting ? "测试中…" : "测试连接"}
                                        </button>
                                        <button
                                          type="button"
                                          aria-expanded={editing === s.id}
                                          onClick={() =>
                                            setEditing(
                                              editing === s.id ? "" : s.id,
                                            )
                                          }
                                        >
                                          修改设置
                                        </button>
                                      </div>

                                      {report?.ready && (
                                        <p
                                          className="plugin-feedback is-ok"
                                          role="status"
                                        >
                                          {report.models
                                            ? `连接成功，服务报告 ${report.models.length} 个模型${
                                                report.available
                                                  ? `（已匹配本插件 ${report.available.length} / ${p.choices.length} 个）`
                                                  : ""
                                              }`
                                            : "服务可达，密钥权限请以服务端为准"}
                                        </p>
                                      )}
                                      {probeError && (
                                        <p
                                          className="plugin-feedback is-error"
                                          role="alert"
                                        >
                                          {probeError}
                                        </p>
                                      )}

                                      {editing === s.id && (
                                        <div className="plugin-service-editor">
                                          <p className="plugin-editor-title">
                                            修改服务配置
                                          </p>
                                          <ServiceForm
                                            plugin={p}
                                            service={s}
                                            onCancel={() => setEditing("")}
                                            save={(body) =>
                                              run(async () => {
                                                await call(
                                                  "connections/" + s.id,
                                                  body,
                                                  "PUT",
                                                );
                                                clearReport(s.id);
                                                setEditing("");
                                              }, "服务设置已保存；请重新测试连接以验证最新配置")
                                            }
                                          />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {pluginServices.length === 0 && (
                                  <div className="plugin-drawer-card plugin-service-create">
                                    <p className="plugin-editor-title">
                                      配置首个服务
                                    </p>
                                    <p className="plugin-section-desc">
                                      先填写并保存服务连接，保存后即可测试连通性并开启插件。
                                    </p>
                                    <ServiceForm
                                      plugin={p}
                                      save={(body) =>
                                        run(async () => {
                                          await call("connections", body);
                                          setEditing("");
                                        }, "服务设置已保存；可点击「测试连接」验证连通性")
                                      }
                                    />
                                  </div>
                                )}

                                {pluginServices.length > 0 &&
                                  editing === "add" && (
                                    <div className="plugin-drawer-card plugin-service-create">
                                      <p className="plugin-editor-title">
                                        添加新服务
                                      </p>
                                      <p className="plugin-section-desc">
                                        支持为同一插件配置多个服务实例；保存后可在下方模型列表中按模型指定调用服务。
                                      </p>
                                      <ServiceForm
                                        plugin={p}
                                        onCancel={() => setEditing("")}
                                        save={(body) =>
                                          run(async () => {
                                            await call("connections", body);
                                            setEditing("");
                                          }, "新服务已保存")
                                        }
                                      />
                                    </div>
                                  )}
                              </div>
                            ) : null}
                          </>
                        )}
                      </section>

                      <section className="plugin-drawer-section">
                        <div className="plugin-drawer-section-head">
                          <div className="plugin-section-title">
                            <h4>可用模型</h4>
                            <span className="plugin-count-pill">
                              {enabledModelCount} / {p.choices.length} 已开放
                            </span>
                          </div>
                        </div>
                        <p className="plugin-section-desc">
                          勾选全站可用的模型。团队权限可在「模型管理」中调整。
                        </p>
                        {!p.enabled && p.choices.length > 0 && (
                          <p className="plugin-inline-note">
                            当前插件总开关已关闭，以下勾选将在开启插件后对用户生效。
                          </p>
                        )}
                        {duplicateIds.size > 0 && (
                          <p className="plugin-inline-note is-warn">
                            同名模型可按类型和 ID 区分，也可以为它们修改显示名。
                          </p>
                        )}
                        {p.choices.length === 0 ? (
                          <div className="plugin-drawer-card">
                            <p className="plugin-section-desc">
                              此插件未声明可见的生成模型。
                            </p>
                          </div>
                        ) : (
                          <div className="plugin-model-list">
                            {p.choices.map((m) => {
                              const kindLabel = m.kind && modelKindLabels[m.kind];
                              const isDuplicate = duplicateIds.has(m.id);
                              const isRenaming = renamingModel === m.id;
                              const probeMatches = pluginServices.filter(
                                (s) => reports[s.id]?.available,
                              );
                              return (
                                <div
                                  className="plugin-model-item"
                                  data-enabled={m.enabled}
                                  key={m.id}
                                >
                                  <div className="plugin-model-main">
                                    <label className="plugin-model-check">
                                      <input
                                        type="checkbox"
                                        checked={m.enabled}
                                        onChange={(e) =>
                                          void action(
                                            "model",
                                            {
                                              model: m.id,
                                              enabled: e.target.checked,
                                            },
                                            e.target.checked
                                              ? `已开放模型 ${m.label}（${m.id}）`
                                              : `已关闭模型 ${m.label}（${m.id}）`,
                                          )
                                        }
                                      />
                                      <span className="plugin-model-info">
                                        <span className="plugin-model-title">
                                          <strong>{m.label}</strong>
                                          {kindLabel && (
                                            <span className="plugin-pill is-kind">
                                              {kindLabel}
                                            </span>
                                          )}
                                          {isDuplicate && (
                                            <span
                                              className="plugin-pill"
                                              data-tone="warn"
                                            >
                                              同名
                                            </span>
                                          )}
                                        </span>
                                        <code className="plugin-model-id">
                                          {m.id}
                                        </code>
                                      </span>
                                    </label>
                                    <button
                                      type="button"
                                      className="plugin-btn-sm plugin-btn-quiet"
                                      aria-expanded={isRenaming}
                                      onClick={() =>
                                        setRenamingModel(
                                          isRenaming ? "" : m.id,
                                        )
                                      }
                                    >
                                      修改显示名
                                    </button>
                                  </div>

                                  {probeMatches.length > 0 && (
                                    <div className="plugin-model-probes">
                                      {probeMatches.map((s) => {
                                        const listed =
                                          reports[s.id].available!.includes(
                                            m.id,
                                          );
                                        return (
                                          <span
                                            className="plugin-pill"
                                            data-tone={listed ? "ok" : "warn"}
                                            key={s.id}
                                          >
                                            {s.name} ·{" "}
                                            {listed
                                              ? "服务已列出"
                                              : "服务未列出"}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {isRenaming && (
                                    <form
                                      className="plugin-rename-form"
                                      onKeyDown={(e) => {
                                        if (e.key === "Escape") {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setRenamingModel("");
                                        }
                                      }}
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        const form = new FormData(
                                          e.currentTarget,
                                        );
                                        const name = String(
                                          form.get("label") ?? "",
                                        ).trim();
                                        if (!name) return;
                                        void run(async () => {
                                          await call(base + "model", {
                                            revision: p.revision,
                                            model: m.id,
                                            enabled: m.enabled,
                                            label: name,
                                          });
                                          if (active.current) setRenamingModel("");
                                        }, "模型显示名已更新");
                                      }}
                                    >
                                      <label
                                        htmlFor={`rename-${p.id}-${m.id}`}
                                      >
                                        工作台显示名称
                                      </label>
                                      <div className="plugin-rename-row">
                                        <input
                                          id={`rename-${p.id}-${m.id}`}
                                          name="label"
                                          type="text"
                                          autoFocus
                                          required
                                          maxLength={80}
                                          defaultValue={m.label}
                                          placeholder="输入易于区分的名称"
                                        />
                                        <button
                                          type="submit"
                                          className="console-primary plugin-btn-sm"
                                        >
                                          保存
                                        </button>
                                        <button
                                          type="button"
                                          className="plugin-btn-sm"
                                          onClick={() => setRenamingModel("")}
                                        >
                                          取消
                                        </button>
                                      </div>
                                      <p className="plugin-field-hint">
                                        仅影响工作台与设置页展示，底层模型 ID（
                                        <code>{m.id}</code>）保持不变。
                                      </p>
                                    </form>
                                  )}

                                  {m.services.length > 1 && (
                                    <div className="plugin-model-route">
                                      <label
                                        htmlFor={`route-${p.id}-${m.id}`}
                                      >
                                        调用服务
                                      </label>
                                      <select
                                        id={`route-${p.id}-${m.id}`}
                                        aria-label={m.label + "使用的服务"}
                                        value={m.service ?? ""}
                                        onChange={(e) =>
                                          void action(
                                            "model",
                                            {
                                              model: m.id,
                                              enabled: m.enabled,
                                              service: e.target.value,
                                            },
                                            "模型调用服务已更新",
                                          )
                                        }
                                      >
                                        <option disabled value="">
                                          选择服务
                                        </option>
                                        {m.services.map((s) => (
                                          <option key={s.id} value={s.id}>
                                            {s.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="plugin-section-links">
                          <button
                            type="button"
                            className="plugin-btn-sm"
                            onClick={() => navigate("prices")}
                          >
                            设置生成定价
                            <ArrowUpRight size={14} />
                          </button>
                          <button
                            type="button"
                            className="plugin-btn-sm"
                            onClick={() => navigate("models")}
                          >
                            团队模型权限
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </section>

                      </>}
                      <details
                        className="plugin-drawer-details"
                        open={
                          Boolean(
                            p.updateInfo?.version || p.updateInfo?.error,
                          ) || undefined
                        }
                      >
                        <summary>
                          <span className="plugin-details-title">
                            版本与更新
                          </span>
                          <span className="plugin-details-meta">
                            {p.updateInfo?.version ? (
                              <span className="plugin-pill" data-tone="ok">
                                可更新至 {p.updateInfo.version}
                              </span>
                            ) : p.updateInfo?.error ? (
                              <span className="plugin-pill" data-tone="error">
                                检查失败
                              </span>
                            ) : (
                              <code>v{p.version}</code>
                            )}
                            <ChevronDown size={15} />
                          </span>
                        </summary>
                        <div className="plugin-details-body">
                          <dl className="plugin-version-meta">
                            <div>
                              <dt>当前版本</dt>
                              <dd>
                                <code>{p.version}</code>
                              </dd>
                            </div>
                            <div>
                              <dt>适配器版本</dt>
                              <dd>
                                <code>{p.adapterVersion}</code>
                              </dd>
                            </div>
                            {p.checkedAt && (
                              <div className="plugin-version-checked">
                                <dt>最近检查</dt>
                                <dd>
                                  {new Date(p.checkedAt).toLocaleString()}
                                </dd>
                              </div>
                            )}
                          </dl>

                          {p.updateInfo?.error && (
                            <p
                              className="plugin-feedback is-error"
                              role="alert"
                            >
                              更新检查失败：{p.updateInfo.error}
                            </p>
                          )}

                          {p.updateInfo?.version && (
                            <div className="plugin-update-banner">
                              <div>
                                <strong>
                                  发现新版本 {p.updateInfo.version}
                                </strong>
                                {p.updateInfo.notes && (
                                  <p>{p.updateInfo.notes}</p>
                                )}
                              </div>
                              <button
                                type="button"
                                className="console-primary plugin-btn-sm"
                                onClick={() => {
                                  void run(
                                    async () => {
                                      const preview = await call<Preview>(
                                        base + "review",
                                        {},
                                      );
                                      setPending({
                                        sha256: p.updateInfo!.sha256,
                                        notes: p.updateInfo!.notes,
                                        preview,
                                      });
                                      closeDrawer();
                                    },
                                    "",
                                    false,
                                  );
                                }}
                              >
                                更新到 {p.updateInfo.version}
                              </button>
                            </div>
                          )}

                          <form
                            className="plugin-form"
                            key={p.revision}
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void action(
                                "source",
                                buildUpdateSourcePayload({
                                  url: String(f.get("url") || ""),
                                  token: String(f.get("token") || ""),
                                }),
                                "更新源已保存",
                              );
                            }}
                          >
                            <div className="plugin-field">
                              <div className="plugin-field-head">
                                <label htmlFor={`update-url-${p.id}`}>
                                  更新地址
                                </label>
                                <span
                                  className="plugin-field-tag"
                                  data-tone="optional"
                                >
                                  可选
                                </span>
                              </div>
                              <input
                                id={`update-url-${p.id}`}
                                type="url"
                                name="url"
                                placeholder="https://example.com/update.json"
                                defaultValue={p.updateUrl || ""}
                              />
                              <p className="plugin-field-hint">
                                填写远程更新清单地址后可在线检查更新；留空则仅支持手动导入插件包。
                              </p>
                            </div>
                            <div className="plugin-field">
                              <div className="plugin-field-head">
                                <label htmlFor={`update-token-${p.id}`}>
                                  只读令牌
                                </label>
                                <span
                                  className="plugin-field-tag"
                                  data-tone={
                                    p.hasUpdateToken ? "ok" : "optional"
                                  }
                                >
                                  {p.hasUpdateToken ? "已保存" : "可选"}
                                </span>
                              </div>
                              <input
                                id={`update-token-${p.id}`}
                                type="password"
                                name="token"
                                autoComplete="off"
                                placeholder={
                                  p.hasUpdateToken
                                    ? "已保存，留空沿用"
                                    : "私有仓库可选填写"
                                }
                              />
                              <p className="plugin-field-hint">
                                {p.hasUpdateToken
                                  ? "仅用于访问私有更新源，加密保存且不回显；留空保存将沿用当前令牌，如需移除可点击「清除已保存令牌」。"
                                  : "仅用于访问私有更新源，加密保存且不回显。"}
                              </p>
                            </div>
                            <div className="plugin-form-actions">
                              <button type="submit">保存更新设置</button>
                              {p.hasUpdateToken && (
                                <button
                                  type="button"
                                  className="plugin-btn-danger"
                                  onClick={() => {
                                    void action(
                                      "source",
                                      buildUpdateSourcePayload({
                                        savedUrl: p.updateUrl,
                                        clearToken: true,
                                      }),
                                      "已清除已保存的只读令牌",
                                    );
                                  }}
                                >
                                  清除已保存令牌
                                </button>
                              )}
                              {p.updateUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void run(
                                      () => call(base + "check", {}),
                                      "已完成更新检查",
                                    )
                                  }
                                >
                                  立即检查更新
                                </button>
                              )}
                            </div>
                          </form>

                          {p.publisher && <PublisherInfo publisher={p.publisher} />}
                          {p.previousVersion && p.publisher?.fingerprint && !p.rollbackPublisher?.fingerprint && <p>此插件已固定发布者公钥，上一个版本未签名。</p>}
                          {p.previousVersion && (!p.publisher?.fingerprint || p.rollbackPublisher?.fingerprint) && (
                            <div className="plugin-rollback-box">
                              <p className="plugin-section-desc">
                                可回退到上一已安装版本{" "}
                                <code>{p.previousVersion}</code>
                                ；回退将恢复上一版插件包与对应配置快照，不影响已受理任务。
                              </p>
                              {confirmAction === "rollback" ? (
                                <div className="plugin-confirm-inline">
                                  {p.rollbackPublisher?.change && <PublisherInfo publisher={p.rollbackPublisher} />}
                                  <span>
                                    确认回退到 {p.previousVersion}？
                                  </span>
                                  <div className="plugin-form-actions">
                                    <button
                                      type="button"
                                      className="console-primary plugin-btn-sm"
                                      onClick={() => {
                                        setConfirmAction("");
                                        void action(
                                          "rollback",
                                          { confirmPublisher: p.rollbackPublisher?.change ?? undefined },
                                          "已回到上一版",
                                        );
                                      }}
                                    >
                                      {p.rollbackPublisher?.change ? "确认换钥并回退" : "确认回退"}
                                    </button>
                                    <button
                                      type="button"
                                      className="plugin-btn-sm"
                                      onClick={() => setConfirmAction("")}
                                    >
                                      取消
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="plugin-btn-sm"
                                  onClick={() => setConfirmAction("rollback")}
                                >
                                  回到 {p.previousVersion}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </details>

                      <section className="plugin-danger-zone">
                        <h4>移除插件</h4>
                        <p className="plugin-section-desc">
                          {p.removing
                            ? "已提交移除请求，当前仍有未完成任务；任务结束后将自动清除服务地址与密钥并完成卸载。"
                            : `移除「${p.label}」将清除已保存的服务地址与密钥，并立即停止受理新任务；历史作品与账单记录会保留。`}
                        </p>
                        {confirmAction === "remove" && !p.removing ? (
                          <div className="plugin-confirm-inline is-danger">
                            <span>
                              确认移除「{p.label}」并清除其服务地址及密钥？
                            </span>
                            <div className="plugin-form-actions">
                              <button
                                type="button"
                                className="plugin-btn-danger-solid plugin-btn-sm"
                                onClick={() => {
                                  setConfirmAction("");
                                  void action(
                                    "state",
                                    { action: "remove" },
                                    "已提交移除请求",
                                  );
                                }}
                              >
                                确认移除
                              </button>
                              <button
                                type="button"
                                className="plugin-btn-sm"
                                onClick={() => setConfirmAction("")}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="plugin-btn-danger"
                            disabled={p.removing}
                            onClick={() => setConfirmAction("remove")}
                          >
                            {p.removing ? "等待任务结束后移除…" : "移除插件"}
                          </button>
                        )}
                      </section>
                    </PluginDrawer>
                  );
                })()}
              </article>
            );
          })}
        </div>
        {loadingPlugins && !plugins && !pluginsError && <p>正在读取插件…</p>}
      </fieldset>
    </section>
  );
}
