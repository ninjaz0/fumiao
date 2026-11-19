"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Chat, Packs, Recharge, AdminTools } from "../app/workspace-tools";
const Canvas = dynamic(() => import("../app/workspace-canvas"), { ssr: false });
type Row = Record<string, any>;
const status: Record<string, string> = {
  queued: "排队中",
  dispatching: "提交中",
  running: "生成中",
  finalizing: "保存中",
  uncertain: "待核对",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export default function Studio() {
  const [user, setUser] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [workspaces, setWorkspaces] = useState<Row[]>([]),
    [wid, setWid] = useState(""),
    [page, setPage] = useState("create");
  const [models, setModels] = useState<Row[]>([]),
    [jobs, setJobs] = useState<Row[]>([]),
    [assets, setAssets] = useState<Row[]>([]),
    [wallet, setWallet] = useState<Row | null>(null);
  const [modelId, setModelId] = useState(""),
    [prompt, setPrompt] = useState(""),
    [params, setParams] = useState<Row>({}),
    [references, setReferences] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const [plugins, setPlugins] = useState<Row[]>([]),
    [connections, setConnections] = useState<Row[]>([]),
    [adminModels, setAdminModels] = useState<Row[]>([]),
    [nodes, setNodes] = useState<Row[]>([]),
    [ledger, setLedger] = useState<Row[]>([]);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const currentWid = useRef(wid);
  currentWid.current = wid;
  const api = useCallback(
    async (path: string, body?: unknown, method?: string, workspace = wid) => {
      const response = await fetch(path, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: {
          ...(workspace ? { "X-Workspace-Id": workspace } : {}),
          ...(body instanceof File
            ? { "Content-Type": body.type }
            : body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
        },
        body:
          body === undefined
            ? undefined
            : body instanceof File
              ? body
              : JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "请求失败");
      return result;
    },
    [wid],
  );
  async function perform(action: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadSession() {
    try {
      const u = await api("/api/me");
      setUser(u);
      const spaces = await api("/api/workspaces");
      setWorkspaces(spaces);
      setWid(spaces[0]?.id || "");
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadSession();
  }, []);
  const refresh = useCallback(async () => {
    if (!wid) return;
    const expected = wid;
    const result = await Promise.all([
      api("/api/models"),
      api("/api/jobs"),
      api("/api/assets"),
      api("/api/wallet"),
    ]);
    if (currentWid.current !== expected) return;
    setModels(result[0]);
    setJobs(result[1]);
    setAssets(result[2]);
    setWallet(result[3]);
  }, [wid, api]);
  useEffect(() => {
    setModelId("");
    setReferences([]);
    pending.current = null;
    setJobs([]);
    setAssets([]);
    void perform(refresh);
    const timer = setInterval(() => void refresh().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) setModelId(models[0]?.id || "");
  }, [models, modelId]);
  const selected = models.find((m) => m.id === modelId);
  useEffect(() => {
    const properties = selected?.schema?.properties || {};
    setParams(
      Object.fromEntries(
        Object.entries(properties)
          .filter(([, v]) => (v as Row).default !== undefined)
          .map(([k, v]) => [k, (v as Row).default]),
      ),
    );
  }, [modelId]);
  async function loadAdmin() {
    const r = await Promise.all([
      api("/api/admin/plugins"),
      api("/api/admin/connections"),
      api("/api/admin/models"),
      api("/api/admin/gpu/nodes"),
    ]);
    setPlugins(r[0]);
    setConnections(r[1]);
    setAdminModels(r[2]);
    setNodes(r[3]);
  }
  useEffect(() => {
    if (page === "plugins" && user?.role === "admin") void perform(loadAdmin);
    if (page === "wallet")
      void perform(async () => setLedger(await api("/api/ledger")));
  }, [page, wid]);
  async function submit() {
    setBusy(true);
    await perform(async () => {
      const body = { modelId, prompt, params, references };
      const serialized = JSON.stringify(body);
      if (pending.current?.body !== serialized)
        pending.current = { key: crypto.randomUUID(), body: serialized };
      await api("/api/jobs", { ...body, key: pending.current.key });
      pending.current = null;
      setPrompt("");
      setReferences([]);
      await refresh();
    });
    setBusy(false);
  }
  if (loading)
    return (
      <main className="login">
        <p>正在加载工作台…</p>
      </main>
    );
  if (!user) return <Login api={api} onLogin={loadSession} />;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          <img src="/mark.svg" alt="" />
          弗淼<span>Advanced</span>
        </a>
        <label className="sr-only" htmlFor="workspace">
          工作区
        </label>
        <select
          id="workspace"
          value={wid}
          onChange={(e) => setWid(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <nav>
          {[
            ["create", "创作"],
            ["canvas", "画布"],
            ["chat", "对话"],
            ["assets", "资产"],
            ["packs", "素材包"],
            ["wallet", "积分"],
            ...(user.role === "admin"
              ? [
                  ["plugins", "模型与插件"],
                  ["team", "团队与邀请"],
                ]
              : []),
          ].map(([id, label]) => (
            <button
              className={page === id ? "selected" : ""}
              key={id}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <footer>
          <span>{user.nickname}</span>
          <button
            onClick={() =>
              void perform(async () => {
                await api("/api/logout", {});
                setUser(null);
              })
            }
          >
            退出
          </button>
        </footer>
      </aside>
      <main>
        <header>
          <h1>
            {
              {
                create: "创作工作台",
                canvas: "创作画布",
                chat: "对话",
                packs: "素材包",
                assets: "资产库",
                wallet: "积分",
                plugins: "模型与插件",
                team: "团队与邀请",
              }[page]
            }
          </h1>
          <span className="muted">
            可用积分{" "}
            {wallet ? Number(wallet.balance) - Number(wallet.held) : "—"}
          </span>
        </header>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        {page === "create" && (
          <>
            <section className="composer">
              <label>
                模型
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.provider} · {m.label} · {m.price} 积分
                    </option>
                  ))}
                </select>
              </label>
              {!models.length && (
                <p className="muted">
                  当前空间暂无可用模型。管理员可在“模型与插件”中配置连接并设置价格。
                </p>
              )}
              <label>
                创作内容
                <textarea
                  rows={5}
                  placeholder="描述你想创作的画面、视频或文字…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <SchemaFields
                schema={selected?.schema || {}}
                value={params}
                onChange={setParams}
              />
              <div className="actions">
                <label className="upload">
                  上传参考素材
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,video/mp4,audio/wav"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void perform(async () => {
                          const r = await api("/api/assets", f);
                          setReferences((v) => [...v, r.id]);
                          await refresh();
                        });
                    }}
                  />
                </label>
                <span className="muted">
                  已选 {references.length} 个参考素材
                </span>
                <button
                  className="primary"
                  disabled={busy || !selected || !prompt.trim()}
                  onClick={() => void submit()}
                >
                  {busy
                    ? "提交中…"
                    : `生成${selected ? " · " + selected.price + " 积分" : ""}`}
                </button>
              </div>
              {assets.filter((a) => a.mime.startsWith("image/")).length > 0 && (
                <div className="reference-strip">
                  {assets
                    .filter((a) => a.mime.startsWith("image/"))
                    .slice(0, 20)
                    .map((a) => (
                      <button
                        key={a.id}
                        aria-label="选择参考素材"
                        aria-pressed={references.includes(a.id)}
                        onClick={() =>
                          setReferences((v) =>
                            v.includes(a.id)
                              ? v.filter((id) => id !== a.id)
                              : [...v, a.id],
                          )
                        }
                      >
                        <img alt="参考素材" src={"/media/" + a.id} />
                      </button>
                    ))}
                </div>
              )}
            </section>
            <div className="jobs">
              {jobs.map((job) => (
                <article key={job.id} className="job">
                  <div className="row">
                    <strong>{job.provider_model}</strong>
                    <span>{status[job.state] || job.state}</span>
                  </div>
                  <p>{job.input.prompt}</p>
                  {job.error && <p className="muted">{job.error}</p>}
                  {job.result?.text && (
                    <pre className="answer">{job.result.text}</pre>
                  )}
                  {job.result?.assets?.map((id: string) => (
                    <Media
                      key={id}
                      asset={assets.find((a) => a.id === id)}
                      id={id}
                    />
                  ))}
                  {["queued", "running", "dispatching"].includes(job.state) && (
                    <button
                      disabled={job.cancel_requested}
                      onClick={() =>
                        void perform(async () => {
                          await api(`/api/jobs/${job.id}/cancel`, {});
                          await refresh();
                        })
                      }
                    >
                      {job.cancel_requested ? "取消已请求" : "取消"}
                    </button>
                  )}
                </article>
              ))}
              {!jobs.length && <p className="empty">生成的作品将在这里显示</p>}
            </div>
          </>
        )}
        {page === "chat" && (
          <Chat
            api={api}
            workspaceId={wid}
            onError={setError}
            models={models}
            jobs={jobs}
          />
        )}
        {page === "packs" && (
          <Packs
            api={api}
            workspaceId={wid}
            onError={setError}
            assets={assets}
          />
        )}
        {page === "canvas" && (
          <Canvas
            api={api}
            models={models}
            assets={assets}
            workspaceId={wid}
            onError={setError}
          />
        )}
        {page === "assets" && (
          <div className="asset-grid">
            {assets.map((a) => (
              <article className="job" key={a.id}>
                <Media asset={a} id={a.id} />
                <div className="row">
                  <span className="muted">
                    {(Number(a.size) / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <button
                    onClick={() =>
                      void perform(async () => {
                        await api("/api/assets/" + a.id, undefined, "DELETE");
                        await refresh();
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {page === "wallet" && (
          <>
            <Recharge
              api={api}
              workspaceId={wid}
              onError={setError}
              onPaid={refresh}
            />
            <section className="composer">
              <h2>当前工作区</h2>
              <p>
                余额 {wallet?.balance} · 冻结 {wallet?.held} · 可用{" "}
                {wallet ? Number(wallet.balance) - Number(wallet.held) : 0}
              </p>
              {user.role === "admin" && (
                <form
                  className="actions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    void perform(async () => {
                      await api("/api/admin/credits/" + wid, {
                        amount: Number(form.get("amount")),
                        key: crypto.randomUUID(),
                      });
                      await refresh();
                      setLedger(await api("/api/ledger"));
                    });
                  }}
                >
                  <input
                    name="amount"
                    type="number"
                    step="1"
                    required
                    placeholder="调整积分，负数为扣减"
                  />
                  <button>调整积分</button>
                </form>
              )}
            </section>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>积分</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.created_at).toLocaleString()}</td>
                    <td>
                      {(
                        {
                          hold: "冻结",
                          spend: "扣除",
                          refund: "释放",
                          grant: "赠送",
                          adjust: "调整",
                        } as Row
                      )[l.action] || l.action}
                    </td>
                    <td>{l.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {page === "plugins" && (
          <>
            <PluginManager
              plugins={plugins}
              api={api}
              onDone={loadAdmin}
              perform={perform}
            />
            <h2>连接实例</h2>
            {connections.map((c) => (
              <section key={c.id} className="connection">
                <div className="row">
                  <div>
                    <strong>{c.name}</strong>
                    <p className="muted">
                      {c.plugin_id} {c.plugin_version} · 并发 {c.concurrency}
                    </p>
                  </div>
                  <div className="actions">
                    <button
                      onClick={() =>
                        void perform(async () => {
                          const r = await api(
                            `/api/admin/connections/${c.id}/health`,
                            {},
                          );
                          setNotice(r.ready ? "连接可用" : "连接当前不可用");
                        })
                      }
                    >
                      检查连接
                    </button>
                    <button
                      onClick={() =>
                        void perform(async () => {
                          await api(
                            "/api/admin/connections/" + c.id,
                            {
                              revision: c.revision,
                              enabled: !c.enabled,
                              concurrency: c.concurrency,
                            },
                            "PUT",
                          );
                          await loadAdmin();
                          await refresh();
                        })
                      }
                    >
                      {c.enabled ? "停用" : "启用"}
                    </button>
                    {c.plugin_id === "gpu" && (
                      <button
                        onClick={() =>
                          void perform(async () => {
                            const r = await api("/api/admin/gpu/pairs", {
                              connectionId: c.id,
                            });
                            setNotice("GPU 接入码（30 分钟有效） " + r.code);
                          })
                        }
                      >
                        接入 GPU
                      </button>
                    )}
                  </div>
                </div>
                <details>
                  <summary>模型与价格</summary>
                  {adminModels
                    .filter((m) => m.connection_id === c.id)
                    .map((m) => (
                      <ModelSettings
                        key={m.id}
                        model={m}
                        save={async (value) => {
                          await api("/api/admin/models/" + m.id, value, "PUT");
                          await loadAdmin();
                          await refresh();
                        }}
                        perform={perform}
                      />
                    ))}
                </details>
              </section>
            ))}
            <h2>GPU 节点</h2>
            {nodes.map((n) => (
              <div className="connection row" key={n.id}>
                <span>
                  {n.name} · {n.models.join("、")} ·{" "}
                  {new Date(n.last_seen).toLocaleString()}
                </span>
                <button
                  disabled={!n.enabled}
                  onClick={() =>
                    void perform(async () => {
                      await api(
                        "/api/admin/gpu/nodes/" + n.id,
                        undefined,
                        "DELETE",
                      );
                      await loadAdmin();
                    })
                  }
                >
                  {n.enabled ? "撤销接入" : "已撤销"}
                </button>
              </div>
            ))}
          </>
        )}
        {page === "team" && (
          <>
            <AdminTools api={api} workspaceId={wid} onError={setError} />
            <Team
              api={api}
              perform={perform}
              notice={setNotice}
              refresh={async () => {
                setWorkspaces(await api("/api/workspaces"));
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
function Media({ asset, id }: { asset?: Row; id: string }) {
  if (!asset) return <a href={"/media/" + id}>下载结果</a>;
  return (
    <div className="media">
      {asset.mime.startsWith("image/") ? (
        <img src={"/media/" + id} alt="生成素材" />
      ) : asset.mime.startsWith("video/") ? (
        <video src={"/media/" + id} controls preload="metadata" />
      ) : (
        <audio src={"/media/" + id} controls />
      )}
      <a href={"/media/" + id} download>
        下载
      </a>
    </div>
  );
}
function SchemaFields({
  schema,
  value,
  onChange,
}: {
  schema: Row;
  value: Row;
  onChange: (value: Row) => void;
}) {
  return (
    <div className="fields">
      {Object.entries(schema.properties || {}).map(([key, raw]) => {
        const spec = raw as Row;
        if (key === "history") return null;
        return (
          <label key={key}>
            {spec.title ||
              (
                {
                  ratio: "画幅",
                  quality: "清晰度",
                  seconds: "时长",
                  sampling_steps: "采样步数",
                  seed: "随机种子",
                  instruction: "音色描述",
                  temperature: "温度",
                  baseUrl: "服务地址",
                  apiKey: "API 密钥",
                } as Row
              )[key] ||
              key}
            {spec.enum ? (
              <select
                value={value[key] ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]:
                      spec.type === "integer" || spec.type === "number"
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              >
                {spec.enum.map((v: any) => (
                  <option key={String(v)} value={v}>
                    {String(v)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required={(schema.required || []).includes(key)}
                type={
                  spec.writeOnly
                    ? "password"
                    : spec.type === "integer" || spec.type === "number"
                      ? "number"
                      : "text"
                }
                min={spec.minimum}
                max={spec.maximum}
                step={spec.type === "number" ? "any" : 1}
                value={
                  Array.isArray(value[key])
                    ? value[key].join(",")
                    : (value[key] ?? "")
                }
                onChange={(e) => {
                  const next = { ...value };
                  if (e.target.value === "") delete next[key];
                  else
                    next[key] =
                      spec.type === "array"
                        ? e.target.value
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean)
                        : spec.type === "integer" || spec.type === "number"
                          ? Number(e.target.value)
                          : e.target.value;
                  onChange(next);
                }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
function Login({ api, onLogin }: { api: any; onLogin: () => Promise<void> }) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = Object.fromEntries(new FormData(e.currentTarget));
          try {
            if (register) await api("/api/register", data);
            await api("/api/login", {
              name: data.name,
              password: data.password,
            });
            await onLogin();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <img src="/mark.svg" alt="弗淼" />
        <h1>{register ? "创建账户" : "登录弗淼"}</h1>
        <label>
          用户名
          <input name="name" autoComplete="username" required />
        </label>
        {register && (
          <label>
            昵称
            <input name="nickname" required />
          </label>
        )}
        <label>
          密码
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? 12 : 1}
          />
        </label>
        {register && (
          <label>
            邀请码
            <input name="code" required />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "请稍候…" : register ? "注册并登录" : "登录"}
        </button>
        <button type="button" onClick={() => setRegister(!register)}>
          {register ? "已有账户，去登录" : "使用邀请码注册"}
        </button>
      </form>
    </main>
  );
}
function PluginManager({
  plugins,
  api,
  onDone,
  perform,
}: {
  plugins: Row[];
  api: any;
  onDone: () => Promise<void>;
  perform: any;
}) {
  const [id, setId] = useState(""),
    [config, setConfig] = useState<Row>({});
  const plugin =
    plugins.find((p) => p.id + "@" + p.version === id) || plugins[0];
  return (
    <section className="composer">
      <h2>添加模型提供方</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          void perform(async () => {
            await api("/api/admin/connections", {
              name: values.get("name"),
              pluginId: plugin.id,
              version: plugin.version,
              config,
              concurrency: Number(values.get("concurrency")),
            });
            setConfig({});
            await onDone();
          });
        }}
      >
        <div className="fields">
          <label>
            插件
            <select
              value={plugin ? id || plugin.id + "@" + plugin.version : ""}
              onChange={(e) => {
                setId(e.target.value);
                setConfig({});
              }}
            >
              {plugins.map((p) => (
                <option key={p.id + p.version} value={p.id + "@" + p.version}>
                  {p.manifest.label} {p.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            连接名称
            <input name="name" required />
          </label>
          <label>
            最大并发
            <input
              type="number"
              name="concurrency"
              defaultValue={1}
              min={1}
              max={100}
            />
          </label>
        </div>
        <SchemaFields
          schema={plugin?.manifest.configSchema || {}}
          value={config}
          onChange={setConfig}
        />
        <button className="primary" disabled={!plugin}>
          创建连接
        </button>
      </form>
      <details>
        <summary>安装远程插件</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void perform(async () => {
              await api("/api/admin/plugins", {
                endpoint: form.get("endpoint"),
                manifest: JSON.parse(String(form.get("manifest"))),
              });
              await onDone();
            });
          }}
        >
          <label>
            插件服务地址
            <input name="endpoint" type="url" required />
          </label>
          <label>
            插件 manifest
            <textarea name="manifest" rows={5} required />
          </label>
          <button>安装插件</button>
        </form>
      </details>
    </section>
  );
}
function ModelSettings({
  model,
  save,
  perform,
}: {
  model: Row;
  save: (value: any) => Promise<void>;
  perform: any;
}) {
  const [price, setPrice] = useState(model.price || 1);
  return (
    <div className="model-row">
      <span>{model.label}</span>
      <label>
        积分
        <input
          type="number"
          min={1}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
      </label>
      <button
        onClick={() =>
          void perform(() => save({ enabled: true, price: Number(price) }))
        }
      >
        保存并开放
      </button>
      <button
        disabled={!model.enabled}
        onClick={() =>
          void perform(() => save({ enabled: false, price: Number(price) }))
        }
      >
        {model.enabled ? "停用" : "已停用"}
      </button>
    </div>
  );
}
function Team({
  api,
  perform,
  notice,
  refresh,
}: {
  api: any;
  perform: any;
  notice: (s: string) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="two-columns">
      <section className="composer">
        <h2>创建团队空间</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              await api("/api/workspaces", { name: f.get("name") });
              await refresh();
              notice("团队空间已创建");
            });
          }}
        >
          <label>
            团队名称
            <input name="name" required />
          </label>
          <button>创建团队</button>
        </form>
      </section>
      <section className="composer">
        <h2>创建邀请码</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              const r = await api("/api/admin/invites", {
                name: f.get("name"),
                credits: Number(f.get("credits")),
              });
              notice("邀请码 " + r.code);
            });
          }}
        >
          <label>
            名称
            <input name="name" required />
          </label>
          <label>
            赠送个人积分
            <input name="credits" type="number" defaultValue={0} min={0} />
          </label>
          <button>创建邀请码</button>
        </form>
      </section>
    </div>
  );
}
