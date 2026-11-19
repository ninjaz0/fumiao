import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import "./settings-plugins.css";

type Field = {
  title?: string;
  type?: string | string[];
  enum?: unknown[];
  writeOnly?: boolean;
};
type ConfigSchema = { properties?: Record<string, Field>; required?: string[] };
type Plugin = {
  id: string;
  version: string;
  label: string;
  configSchema: ConfigSchema;
  models: string[];
  singleton: boolean;
  installed: boolean;
  active: boolean;
};
type Connection = {
  id: string;
  name: string;
  plugin_id: string;
  plugin_version: string;
  revision: number;
  concurrency: number;
  enabled: boolean;
};
type Run = (action: () => Promise<void>, message?: string) => Promise<void>;
const labelFor = (key: string, field: Field) =>
  field.title ||
  (
    {
      baseUrl: "服务地址",
      apiKey: "API 密钥",
      artifactOrigins: "媒体来源地址",
    } as Record<string, string>
  )[key] ||
  key;
const kindOf = (field: Field) => (field.enum ? "enum" : field.type);
function readConfig(
  form: FormData,
  schema: ConfigSchema,
): Record<string, unknown> {
  if (form.has("config-json")) {
    const value: unknown = JSON.parse(String(form.get("config-json")) || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw Error("连接配置必须是 JSON 对象");
    return value as Record<string, unknown>;
  }
  return Object.fromEntries(
    Object.entries(schema.properties || {}).flatMap(([key, field]) => {
      const raw = String(form.get("config:" + key) ?? "");
      if (!raw) return [];
      const type = kindOf(field);
      if (type === "string") return [[key, raw]];
      try {
        return [[key, JSON.parse(raw)]];
      } catch {
        throw Error(labelFor(key, field) + " 的格式无效");
      }
    }),
  );
}

function ConfigFields({ schema }: { schema: ConfigSchema }) {
  const [json, setJson] = useState(false);
  const fields = Object.entries(schema.properties || {});
  return (
    <>
      {fields.length > 0 && (
        <label className="plugin-inline">
          <input
            type="checkbox"
            checked={json}
            onChange={(e) => setJson(e.target.checked)}
          />
          使用 JSON 配置
        </label>
      )}
      {json || !fields.length ? (
        <label>
          连接配置 JSON
          <textarea
            name="config-json"
            rows={3}
            defaultValue="{}"
            autoComplete="off"
          />
        </label>
      ) : (
        fields.map(([key, field]) => {
          const name = "config:" + key,
            required = schema.required?.includes(key),
            type = kindOf(field);
          return (
            <label key={key}>
              {labelFor(key, field)}
              {field.enum || type === "boolean" ? (
                <select name={name} required={required} defaultValue="">
                  <option value="">请选择</option>
                  {(field.enum || [true, false]).map((v) => (
                    <option key={JSON.stringify(v)} value={JSON.stringify(v)}>
                      {typeof v === "string" ? v : JSON.stringify(v)}
                    </option>
                  ))}
                </select>
              ) : type === "string" ||
                type === "number" ||
                type === "integer" ? (
                <input
                  name={name}
                  required={required}
                  autoComplete="off"
                  type={
                    field.writeOnly || /key|password|token|secret/i.test(key)
                      ? "password"
                      : type === "string"
                        ? "text"
                        : "number"
                  }
                  step={type === "number" ? "any" : undefined}
                />
              ) : (
                <textarea
                  name={name}
                  required={required}
                  rows={2}
                  placeholder={type === "array" ? '["…"]' : "JSON"}
                />
              )}
            </label>
          );
        })
      )}
    </>
  );
}

function ConnectionForm({
  plugin,
  connection,
  save,
}: {
  plugin: Plugin;
  connection?: Connection;
  save: (payload: object) => Promise<void>;
}) {
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError("");
    let config: Record<string, unknown> | undefined;
    try {
      if (!connection || replace)
        config = readConfig(form, plugin.configSchema);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    await save({
      ...(connection
        ? { revision: connection.revision, enabled: form.has("enabled") }
        : {
            name: form.get("name"),
            pluginId: plugin.id,
            version: plugin.version,
          }),
      concurrency: Number(form.get("concurrency")),
      config,
    });
  }
  return (
    <form className="plugin-form" onSubmit={submit}>
      {!connection && (
        <label>
          连接名称
          <input
            required
            name="name"
            maxLength={80}
            defaultValue={plugin.label}
          />
        </label>
      )}
      <label>
        最大并发
        <input
          type="number"
          name="concurrency"
          min={1}
          max={100}
          defaultValue={connection?.concurrency ?? 1}
          required
        />
      </label>
      {connection && (
        <>
          <label className="plugin-inline">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={connection.enabled}
            />
            启用连接
          </label>
          <label className="plugin-inline">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            替换连接配置及凭据
          </label>
        </>
      )}
      {(!connection || replace) && (
        <ConfigFields schema={plugin.configSchema} />
      )}
      {error && <p role="alert">{error}</p>}
      <button>{connection ? "保存连接" : "创建连接"}</button>
    </form>
  );
}

function VersionChange({
  plugin,
  connections,
  apply,
}: {
  plugin: Plugin;
  connections: Connection[];
  apply: (path: string, body: object) => Promise<void>;
}) {
  const [error, setError] = useState("");
  if (!connections.length)
    return (
      <button
        onClick={() =>
          void apply("plugins/activate", {
            id: plugin.id,
            version: plugin.version,
          })
        }
      >
        启用此版本目录
      </button>
    );
  return (
    <form
      className="plugin-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const c = connections.find((c) => c.id === form.get("source"))!;
        setError("");
        try {
          const config = readConfig(form, plugin.configSchema);
          void apply("connections/" + c.id + "/upgrade", {
            revision: c.revision,
            version: plugin.version,
            activateCatalog: true,
            config,
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label>
        要切换版本的连接
        <select name="source">
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.plugin_version}
            </option>
          ))}
        </select>
      </label>
      <ConfigFields schema={plugin.configSchema} />
      <p>
        切换后将使用此版本的模型目录。连接需重新启用，已受理任务按原版本完成。
      </p>
      {error && <p role="alert">{error}</p>}
      <button>切换连接及目录版本</button>
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
  const [data, setData] = useState<{
    plugins: Plugin[];
    connections: Connection[];
  }>();
  const [selected, select] = useState("");
  const [edit, setEdit] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const locked = useRef(false);
  const call = <T,>(path: string, body?: object, method?: string) =>
    api<T>(String(workspace), "/api/admin/" + path, body, method);
  async function load() {
    const [plugins, connections] = await Promise.all([
      call<Plugin[]>("plugins"),
      call<Connection[]>("connections"),
    ]);
    if (active.current) setData({ plugins, connections });
  }
  useEffect(() => {
    active.current = true;
    void load().catch((err) => {
      if (active.current) setError(err.message);
    });
    return () => {
      active.current = false;
    };
  }, [workspace]);
  const run: Run = async (action, success) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
      if (active.current && success) setMessage(success);
    } catch (err) {
      if (active.current) setError((err as Error).message);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const keyOf = (p: Pick<Plugin, "id" | "version">) => p.id + "@" + p.version;
  const plugin =
    data?.plugins.find((p) => keyOf(p) === selected) ?? data?.plugins[0];
  const connections =
    data?.connections.filter(
      (c) => c.plugin_id === plugin?.id && c.plugin_version === plugin.version,
    ) || [];
  async function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await run(async () => {
      let manifest;
      try {
        manifest = JSON.parse(String(values.get("manifest")));
      } catch {
        throw Error("插件清单必须是有效的 JSON");
      }
      if (manifest?.originalSubmission?.version !== 2)
        throw Error(
          "请选择声明 originalSubmission.version 为 2 的工作台插件清单",
        );
      const result = await call<{ id: string; version: string }>("plugins", {
        manifest,
        endpoint: values.get("endpoint"),
      });
      await load();
      await refresh();
      select(keyOf(result));
      setEdit("");
      form.reset();
    }, "插件已安装");
  }
  return (
    <section className="settings-section studio-plugins">
      <h2>插件</h2>
      <fieldset disabled={busy}>
        <details>
          <summary>安装远程插件</summary>
          <form className="plugin-form" onSubmit={install}>
            <label>
              插件服务地址
              <input
                name="endpoint"
                type="url"
                required
                placeholder="https://provider.example"
              />
            </label>
            <label>
              插件清单 JSON
              <textarea name="manifest" rows={5} required spellCheck={false} />
            </label>
            <button>安装插件</button>
          </form>
        </details>
        {data && plugin && (
          <>
            <label>
              模型提供方
              <select
                value={keyOf(plugin)}
                onChange={(e) => {
                  select(e.target.value);
                  setEdit("");
                  setError("");
                  setMessage("");
                }}
              >
                {data.plugins.map((p) => (
                  <option key={keyOf(p)} value={keyOf(p)}>
                    {p.label} · {p.version}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {!plugin.installed
                ? "待安装"
                : plugin.active
                  ? "已安装"
                  : "已注册 · 待切换版本"}
            </p>
            <details key={keyOf(plugin)}>
              <summary>模型目录（{plugin.models.length}）</summary>
              <ul>
                {plugin.models.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </details>
            {!plugin.installed ? (
              <button
                onClick={() =>
                  void run(async () => {
                    await call("plugins/builtin", {
                      id: plugin.id,
                      version: plugin.version,
                    });
                    await load();
                    await refresh();
                  }, "插件已安装")
                }
              >
                安装此插件
              </button>
            ) : !plugin.active ? (
              <VersionChange
                key={keyOf(plugin)}
                plugin={plugin}
                connections={data.connections.filter(
                  (c) => c.plugin_id === plugin.id,
                )}
                apply={(path, body) =>
                  run(async () => {
                    await call(path, body);
                    await load();
                    await refresh();
                    setEdit("");
                  }, "目录版本已切换")
                }
              />
            ) : (
              <>
                <div className="plugin-actions">
                  <button onClick={() => navigate("models")}>
                    管理模型权限
                  </button>
                  <button onClick={() => navigate("prices")}>
                    设置生成定价
                  </button>
                </div>
                <h3>提供方连接</h3>
                {connections.map((c) => (
                  <div className="plugin-connection" key={c.id}>
                    <div>
                      {c.name} · {c.enabled ? "已启用" : "已停用"}
                    </div>
                    <div className="plugin-actions">
                      <button
                        onClick={() => setEdit(edit === c.id ? "" : c.id)}
                      >
                        编辑连接
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            const res = await call<{ ready: boolean }>(
                              "connections/" + c.id + "/health",
                              {},
                            );
                            if (!res.ready)
                              throw Error(
                                "连接尚未就绪，请检查服务地址、凭据或节点状态",
                              );
                          }, "连接可用")
                        }
                      >
                        测试连接
                      </button>
                    </div>
                    {edit === c.id && (
                      <ConnectionForm
                        key={c.revision}
                        plugin={plugin}
                        connection={c}
                        save={(body) =>
                          run(async () => {
                            await call("connections/" + c.id, body, "PUT");
                            await load();
                            await refresh();
                            setEdit("");
                          }, "连接已保存")
                        }
                      />
                    )}
                  </div>
                ))}
                {(!plugin.singleton || !connections.length) &&
                  (edit === "new" ? (
                    <ConnectionForm
                      key={keyOf(plugin)}
                      plugin={plugin}
                      save={(body) =>
                        run(async () => {
                          const result = await call<{ id: string }>(
                            "connections",
                            body,
                          );
                          await load();
                          setEdit(result.id);
                        }, "已创建连接，请确认配置并启用")
                      }
                    />
                  ) : (
                    <button onClick={() => setEdit("new")}>添加连接</button>
                  ))}
              </>
            )}
          </>
        )}
        {!data && !error && <p>正在读取插件…</p>}
      </fieldset>
      {error && (
        <div role="alert">
          {error}{" "}
          <button
            onClick={() =>
              void run(async () => {
                await load();
                setEdit("");
              })
            }
          >
            重新读取
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
