import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModelAccessView,
  ModelConnection,
  PublicationItem,
} from "@fumiao/web-compat/model-access.js";
import { ModelAccessImport } from "./ModelAccessImport";
import { PublicationCard } from "./ModelAccessPublication";
import type { AdminSave } from "./settings-admin";
import type { StudioState } from "./state";

const path = "/api/admin/model-access";
export function SettingsModelAccess({
  state,
  initialModel,
  request,
  refresh,
}: { state: StudioState; initialModel?: string } & Pick<
  AdminSave,
  "request" | "refresh"
>) {
  const [view, setView] = useState<ModelAccessView>();
  const [mode, setMode] = useState<"catalog" | "import">("catalog");
  const [connection, setConnection] = useState("");
  const [initialUpstream, setInitialUpstream] = useState("");
  const [add, setAdd] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const publication = useRef<{ key: string; uid: string } | null>(null);
  const reload = useCallback(async () => {
    setView((await request(path)) as ModelAccessView);
  }, [request]);
  useEffect(() => {
    let live = true;
    void request(path).then(
      (v) => {
        if (live) setView(v as ModelAccessView);
      },
      (e) => {
        if (live) setError((e as Error).message);
      },
    );
    return () => {
      live = false;
    };
  }, [request]);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && initialModel && view) {
      focused.current = true;
      document
        .getElementById("access-" + initialModel)
        ?.scrollIntoView({ block: "center" });
    }
  }, [initialModel, view]);
  function run(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    void fn()
      .catch((e) => setError((e as Error).message))
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  }
  async function publish(items: PublicationItem[]) {
    const key = JSON.stringify(items);
    if (publication.current?.key !== key)
      publication.current = { key, uid: crypto.randomUUID() };
    await request(path + "/publications", {
      uid: publication.current.uid,
      items,
    });
    publication.current = null;
    await refresh();
  }
  async function created(c: ModelConnection) {
    setSecret("");
    setAdd(false);
    setInitialUpstream("");
    setConnection(c.id);
    try {
      await request(path + "/connections/" + c.id + "/discover", {
        expected_revision: c.revision,
      });
    } finally {
      await reload();
    }
  }
  const current = view?.connections.find((c) => c.id === connection);
  const unpublished =
    view?.drafts.filter(
      (d) =>
        !view.publications.some((p) =>
          p.routes.some(
            (r) => r.draft_id === d.id && r.draft_revision === d.revision,
          ),
        ),
    ) ?? [];
  return (
    <section className="settings-section model-access">
      <header className="access-card-head">
        <div>
          <h2>模型接入</h2>
          <p className="console-description">
            {mode === "catalog"
              ? "管理 Studio 模型的售价和当前线路。"
              : "选择网关，读取目录并为模型定价。"}
          </p>
        </div>
        <button
          className="ledger-button ledger-primary"
          onClick={() => {
            setMode(mode === "catalog" ? "import" : "catalog");
            setError("");
            setMessage("");
          }}
        >
          {mode === "catalog" ? "接入服务" : "返回公开模型"}
        </button>
      </header>
      {error && (
        <div className="ledger-card plugin-alert" role="alert">
          {error}{" "}
          <button className="ledger-button" onClick={() => run(reload)}>
            刷新数据
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
      {!view && !error && <p role="status">正在读取模型…</p>}
      {view && (
        <fieldset className="access-body" disabled={busy} aria-busy={busy}>
          {mode === "catalog" ? (
            <>
              {!view.publications.length && (
                <div className="ledger-card">
                  <h3>暂无已上架的模型</h3>
                  <p>接入服务后，成员就可以在工作区选择已开放的模型。</p>
                </div>
              )}
              {view.publications.map((p) => (
                <PublicationCard
                  key={p.catalog_id}
                  startPricing={initialModel === p.catalog_id}
                  model={p}
                  state={state}
                  view={view}
                  request={request}
                  run={run}
                  reload={reload}
                  publish={publish}
                />
              ))}
              {!!unpublished.length && (
                <section className="ledger-card">
                  <h3>待上架草稿</h3>
                  {unpublished.map((d) => (
                    <div key={d.id} className="setting-row">
                      <span>
                        {d.upstream_id} ·{" "}
                        {d.status === "ready" ? "可上架" : "待补充"}
                      </span>
                      <button
                        className="ledger-button"
                        onClick={() => {
                          setInitialUpstream(d.upstream_id);
                          setConnection(d.connection_id);
                          setMode("import");
                          setAdd(false);
                        }}
                      >
                        继续编辑
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {!!view.publications.length && (
                <button className="ledger-button" onClick={() => run(reload)}>
                  刷新线路状态
                </button>
              )}
            </>
          ) : (
            <>
              <div className="ledger-card">
                <div className="access-fields">
                  <label>
                    已保存的连接
                    <select
                      value={connection}
                      onChange={(e) => {
                        setInitialUpstream("");
                        setConnection(e.target.value);
                        setAdd(false);
                        setError("");
                        setMessage("");
                      }}
                    >
                      <option value="">选择连接</option>
                      {view.connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.base_url}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="ledger-button"
                    onClick={() => setAdd(!add)}
                  >
                    添加连接
                  </button>
                </div>
                {(add || !view.connections.length) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () =>
                        created(
                          (await request(path + "/connections", {
                            base_url: address.trim(),
                            api_key: secret,
                            ...(name.trim() ? { name: name.trim() } : {}),
                          })) as ModelConnection,
                        ),
                      );
                    }}
                  >
                    <div className="access-fields">
                      <label>
                        服务名称（可选）
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="默认使用主机名"
                        />
                      </label>
                      <label>
                        API 根地址
                        <input
                          required
                          type="url"
                          placeholder="https://gateway.example/v1"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                        />
                      </label>
                      <label>
                        API 密钥
                        <input
                          required
                          type="password"
                          autoComplete="new-password"
                          value={secret}
                          onChange={(e) => setSecret(e.target.value)}
                        />
                      </label>
                    </div>
                    {address && (
                      <p>
                        目录地址{" "}
                        <code>{address.trim().replace(/\/+$/, "")}/models</code>
                      </p>
                    )}
                    <button
                      className="ledger-button ledger-primary"
                      type="submit"
                    >
                      保存并读取模型
                    </button>
                  </form>
                )}
                {view.reusable_connections.length > 0 && (
                  <details>
                    <summary>
                      复用已有兼容对话连接（{view.reusable_connections.length}）
                    </summary>
                    {view.reusable_connections.map((c) => (
                      <div className="setting-row" key={c.id}>
                        <span>
                          {c.name} · {c.base_url}
                          <small>
                            {c.models.join("、")} ·{" "}
                            {c.borrowed
                              ? "借用密钥，仅限原用途"
                              : "使用原连接授权"}
                          </small>
                        </span>
                        <button
                          className="ledger-button"
                          onClick={() =>
                            run(async () =>
                              created(
                                (await request(path + "/connections/reuse", {
                                  connection_id: c.id,
                                  expected_revision: c.revision,
                                })) as ModelConnection,
                              ),
                            )
                          }
                        >
                          复用连接
                        </button>
                      </div>
                    ))}
                  </details>
                )}
              </div>
              {current && (
                <ModelAccessImport
                  key={current.id + ":" + initialUpstream}
                  initialUpstream={initialUpstream}
                  view={view}
                  connection={current}
                  state={state}
                  request={request}
                  reload={reload}
                  run={run}
                  message={setMessage}
                  publish={publish}
                />
              )}
            </>
          )}
        </fieldset>
      )}
    </section>
  );
}
