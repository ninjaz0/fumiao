import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import "./settings-plugins.css";

type Field = {
  title?: string;
  type?: string;
  enum?: unknown[];
  writeOnly?: boolean;
};
type Service = {
  values: Record<string, unknown>;
  configuredFields: string[];
  id: string;
  name: string;
  plugin_id: string;
  plugin_version: string;
  revision: number;
  enabled: boolean;
  concurrency: number;
};
type Plugin = {
  id: string;
  label: string;
  version: string;
  adapterVersion: string;
  removing: boolean;
  enabled: boolean;
  revision: number;
  mode: string;
  configSchema: { properties?: Record<string, Field>; required?: string[] };
  choices: {
    id: string;
    label: string;
    enabled: boolean;
    service: string | null;
    services: { id: string; name: string }[];
  }[];
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
const labels: Record<string, string> = {
  publicUrl: "服务公开地址",
  baseUrl: "服务地址",
  provider: "提供方",
  apiKey: "API 密钥",
  artifactOrigins: "允许下载媒体的其他地址",
};
const label = (key: string, field: Field = {}) =>
  field.title || labels[key] || key;

function ServiceForm({
  plugin,
  service,
  save,
}: {
  plugin: Plugin;
  service?: Service;
  save: (body: object) => Promise<void>;
}) {
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const config: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(
        plugin.configSchema.properties || {},
      )) {
        const raw = String(form.get(key) ?? "").trim();
        if (raw)
          config[key] =
            !field.type || field.type === "string" ? raw : JSON.parse(raw);
      }
      await save(
        service
          ? {
              revision: service.revision,
              enabled: service.enabled,
              preserveCredentials: true,
              concurrency: service.concurrency,
              config,
            }
          : {
              name: form.get("name"),
              pluginId: plugin.id,
              version: plugin.adapterVersion,
              config,
            },
      );
    } catch {
      setError("请检查服务设置的格式");
    }
  }
  return (
    <form className="plugin-form" onSubmit={submit}>
      {!service && (
        <label>
          服务名称
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={plugin.label}
          />
        </label>
      )}
      {Object.entries(plugin.configSchema.properties || {}).map(([key, f]) => {
        const required =
          plugin.configSchema.required?.includes(key) &&
          !service?.configuredFields.includes(key);
        const field = (
          <label>
            {label(key, f)}
            {f.type === "string" && f.enum && !f.writeOnly ? (
              <select
                aria-label={label(key, f)}
                name={key}
                required={required}
                defaultValue={String(service?.values[key] ?? "")}
              >
                <option value="">
                  {service?.configuredFields.includes(key)
                    ? "沿用当前选项"
                    : "请选择"}
                </option>
                {f.enum.map((value) => (
                  <option key={String(value)} value={String(value)}>
                    {String(value)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name={key}
                type={
                  f.writeOnly ? "password" : key === "baseUrl" ? "url" : "text"
                }
                autoComplete="off"
                defaultValue={
                  service?.values[key] === undefined
                    ? ""
                    : typeof service.values[key] === "string"
                      ? String(service.values[key])
                      : JSON.stringify(service.values[key])
                }
                placeholder={
                  service?.configuredFields.includes(key) &&
                  service.values[key] === undefined
                    ? "已保存，留空沿用"
                    : undefined
                }
                required={required}
              />
            )}
          </label>
        );
        return !plugin.configSchema.required?.includes(key) ? (
          <details key={key}>
            <summary>更多设置</summary>
            {field}
          </details>
        ) : (
          <div key={key}>{field}</div>
        );
      })}
      {error && <p role="alert">{error}</p>}
      <button>保存服务设置</button>
    </form>
  );
}
export function PluginSettings({
  workspace,
  refresh,
  navigate,
}: {
  workspace: number;
  refresh: () => Promise<void>;
  navigate: (tab: "models" | "prices") => void;
}) {
  const [plugins, setPlugins] = useState<Plugin[]>();
  const [services, setServices] = useState<Service[]>();
  const [pluginsError, setPluginsError] = useState("");
  const [servicesError, setServicesError] = useState("");
  const [loadingPlugins, setLoadingPlugins] = useState(true);
  const [loadingServices, setLoadingServices] = useState(true);
  const [reports, setReports] = useState<
    Record<string, { ready: boolean; models?: string[]; available?: string[] }>
  >({});
  const [opened, setOpened] = useState(""),
    [editing, setEditing] = useState("");
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
    picker = useRef<HTMLInputElement>(null);
  const call = <T,>(path: string, body?: object, method?: string) =>
    api<T>(String(workspace), "/api/admin/" + path, body, method);
  function clearReport(id: string) {
    setReports((old) => {
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
  return (
    <section className="settings-section studio-plugins">
      <h2>插件</h2>
      <fieldset disabled={busy}>
        <div className="plugin-actions">
          <button onClick={() => picker.current?.click()}>导入插件</button>
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
                    let content;
                    try {
                      content = JSON.parse(await file.text());
                    } catch {
                      throw Error("无法读取插件文件");
                    }
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
                  if (pending.sha256)
                    await call("plugins/" + pending.preview.id + "/update", {
                      revision: existing?.revision,
                      sha256: pending.sha256,
                      supplements,
                    });
                  else
                    await call("plugins/import", {
                      file: pending.file,
                      revision: existing?.revision,
                      supplements,
                    });
                  setOpened(pending.preview.id);
                  setPending(undefined);
                },
                existing ? "插件已更新" : "插件已导入",
              );
            }}
          >
            <h3>
              {pending.preview.label} · {pending.preview.version}
            </h3>
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
        {servicesError && plugins !== undefined && !showingInlineServiceError && (
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
        {plugins && !plugins.length && !pending && <p>暂无已安装的插件</p>}
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
            return (
              <article
                className="ledger-card plugin-connection"
                data-expanded={opened === p.id}
                key={p.id}
              >
                <div className="plugin-actions">
                  <strong>{p.label}</strong>
                  <span>{p.version}</span>
                  <label className="plugin-inline">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={p.label + "开关"}
                      checked={p.enabled}
                      disabled={p.removing}
                      onChange={(e) =>
                        void action("state", {
                          action: e.target.checked ? "enable" : "disable",
                        })
                      }
                    />
                    {p.removing
                      ? "等待已受理任务结束后移除"
                      : p.enabled
                        ? "已开启"
                        : "已关闭"}
                  </label>
                  <button
                    aria-expanded={opened === p.id}
                    onClick={() => {
                      setOpened(opened === p.id ? "" : p.id);
                      setEditing("");
                    }}
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
                {opened === p.id && (
                  <>
                    {p.mode !== "pull" && (
                      <>
                        <h3>服务设置</h3>
                        {servicesError && (
                          <div className="plugin-alert" role="alert">
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
                        {loadingServices && services === undefined && !servicesError ? (
                          <p role="status">正在读取服务…</p>
                        ) : services !== undefined ? (
                          <>
                            {pluginServices.map((s) => (
                              <div key={s.id}>
                                <div className="plugin-actions">
                                  <span>{s.name}</span>
                                  <button
                                    onClick={() =>
                                      setEditing(editing === s.id ? "" : s.id)
                                    }
                                  >
                                    修改设置
                                  </button>
                                  <button
                                    onClick={() =>
                                      void run(
                                        async () => {
                                          clearReport(s.id);
                                          const health = await call<{
                                            ready: boolean;
                                            models?: string[];
                                            available?: string[];
                                          }>(
                                            "connections/" + s.id + "/health",
                                            {},
                                          );
                                          if (!health.ready)
                                            throw Error(
                                              "连接检查未通过，请核对地址和密钥",
                                            );
                                          if (active.current)
                                            setReports((old) => ({
                                              ...old,
                                              [s.id]: health,
                                            }));
                                        },
                                        "",
                                        false,
                                      )
                                    }
                                  >
                                    测试连接
                                  </button>
                                </div>
                                {reports[s.id]?.ready && (
                                  <p role="status">
                                    {reports[s.id].models
                                      ? "连接成功，服务报告 " +
                                        reports[s.id].models!.length +
                                        " 个模型"
                                      : "服务可达，密钥权限请以服务端为准"}
                                  </p>
                                )}
                                {editing === s.id && (
                                  <ServiceForm
                                    plugin={p}
                                    service={s}
                                    save={(body) =>
                                      run(async () => {
                                        await call(
                                          "connections/" + s.id,
                                          body,
                                          "PUT",
                                        );
                                        clearReport(s.id);
                                        setEditing("");
                                      }, "服务设置已保存")
                                    }
                                  />
                                )}
                              </div>
                            ))}
                            {pluginServices.length === 0 || editing === "add" ? (
                              <ServiceForm
                                plugin={p}
                                save={(body) =>
                                  run(async () => {
                                    await call("connections", body);
                                    setEditing("");
                                  }, "服务设置已保存")
                                }
                              />
                            ) : (
                              <button onClick={() => setEditing("add")}>
                                添加服务
                              </button>
                            )}
                          </>
                        ) : null}
                      </>
                    )}
                    <details>
                      <summary>模型（{p.choices.length}）</summary>
                      {p.choices.map((m) => (
                        <div className="plugin-actions" key={m.id}>
                          <label className="plugin-inline">
                            <input
                              type="checkbox"
                              checked={m.enabled}
                              onChange={(e) =>
                                void action("model", {
                                  model: m.id,
                                  enabled: e.target.checked,
                                })
                              }
                            />
                            {m.label}
                          </label>
                          {pluginServices
                            .filter((s) => reports[s.id]?.available)
                            .map((s) => (
                              <small key={s.id}>
                                {s.name} ·{" "}
                                {reports[s.id].available!.includes(m.id)
                                  ? "服务已列出"
                                  : "服务未列出"}
                              </small>
                            ))}
                          {p.choices.some(
                            (other) =>
                              other.id !== m.id && other.label === m.label,
                          ) ||
                          plugins.some(
                            (other) =>
                              other.id !== p.id &&
                              other.choices.some(
                                (c) => c.id !== m.id && c.label === m.label,
                              ),
                          ) ? (
                            <button
                              onClick={() => {
                                const name = window
                                  .prompt("模型显示名称", m.label)
                                  ?.trim();
                                if (name)
                                  void action("model", {
                                    model: m.id,
                                    enabled: m.enabled,
                                    label: name,
                                  });
                              }}
                            >
                              修改显示名
                            </button>
                          ) : null}
                          {m.services.length > 1 && (
                            <select
                              aria-label={m.label + "使用的服务"}
                              value={m.service ?? ""}
                              onChange={(e) =>
                                void action("model", {
                                  model: m.id,
                                  enabled: m.enabled,
                                  service: e.target.value,
                                })
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
                          )}
                        </div>
                      ))}
                      <button onClick={() => navigate("prices")}>
                        设置生成定价
                      </button>
                    </details>
                    <details>
                      <summary>更新设置</summary>
                      <form
                        className="plugin-form"
                        key={p.revision}
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget),
                            token = String(f.get("token") || "");
                          void action(
                            "source",
                            {
                              url: f.get("url") || null,
                              ...(token ? { token } : {}),
                            },
                            "更新源已保存",
                          );
                        }}
                      >
                        <label>
                          更新地址
                          <input
                            type="url"
                            name="url"
                            defaultValue={p.updateUrl || ""}
                          />
                        </label>
                        <label>
                          只读令牌
                          <input
                            type="password"
                            name="token"
                            autoComplete="off"
                            placeholder={
                              p.hasUpdateToken ? "已保存" : undefined
                            }
                          />
                        </label>
                        <button>保存更新设置</button>
                      </form>
                      {p.checkedAt && (
                        <p>
                          {p.updateInfo?.error || "最近检查"} ·{" "}
                          {new Date(p.checkedAt).toLocaleString()}
                        </p>
                      )}
                      {p.previousVersion && (
                        <button
                          onClick={() => {
                            if (
                              window.confirm("回到 " + p.previousVersion + "？")
                            )
                              void action("rollback", {}, "已回到上一版");
                          }}
                        >
                          回到 {p.previousVersion}
                        </button>
                      )}
                    </details>
                    <button
                      disabled={p.removing}
                      onClick={() => {
                        if (
                          window.confirm(
                            "移除 " +
                              p.label +
                              " 并清除服务地址及密钥？历史作品和账单将保留。",
                          )
                        )
                          void action(
                            "state",
                            { action: "remove" },
                            "已提交移除请求",
                          );
                      }}
                    >
                      移除插件
                    </button>
                  </>
                )}
              </article>
            );
          })}
        </div>
        {loadingPlugins && !plugins && !pluginsError && <p>正在读取插件…</p>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
