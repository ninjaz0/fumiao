import { useEffect, useState } from "react";
import type {
  ModelAccessView,
  ModelPublication,
  PublicationItem,
  PublishedPrice,
  ModelTrialReceipt,
  ModelTrialSample,
  ModelTrialQuote,
} from "@fumiao/web-compat/model-access.js";
import { api } from "./api";
import { ApiError } from "../canvas/api";
import type { AdminRequest } from "./settings-admin";
import type { Asset, StudioState } from "./state";
import type { RunAccess } from "./ModelAccessImport";
import { PriceFields } from "./ModelAccessFields";
import {
  chatRates,
  directoryLabels,
  formats,
  groupRoutes,
  priceText,
  purposes,
  ratesOf,
} from "./model-access-editor";

type PendingTrial = { sample: ModelTrialSample; quote: ModelTrialQuote };
type Route = ModelPublication["routes"][number];
const stateNames: Record<string, string> = {
  complete: "成功",
  completed: "成功",
  failed: "失败",
  stopped: "已停止",
  interrupted: "已中断",
  cancelled: "已取消",
  uncertain: "待核查",
};
function capabilities(route: Route) {
  const c = route.capabilities;
  const values = [formats[route.protocol]];
  if (route.protocol === "openai-chat") {
    values.push(c.chat_response === "json" ? "整段返回" : "流式回复");
    if (c.tools ?? c.names?.includes("tools")) values.push("工具调用");
  }
  if (c.durations?.length) values.push(c.durations.join(" / ") + " 秒");
  if (c.duration_range)
    values.push(c.duration_range.min + "–" + c.duration_range.max + " 秒");
  if (c.sizes?.length) values.push(c.sizes.join(" / "));
  if (c.resolutions?.length) values.push(c.resolutions.join(" / "));
  if (c.aspect_ratios?.length) values.push(c.aspect_ratios.join(" / "));
  if (c.input_references)
    values.push(
      `参考图 ${c.input_references.min}–${c.input_references.max} 张`,
    );
  if (c.frame_images?.includes("first_frame"))
    values.push(c.requires_first_frame ? "必须有首帧" : "可用首帧");
  return values.join(" · ");
}
function Trial({
  model,
  route,
  state,
  request,
  run,
  reload,
}: {
  model: ModelPublication;
  route: Route;
  state: StudioState;
  request: AdminRequest;
  run: RunAccess;
  reload: () => Promise<void>;
}) {
  const recoveryKey = `model-trial:${state.me.id}:${route.route_revision_id}`;
  const [recovery, setRecovery] = useState<PendingTrial | null>(() => {
    try {
      const entry = JSON.parse(
        sessionStorage.getItem(recoveryKey) ?? "null",
      ) as PendingTrial | null;
      return entry?.sample.route_revision === route.route_revision_id &&
        entry.quote?.route_revision === route.route_revision_id
        ? entry
        : null;
    } catch {
      return null;
    }
  });
  const [workspace, setWorkspace] = useState(
    recovery?.sample.workspace ?? state.workspace_id,
  );
  const [prompt, setPrompt] = useState(recovery?.sample.prompt ?? "");
  const [ref, setRef] = useState<string[]>(recovery?.sample.refs ?? []);
  const [seconds, setSeconds] = useState(
    String(
      recovery?.sample.params?.seconds ??
        route.capabilities.durations?.[0] ??
        route.capabilities.duration_range?.min ??
        "",
    ),
  );
  const [assets, setAssets] = useState<Asset[]>(state.assets);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingTrial | null>(recovery);
  const [receipt, setReceipt] = useState("");
  const path =
    "/api/admin/model-access/routes/" + route.route_revision_id + "/trial";
  const c = route.capabilities;
  const refs =
    model.price.kind === "video"
      ? c.frame_images?.includes("first_frame")
        ? 1
        : 0
      : model.price.kind === "image"
        ? (c.input_references?.max ??
          (c.input_modalities?.includes("image") ||
          c.names?.includes("input_references")
            ? 9
            : 0))
        : 0;
  useEffect(() => {
    if (workspace === state.workspace_id) {
      setAssets(state.assets);
      return;
    }
    const ctl = new AbortController();
    setAssets([]);
    setError("");
    void api<StudioState>(
      String(workspace),
      "/api/state",
      undefined,
      "GET",
      ctl.signal,
    ).then(
      (s) => setAssets(s.assets),
      (e) => {
        if (!ctl.signal.aborted) setError((e as Error).message);
      },
    );
    return () => ctl.abort();
  }, [workspace, state.workspace_id, state.assets]);
  async function quote() {
    const sample: ModelTrialSample = {
      uid: crypto.randomUUID(),
      workspace,
      prompt,
      refs: ref,
      route_revision: route.route_revision_id,
      price_revision: model.price_revision_id,
      ...(model.price.kind === "video"
        ? { params: { seconds: Number(seconds) } }
        : {}),
    };
    setReceipt("");
    setPending({
      sample,
      quote: (await request(path + "/quote", sample)) as ModelTrialQuote,
    });
  }
  async function submit() {
    if (!pending) return;
    sessionStorage.setItem(recoveryKey, JSON.stringify(pending));
    setRecovery(pending);
    let receipt: ModelTrialReceipt;
    try {
      receipt = (await request(path, {
        ...pending.sample,
        quote: pending.quote,
      })) as ModelTrialReceipt;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        sessionStorage.removeItem(recoveryKey);
        setRecovery(null);
        setPending(null);
      }
      throw e;
    }
    sessionStorage.removeItem(recoveryKey);
    setRecovery(null);
    setReceipt(
      "job" in receipt
        ? `试用任务 #${receipt.job} 已受理`
        : `试用对话回合 ${receipt.turn} 已受理`,
    );
    setPending(null);
    await reload();
  }
  return (
    <div className="access-trial">
      <h4>试用此线路</h4>
      <fieldset disabled={!!recovery} className="trial-inputs">
        <div className="access-fields">
          <label>
            扣费工作区
            <select
              value={workspace}
              onChange={(e) => {
                setWorkspace(Number(e.target.value));
                setRef([]);
                setPending(null);
              }}
            >
              {state.workspaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {model.price.kind === "video" && (
            <label>
              试用时长（秒）
              {c.duration_range ? (
                <input
                  type="number"
                  min={c.duration_range.min}
                  max={c.duration_range.max}
                  value={seconds}
                  onChange={(e) => {
                    setSeconds(e.target.value);
                    setPending(null);
                  }}
                />
              ) : (
                <select
                  value={seconds}
                  onChange={(e) => {
                    setSeconds(e.target.value);
                    setPending(null);
                  }}
                >
                  {c.durations?.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </label>
          )}
        </div>
        <label>
          样例输入
          <textarea
            rows={2}
            value={prompt}
            placeholder="输入本次试用的提示词"
            onChange={(e) => {
              setPrompt(e.target.value);
              setPending(null);
            }}
          />
        </label>
        {refs > 0 && (
          <label>
            {model.price.kind === "video" ? "首帧图片" : "参考图片"}
            <select
              multiple={refs > 1}
              value={refs > 1 ? ref : (ref[0] ?? "")}
              onChange={(e) => {
                setRef(
                  [...e.target.selectedOptions]
                    .map((o) => o.value)
                    .filter(Boolean),
                );
                setPending(null);
              }}
            >
              {refs === 1 && <option value="">未选择</option>}
              {assets
                .filter((a) => a.kind === "ref" || a.mime?.startsWith("image/"))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
            </select>
          </label>
        )}
      </fieldset>
      {recovery && <p role="status">确认上次试用可找回同一请求的回执。</p>}
      {error && <p role="alert">{error}</p>}
      <div className="access-actions">
        <button
          className="ledger-button"
          disabled={!prompt.trim() || !!recovery}
          onClick={() => run(quote)}
        >
          查看试用报价
        </button>
        {pending && (
          <>
            <strong>最高 {pending.quote.max_charge} 积分</strong>
            <button
              className="ledger-button ledger-primary"
              onClick={() => run(submit)}
            >
              {recovery ? "确认上次试用" : "确认扣费并试用"}
            </button>
          </>
        )}
      </div>
      {receipt && <p role="status">{receipt}</p>}
    </div>
  );
}
export function PublicationCard({
  model,
  view,
  state,
  request,
  run,
  reload,
  publish,
  startPricing,
}: {
  model: ModelPublication;
  view: ModelAccessView;
  state: StudioState;
  request: AdminRequest;
  run: RunAccess;
  reload: () => Promise<void>;
  publish: (items: PublicationItem[]) => Promise<void>;
  startPricing: boolean;
}) {
  const [pricing, setPricing] = useState(startPricing);
  const [rates, setRates] = useState(() => ratesOf(model.price));
  const [priceVersion, setPriceVersion] = useState(model.revision);
  const [switchTo, setSwitchTo] = useState<{
    route: Route;
    revision: number;
  } | null>(null);
  const [trial, setTrial] = useState("");
  const active = model.routes.find(
    (r) => r.route_revision_id === model.route_revision_id,
  )!;
  const name = (r: Route) =>
    view.connections.find((c) => c.id === r.connection_id)?.name ??
    r.upstream_id;
  async function savePrice() {
    let price: PublishedPrice;
    if (model.price.kind === "chat") {
      const p = chatRates(rates);
      if (!p.input || !p.output) throw Error("请填写普通输入和输出售价");
      price = {
        kind: "chat",
        input: p.input,
        output: p.output,
        cache_read: p.cache_read ?? null,
        cache_write: p.cache_write ?? null,
      };
    } else {
      if (!rates.unit?.trim()) throw Error("请填写单位售价");
      price = { kind: model.price.kind, unit: rates.unit.trim() };
    }
    await publish([
      {
        action: "price",
        catalog_id: model.catalog_id,
        expected_revision: priceVersion,
        price,
      },
    ]);
    setPricing(false);
    await reload();
  }
  const groups = groupRoutes(model.routes, model.route_revision_id);
  const routes = groups.flatMap(({ active, latest }) =>
    active && active !== latest ? [active, latest] : [latest],
  );
  return (
    <article className="ledger-card" id={"access-" + model.catalog_id}>
      <header className="access-card-head">
        <div>
          <h3>{model.label}</h3>
          <small>
            {purposes[model.price.kind]} · {model.catalog_id}
          </small>
        </div>
        <button
          className="ledger-button"
          onClick={() => {
            setRates(ratesOf(model.price));
            setPriceVersion(model.revision);
            setPricing(!pricing);
          }}
        >
          {pricing ? "收起售价" : "编辑售价"}
        </button>
      </header>
      <p>{priceText(model.price)}</p>
      {pricing && (
        <div className="access-price">
          <PriceFields
            kind={model.price.kind}
            rates={rates}
            change={(p) => setRates({ ...rates, ...p })}
          />
          <button
            className="ledger-button ledger-primary"
            onClick={() => run(savePrice)}
          >
            保存公开售价
          </button>
        </div>
      )}
      <p>
        <strong>当前线路</strong>　{name(active)} · {active.upstream_id}
      </p>
      <details open={startPricing || undefined}>
        <summary>管理线路（{groups.length}）</summary>
        {routes.map((r) => (
          <div className="access-route" key={r.route_revision_id}>
            <strong>
              {r === active
                ? "当前线路"
                : r.draft_id === active.draft_id
                  ? "待切换的新版本"
                  : "备用线路"}{" "}
              · {name(r)}
            </strong>
            <span>
              {r.upstream_id} · 线路版本 {r.draft_revision}
              {!r.enabled && " · 已停接新单"}
            </span>
            <small>{capabilities(r)}</small>
            <p>
              目录记录 ·{" "}
              {r.directory
                ? Object.entries(r.directory.directories)
                    .map(
                      ([path, status]) => path + " " + directoryLabels[status],
                    )
                    .join("、") +
                  " · " +
                  new Date(r.directory.checked_at).toLocaleString()
                : "本修订尚未读取目录"}
            </p>
            <p>
              最近生成 ·{" "}
              {r.health
                ? `${stateNames[r.health.state] ?? r.health.state}　${new Date(r.health.at).toLocaleString()}`
                : "本修订尚无生成结果"}
            </p>
            {!!r.health?.missing_usage && (
              <small>
                用量缺失或异常 {r.health.missing_usage} 次 · 最近{" "}
                {new Date(r.health.last_missing_usage!).toLocaleString()}
              </small>
            )}
            <div className="access-actions">
              <button
                className="ledger-button"
                disabled={!r.enabled}
                onClick={() =>
                  setTrial(
                    trial === r.route_revision_id ? "" : r.route_revision_id,
                  )
                }
              >
                试用此线路
              </button>
              {r !== active && (
                <button
                  className="ledger-button"
                  disabled={!r.enabled}
                  onClick={() =>
                    setSwitchTo({ route: r, revision: model.revision })
                  }
                >
                  切为当前线路
                </button>
              )}
            </div>
            {trial === r.route_revision_id && (
              <Trial
                key={r.route_revision_id}
                model={model}
                route={r}
                state={state}
                request={request}
                run={run}
                reload={reload}
              />
            )}
            {switchTo?.route === r && (
              <div className="access-switch">
                <strong>
                  确认新请求使用 {name(r)}（线路版本 {r.draft_revision}）
                </strong>
                <p>原线路能力 · {capabilities(active)}</p>
                <p>新线路能力 · {capabilities(r)}</p>
                <p>公开售价 · {priceText(model.price)}</p>
                <div className="access-actions">
                  <button
                    className="ledger-button"
                    onClick={() => setSwitchTo(null)}
                  >
                    取消
                  </button>
                  <button
                    className="ledger-button ledger-primary"
                    onClick={() =>
                      run(async () => {
                        await publish([
                          {
                            action: "activate",
                            catalog_id: model.catalog_id,
                            expected_revision: switchTo.revision,
                            route_revision_id: r.route_revision_id,
                          },
                        ]);
                        setSwitchTo(null);
                        await reload();
                      })
                    }
                  >
                    确认切换线路
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </details>
    </article>
  );
}
