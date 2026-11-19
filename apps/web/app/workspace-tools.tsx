"use client";
import { useEffect, useRef, useState } from "react";
type Row = Record<string, any>;
type Props = { api: any; workspaceId: string; onError: (s: string) => void };
export function Chat({
  api,
  workspaceId,
  onError,
  models,
  jobs,
}: { models: Row[]; jobs: Row[] } & Props) {
  const [docs, setDocs] = useState<Row[]>([]),
    [doc, setDoc] = useState<Row | null>(null),
    [prompt, setPrompt] = useState(""),
    [model, setModel] = useState("");
  const busy = useRef(false);
  const choices = models.filter((m) => m.kind === "chat");
  async function load() {
    setDocs(await api("/api/documents/chat"));
  }
  useEffect(() => {
    setDoc(null);
    void load().catch((e: Error) => onError(e.message));
  }, [workspaceId]);
  useEffect(() => {
    if (!choices.some((m) => m.id === model)) setModel(choices[0]?.id || "");
  }, [models]);
  async function save(next: Row) {
    const saved = await api("/api/documents", { ...next, kind: "chat" }, "PUT");
    const result = { ...next, revision: saved.revision };
    setDoc(result);
    await load();
    return result;
  }
  useEffect(() => {
    if (!doc?.body.pending?.jobId || busy.current) return;
    const job = jobs.find((j) => j.id === doc.body.pending.jobId);
    if (!job || !["completed", "failed", "cancelled"].includes(job.state))
      return;
    busy.current = true;
    const messages = [...(doc.body.messages || [])];
    if (job.state === "completed")
      messages.push({ role: "assistant", content: job.result?.text || "" });
    void save({
      ...doc,
      body: {
        ...doc.body,
        messages,
        pending: null,
        lastError: job.state === "completed" ? null : job.error || "任务未完成",
      },
    })
      .catch((e) => onError(e.message))
      .finally(() => {
        busy.current = false;
      });
  }, [jobs, doc]);
  async function send() {
    if (busy.current || !doc) return;
    busy.current = true;
    try {
      let next = doc;
      let request = doc.body.pending?.request;
      if (!request) {
        request = {
          key: crypto.randomUUID(),
          modelId: model,
          prompt,
          params: {
            history: (doc.body.messages || [])
              .slice(-40)
              .map((m: Row) => ({ role: m.role, content: m.content })),
          },
        };
        next = await save({
          ...doc,
          body: {
            ...doc.body,
            messages: [
              ...(doc.body.messages || []),
              { role: "user", content: prompt },
            ],
            pending: { request },
            lastError: null,
          },
        });
        setPrompt("");
      }
      const job = await api("/api/jobs", request);
      await save({
        ...next,
        body: { ...next.body, pending: { request, jobId: job.id } },
      });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  return (
    <div>
      <div className="actions">
        <select
          value={doc?.id || ""}
          aria-label="选择对话"
          onChange={(e) =>
            setDoc(docs.find((d) => d.id === e.target.value) || null)
          }
        >
          <option value="">选择对话</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            setDoc({
              id: crypto.randomUUID(),
              title: "新对话",
              revision: 0,
              body: { messages: [] },
            })
          }
        >
          新建对话
        </button>
      </div>
      {doc && (
        <section className="composer">
          <label>
            名称
            <input
              value={doc.title}
              onChange={(e) => setDoc({ ...doc, title: e.target.value })}
            />
          </label>
          {(doc.body.messages || []).map((m: Row, i: number) => (
            <article key={i} className="job">
              <strong>{m.role === "user" ? "你" : "助手"}</strong>
              <pre className="answer">{m.content}</pre>
            </article>
          ))}
          {doc.body.lastError && <p role="alert">{doc.body.lastError}</p>}
          {doc.body.pending?.jobId ? (
            <p>
              正在处理 ·{" "}
              {jobs.find((j) => j.id === doc.body.pending.jobId)?.state ||
                "排队中"}
            </p>
          ) : doc.body.pending ? (
            <button onClick={() => void send()}>恢复上次提交</button>
          ) : (
            <>
              <label>
                模型
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.price} 积分
                    </option>
                  ))}
                </select>
              </label>
              <label>
                消息
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={!prompt.trim() || !model}
                onClick={() => void send()}
              >
                发送
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
export function Packs({
  api,
  workspaceId,
  onError,
  assets,
}: Props & { assets: Row[] }) {
  const [docs, setDocs] = useState<Row[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [favorites, setFavorites] = useState<string[]>([]),
    [name, setName] = useState("");
  async function load() {
    setDocs(await api("/api/documents/pack"));
    setFavorites((await api("/api/favorites")).map((f: Row) => f.asset_id));
  }
  useEffect(() => {
    setSelected([]);
    void load().catch((e: Error) => onError(e.message));
  }, [workspaceId]);
  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <section>
      <div className="composer">
        <h2>素材包</h2>
        <div className="actions">
          <input
            placeholder="素材包名称"
            aria-label="素材包名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            disabled={!name || !selected.length}
            onClick={() =>
              void act(async () => {
                await api(
                  "/api/documents",
                  {
                    id: crypto.randomUUID(),
                    kind: "pack",
                    title: name,
                    revision: 0,
                    body: { assets: selected },
                    assets: selected,
                  },
                  "PUT",
                );
                setName("");
                setSelected([]);
                await load();
              })
            }
          >
            保存所选素材
          </button>
        </div>
        <div className="actions">
          {docs.map((d) => (
            <button key={d.id} onClick={() => setSelected(d.body.assets || [])}>
              {d.title} · {(d.body.assets || []).length}
            </button>
          ))}
        </div>
      </div>
      <div className="asset-grid">
        {assets.map((a) => (
          <article className="job" key={a.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                onChange={() =>
                  setSelected((v) =>
                    v.includes(a.id)
                      ? v.filter((id) => id !== a.id)
                      : [...v, a.id],
                  )
                }
              />
              选择素材
            </label>
            {a.mime.startsWith("image/") ? (
              <img className="asset-thumb" src={"/media/" + a.id} alt="素材" />
            ) : (
              <a href={"/media/" + a.id}>{a.mime}</a>
            )}
            <button
              onClick={() =>
                void act(async () => {
                  await api(
                    "/api/favorites/" + a.id,
                    { enabled: !favorites.includes(a.id) },
                    "PUT",
                  );
                  await load();
                })
              }
            >
              {favorites.includes(a.id) ? "取消收藏" : "收藏"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
export function Recharge({
  api,
  workspaceId,
  onError,
  onPaid,
}: Props & { onPaid: () => Promise<void> }) {
  const [data, setData] = useState<Row>({ channels: [], orders: [] }),
    [method, setMethod] = useState("alipay"),
    [yuan, setYuan] = useState(10);
  const pending = useRef<Row | null>(null),
    busy = useRef(false);
  async function load() {
    const data = await api("/api/payments");
    setData(data);
    if (!data.channels.some((c: Row) => c.method === method))
      setMethod(data.channels[0]?.method || "alipay");
  }
  useEffect(() => {
    pending.current = null;
    void load().catch((e: Error) => onError(e.message));
  }, [workspaceId]);
  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <section className="composer">
      <h2>在线充值</h2>
      {data.channels.length ? (
        <div className="actions">
          <select
            aria-label="付款方式"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {data.channels.map((c: Row) => (
              <option key={c.method} value={c.method}>
                {c.method === "alipay" ? "支付宝" : "USDT-Plasma"}
              </option>
            ))}
          </select>
          <input
            aria-label="充值金额（元）"
            type="number"
            min={1}
            max={10000}
            value={yuan}
            onChange={(e) => setYuan(Number(e.target.value))}
          />
          <span>元</span>
          <button
            onClick={() =>
              void act(async () => {
                if (busy.current) return;
                busy.current = true;
                try {
                  if (
                    !pending.current ||
                    pending.current.method !== method ||
                    pending.current.yuan !== yuan
                  )
                    pending.current = {
                      key: crypto.randomUUID(),
                      method,
                      yuan,
                    };
                  await api("/api/payments", pending.current);
                  pending.current = null;
                  await load();
                } finally {
                  busy.current = false;
                }
              })
            }
          >
            创建充值订单
          </button>
        </div>
      ) : (
        <p className="muted">管理员尚未启用在线支付。</p>
      )}
      {data.orders.map((o: Row) => (
        <div className="model-row" key={o.id}>
          <span>
            ¥{(o.amount / 100).toFixed(2)} · {o.credits} 积分 ·{" "}
            {o.state === "paid"
              ? "已支付"
              : o.state === "unconfirmed"
                ? "待确认"
                : "待支付"}
          </span>
          {o.checkout && (
            <a target="_blank" rel="noreferrer" href={o.checkout}>
              前往付款
            </a>
          )}
          <button
            onClick={() =>
              void act(async () => {
                const result = await api(
                  "/api/payments/" + o.id + "/check",
                  {},
                );
                if (result.warning) onError(result.warning);
                await load();
                await onPaid();
              })
            }
          >
            查询结果
          </button>
        </div>
      ))}
    </section>
  );
}
export function AdminTools({ api, workspaceId, onError }: Props) {
  const [users, setUsers] = useState<Row[]>([]),
    [spaces, setSpaces] = useState<Row[]>([]),
    [members, setMembers] = useState<string[]>([]),
    [uncertain, setUncertain] = useState<Row[]>([]),
    [selected, setSelected] = useState("");
  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function load() {
    setUsers(await api("/api/admin/users"));
    setSpaces(
      (await api("/api/workspaces")).filter((w: Row) => w.kind === "team"),
    );
    setUncertain(await api("/api/admin/uncertain-jobs"));
  }
  useEffect(() => {
    void act(load);
  }, []);
  useEffect(() => {
    if (selected)
      void act(async () =>
        setMembers(
          (await api("/api/workspaces/" + selected + "/members")).map(
            (m: Row) => m.user_id,
          ),
        ),
      );
  }, [selected]);
  return (
    <>
      <section className="composer">
        <h2>团队成员</h2>
        <select
          value={selected}
          aria-label="管理团队"
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">选择团队</option>
          {spaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {selected && (
          <>
            <div className="fields">
              {users.map((u) => (
                <label key={u.id}>
                  <input
                    type="checkbox"
                    checked={members.includes(u.id)}
                    onChange={() =>
                      setMembers((v) =>
                        v.includes(u.id)
                          ? v.filter((id) => id !== u.id)
                          : [...v, u.id],
                      )
                    }
                  />
                  {u.nickname} ({u.name})
                </label>
              ))}
            </div>
            <button
              onClick={() =>
                void act(async () => {
                  await api(
                    "/api/workspaces/" + selected,
                    {
                      name: spaces.find((w) => w.id === selected)?.name,
                      members,
                    },
                    "PUT",
                  );
                })
              }
            >
              保存成员
            </button>
          </>
        )}
      </section>
      <section className="composer">
        <h2>用户管理</h2>
        {users.map((u) => (
          <div className="model-row" key={u.id}>
            <span>
              {u.name} · {u.nickname}
            </span>
            <button
              disabled={u.role === "admin"}
              onClick={() =>
                void act(async () => {
                  await api(
                    "/api/admin/users/" + u.id,
                    { active: !u.active, nickname: u.nickname },
                    "PUT",
                  );
                  await load();
                })
              }
            >
              {u.active ? "停用" : "启用"}
            </button>
          </div>
        ))}
      </section>
      <section className="composer">
        <h2>待核对任务</h2>
        <p className="muted">
          请先核对提供方记录。填写上游任务编号可恢复查询；确认无需继续后可释放冻结积分。
        </p>
        {uncertain.map((job) => (
          <form
            className="job"
            key={job.id}
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              void act(async () => {
                await api("/api/admin/jobs/" + job.id + "/resolve", {
                  action: values.get("action"),
                  reason: values.get("reason"),
                  ...(values.get("remoteId")
                    ? { remoteId: values.get("remoteId") }
                    : {}),
                });
                await load();
              });
            }}
          >
            <p>
              {job.plugin_id} · {job.provider_model} · {job.id}
            </p>
            <label>
              核对结果
              <input name="reason" required minLength={5} />
            </label>
            <label>
              处理方式
              <select name="action">
                <option value="resume">恢复上游查询</option>
                <option value="refund">结束任务并释放积分</option>
              </select>
            </label>
            <label>
              上游任务编号
              <input name="remoteId" />
            </label>
            <button>确认处理</button>
          </form>
        ))}
      </section>
      <section className="composer">
        <h2>支付插件</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(async () => {
              await api(
                "/api/admin/payments/" + f.get("method"),
                {
                  enabled: f.get("enabled") === "on",
                  config: {
                    gateway: f.get("gateway"),
                    pid: f.get("pid"),
                    key: f.get("key"),
                  },
                },
                "PUT",
              );
              e.currentTarget?.reset();
            });
          }}
        >
          <label>
            支付通道
            <select name="method">
              <option value="alipay">ZPay 支付宝</option>
              <option value="usdt_plasma">EPusdt Plasma</option>
            </select>
          </label>
          <label>
            网关地址
            <input name="gateway" type="url" required />
          </label>
          <label>
            商户 ID
            <input name="pid" required />
          </label>
          <label>
            商户密钥
            <input
              name="key"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            <input name="enabled" type="checkbox" />
            启用
          </label>
          <button>保存支付通道</button>
        </form>
      </section>
    </>
  );
}
