import { useRef, useState } from "react";
import type {
  ModelAccessView,
  ModelConnection,
  ModelDraft,
  ModelPurpose,
  PublicationItem,
  VideoProtocol,
} from "@fumiao/web-compat/model-access.js";
import type { AdminRequest } from "./settings-admin";
import type { StudioState } from "./state";
import {
  CapabilityFields,
  PriceFields,
  VideoFormat,
} from "./ModelAccessFields";
import {
  directoryLabels,
  draftPayload,
  newRow,
  priceText,
  purposes,
  type EditorRow,
  type Rates,
} from "./model-access-editor";

const missingLabels: Record<string, string> = {
  purpose: "用途",
  protocol: "调用格式",
  durations: "可选时长",
  first_frame: "首帧设置",
  upscale_only: "仅支持超分",
  price: "售价",
  output_format: "线路需提供 PNG、JPEG 或 WebP 图片",
};
const changeLabels = {
  added: "新增",
  changed: "有变动",
  missing: "目录已缺失",
  unchanged: "",
};
export type RunAccess = (action: () => Promise<void>) => void;
const base = "/api/admin/model-access";
export function ModelAccessImport({
  initialUpstream,
  view,
  connection,
  state,
  request,
  reload,
  run,
  message,
  publish,
}: {
  initialUpstream: string;
  view: ModelAccessView;
  connection: ModelConnection;
  state: StudioState;
  request: AdminRequest;
  reload: () => Promise<void>;
  run: RunAccess;
  message: (s: string) => void;
  publish: (items: PublicationItem[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>(
    initialUpstream ? [initialUpstream] : [],
  );
  const [edits, setEdits] = useState<Map<string, EditorRow>>(new Map());
  const [manual, setManual] = useState("");
  const [search, setSearch] = useState(initialUpstream);
  const [limit, setLimit] = useState(40);
  const [batchKind, setBatchKind] = useState<ModelPurpose>("video");
  const [batch, setBatch] = useState<Rates>({});
  const [capBatch, setCapBatch] = useState<Partial<EditorRow>>({});
  const [video, setVideo] = useState<VideoProtocol | "">(
    connection.default_video_protocol ?? "",
  );
  const [newKey, setNewKey] = useState("");
  const [newAddress, setNewAddress] = useState(connection.base_url);
  const ids = useRef(new Map<string, string>());
  const knownRevision = useRef(new Map<string, number>());
  const router = connection.base_url === "https://openrouter.ai/api/v1";
  const discovery = view.discoveries.find(
    (d) => d.connection_id === connection.id,
  );
  const candidates = new Map(
    discovery?.candidates.map((x) => [x.upstream_id, x]),
  );
  const drafts = new Map(
    view.drafts
      .filter((d) => d.connection_id === connection.id)
      .map((d) => [d.upstream_id, d]),
  );
  const all = [
    ...new Set([
      ...candidates.keys(),
      ...drafts.keys(),
      ...edits.keys(),
      ...(connection.reused_from?.models ?? []),
    ]),
  ];
  const filtered = all.filter((id) =>
    (id + " " + (candidates.get(id)?.name ?? ""))
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  function get(id: string) {
    const edited = edits.get(id);
    if (edited) return edited;
    const row = newRow(id, candidates.get(id), drafts.get(id));
    if (!row.purpose && connection.reused_from?.models.includes(id))
      row.purpose = "chat";
    return row;
  }
  function edit(id: string, patch: Partial<EditorRow>) {
    setEdits((prev) =>
      new Map(prev).set(id, { ...(prev.get(id) ?? get(id)), ...patch }),
    );
  }
  function restoreDraft(id: string) {
    knownRevision.current.delete(id);
    setEdits((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }
  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function bulk(allKinds: boolean, patch: Partial<EditorRow>) {
    const next = new Map(edits);
    for (const id of selected) {
      const r = get(id);
      if (allKinds || r.purpose === batchKind) next.set(id, { ...r, ...patch });
    }
    setEdits(next);
  }
  function append() {
    const entries = [...new Set(manual.split(/[\s,，]+/).filter(Boolean))];
    if (!entries.length) return;
    const next = new Map(edits);
    for (const id of entries) next.set(id, get(id));
    setEdits(next);
    setSelected((prev) => [...new Set([...prev, ...entries])]);
    setManual("");
    setSearch("");
  }
  async function save(doPublish: boolean) {
    if (selected.length > 256) throw Error("每次最多处理 256 个模型");
    let conn = connection;
    if (
      !router &&
      selected.some((id) => get(id).purpose === "video") &&
      video !== (conn.default_video_protocol ?? "")
    ) {
      conn = (await request(
        base + "/connections/" + conn.id,
        {
          expected_revision: conn.revision,
          default_video_protocol: video || null,
        },
        "PATCH",
      )) as ModelConnection;
    }
    const items: PublicationItem[] = [];
    let pending = 0;
    try {
      for (const id of selected) {
        const row = get(id);
        const draftId = row.id ?? ids.current.get(id) ?? crypto.randomUUID();
        ids.current.set(id, draftId);
        const body = draftPayload(
          { ...row, revision: knownRevision.current.get(id) ?? row.revision },
          conn,
          router ? "openrouter-videos" : video,
        );
        const { draft } = (await request(
          base + "/drafts/" + draftId,
          body,
          "PUT",
        )) as { draft: ModelDraft };
        knownRevision.current.set(id, draft.revision);
        edit(id, { id: draft.id, revision: draft.revision });
        if (!doPublish) continue;
        const target = view.publications.find(
          (p) => p.catalog_id === row.target,
        );
        if (
          row.target &&
          !["draft", "adopt"].includes(row.target) &&
          (!target || target.price.kind !== row.purpose)
        )
          throw Error("关联目标已更新，请重新选择公开模型");
        const legacy =
          row.target === "adopt" && connection.reused_from?.models.includes(id);
        if (
          draft.missing.some((key) => key !== "price" || !target) ||
          row.target === "draft"
        ) {
          pending++;
          continue;
        }
        const item = { draft_id: draft.id, draft_revision: draft.revision };
        if (target)
          items.push({
            ...item,
            action: "standby",
            catalog_id: target.catalog_id,
            expected_revision: target.revision,
          });
        else if (legacy)
          items.push({
            ...item,
            action: "activate",
            catalog_id: id,
            expected_revision: 0,
          });
        else if (connection.reused_from?.models.includes(id) && !row.target) {
          pending++;
          continue;
        } else if (
          view.publications.some((p) =>
            p.routes.some((r) => r.draft_id === draftId),
          )
        ) {
          pending++;
          continue;
        } else
          items.push({
            ...item,
            action: "create",
            label: body.publication?.label,
          });
      }
      if (items.length) await publish(items);
      message(
        doPublish
          ? `已发布或关联 ${items.length} 项，${pending} 项保留草稿`
          : `已保存 ${selected.length} 份草稿`,
      );
      if (doPublish && items.length)
        setSelected((prev) =>
          prev.filter(
            (id) =>
              !items.some(
                (item) =>
                  "draft_id" in item && item.draft_id === ids.current.get(id),
              ),
          ),
        );
    } finally {
      await reload();
    }
  }
  const chosen = selected.map(get);
  return (
    <section className="access-import">
      <header>
        <h3>{connection.name}</h3>
        <p className="console-description">
          目录地址 <code>{connection.directory_url}</code>
        </p>
      </header>
      {connection.reused_from && (
        <p>
          已复用兼容对话连接。凭据授权范围为{" "}
          {connection.credential_scope.upstream_ids?.join("、") ??
            "本连接已授权的模型"}
          。勾选原模型后可确认新售价并接管。
        </p>
      )}
      <div className="access-actions">
        <button
          className="ledger-button"
          onClick={() =>
            run(async () => {
              await request(
                base + "/connections/" + connection.id + "/discover",
                { expected_revision: connection.revision },
              );
              await reload();
            })
          }
        >
          读取模型目录
        </button>
        {discovery && (
          <span>{new Date(discovery.checked_at).toLocaleString()}</span>
        )}
      </div>
      {discovery &&
        Object.entries(discovery.directories).map(([path, status]) => (
          <p key={path} role="status">
            {path} · {directoryLabels[status]}
          </p>
        ))}
      <details>
        <summary>管理连接和密钥</summary>
        <div className="access-fields">
          <label>
            API 根地址
            <input
              type="url"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
            />
          </label>
          <label>
            新密钥
            <input
              type="password"
              autoComplete="new-password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
          </label>
        </div>
        <button
          className="ledger-button"
          disabled={!newKey}
          onClick={() =>
            run(async () => {
              await request(
                base + "/connections/" + connection.id,
                {
                  api_key: newKey,
                  base_url: newAddress.trim(),
                  expected_revision: connection.revision,
                },
                "PATCH",
              );
              setNewKey("");
              await reload();
              message("密钥已更新，重新读取目录后可应用到新线路");
            })
          }
        >
          保存连接设置
        </button>
        <button
          className="ledger-button"
          onClick={() =>
            run(async () => {
              await request(
                base + "/connections/" + connection.id,
                {
                  enabled: !connection.enabled,
                  expected_revision: connection.revision,
                },
                "PATCH",
              );
              await reload();
            })
          }
        >
          {connection.enabled ? "停止接新单" : "恢复接单"}
        </button>
      </details>
      <div className="access-fields">
        <label>
          搜索模型
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(40);
            }}
            placeholder="名称或上游模型 ID"
          />
        </label>
        <label>
          手动补录模型 ID
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="多个 ID 用空格或逗号分隔"
          />
        </label>
        <button
          className="ledger-button"
          onClick={append}
          disabled={!manual.trim()}
        >
          添加到所选
        </button>
      </div>
      <div className="access-actions">
        <label>
          <input
            type="checkbox"
            checked={
              !!filtered.length && filtered.every((id) => selected.includes(id))
            }
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...new Set([...selected, ...filtered])]
                  : selected.filter((id) => !filtered.includes(id)),
              )
            }
          />
          全选搜索结果（{filtered.length}）
        </label>
        <span>已选 {selected.length} 个</span>
      </div>
      <div className="access-list">
        {filtered.slice(0, limit).map((id) => {
          const c = candidates.get(id),
            d = drafts.get(id);
          return (
            <label className="access-candidate" key={id}>
              <input
                type="checkbox"
                checked={selected.includes(id)}
                onChange={() => toggle(id)}
              />
              <span>
                <strong>{c?.name ?? id}</strong>
                {c?.name !== id && <small>{id}</small>}
              </span>
              <span>
                {get(id).purpose
                  ? purposes[get(id).purpose as ModelPurpose]
                  : "待选用途"}{" "}
                ·{" "}
                {[
                  c ? changeLabels[c.change] || "目录模型" : "手动补录",
                  c?.metadata_status === "stale" ? "上次读取" : "",
                  d ? "已存草稿" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </label>
          );
        })}
      </div>
      {filtered.length > limit && (
        <button
          className="ledger-button"
          onClick={() => setLimit((l) => l + 40)}
        >
          显示更多
        </button>
      )}
      {!!selected.length && (
        <>
          <h3>所选模型</h3>
          <div className="ledger-card">
            <div className="access-fields">
              <label>
                批量设置的用途
                <select
                  value={batchKind}
                  onChange={(e) => {
                    setBatchKind(e.target.value as ModelPurpose);
                    setBatch({});
                    setCapBatch({});
                  }}
                >
                  {Object.entries(purposes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ledger-button"
                onClick={() => bulk(true, { purpose: batchKind })}
              >
                将所选模型设为{purposes[batchKind]}
              </button>
            </div>
            <PriceFields
              kind={batchKind}
              rates={batch}
              change={(p) => setBatch({ ...batch, ...p })}
            />
            <button
              className="ledger-button"
              onClick={() => bulk(false, batch)}
            >
              应用到所选{purposes[batchKind]}模型的售价
            </button>
            <details>
              <summary>批量补充{purposes[batchKind]}能力</summary>
              <CapabilityFields
                row={{ ...capBatch, purpose: batchKind, upstream: "" }}
                hideProtocol
                change={(p) => setCapBatch({ ...capBatch, ...p })}
                router={router}
              />
              <button
                className="ledger-button"
                onClick={() => bulk(false, capBatch)}
              >
                应用能力设置
              </button>
            </details>
          </div>
          {chosen.some((r) => r.purpose === "video") && !router && (
            <VideoFormat
              label="连接默认视频格式"
              value={video}
              placeholder="请选择，或保留草稿"
              onChange={setVideo}
            />
          )}
          {chosen.map((row) => {
            const id = row.upstream,
              c = candidates.get(id),
              draft = drafts.get(id);
            const alternatives = view.publications.filter(
              (p) => p.price.kind === row.purpose,
            );
            const same = alternatives.filter((p) =>
              p.routes.some((r) => r.upstream_id === id),
            );
            const old =
              connection.reused_from?.models.includes(id) &&
              !view.publications.some((p) => p.catalog_id === id);
            const target = alternatives.find(
              (p) => p.catalog_id === row.target,
            );
            return (
              <section
                className="ledger-card"
                key={id}
                aria-label={id + " 设置"}
              >
                <h4>{id}</h4>
                <div className="access-fields">
                  <label>
                    模型用途
                    <select
                      value={row.purpose}
                      onChange={(e) =>
                        edit(id, {
                          purpose: e.target.value as ModelPurpose,
                          target: "",
                          protocol: "",
                        })
                      }
                    >
                      <option value="">待确认</option>
                      {Object.entries(purposes).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    上架方式
                    <select
                      value={row.target ?? ""}
                      onChange={(e) => edit(id, { target: e.target.value })}
                    >
                      <option value="">
                        {old ? "请选择接管方式" : "新建公开模型"}
                      </option>
                      {row.target &&
                        !["adopt", "draft"].includes(row.target) &&
                        !alternatives.some(
                          (p) => p.catalog_id === row.target,
                        ) && (
                          <option value={row.target}>
                            原目标不可用 · {row.target}
                          </option>
                        )}
                      {old && <option value="adopt">按新售价接管原模型</option>}
                      {alternatives.map((p) => (
                        <option key={p.catalog_id} value={p.catalog_id}>
                          关联为备用 · {p.label}（{p.catalog_id}）
                        </option>
                      ))}
                      <option value="draft">仅保存草稿</option>
                    </select>
                  </label>
                  {!target && !old && (
                    <label>
                      公开名称
                      <input
                        maxLength={128}
                        value={row.label ?? id}
                        onChange={(e) => edit(id, { label: e.target.value })}
                      />
                    </label>
                  )}
                </div>
                {same.length > 0 && !target && (
                  <p>已有同名上游模型的线路，可在「上架方式」中关联为备用。</p>
                )}
                {old && (
                  <p>
                    原固定价{" "}
                    {state.pricing.items.find(
                      (p) => p.model === id && p.kind === "chat",
                    )?.amount ?? "未定价"}{" "}
                    积分 / 回复。选择接管后，已有对话的下一轮使用新 Token 售价。
                  </p>
                )}
                {target ? (
                  <p>沿用公开售价 · {priceText(target.price)}</p>
                ) : (
                  row.purpose && (
                    <PriceFields
                      kind={row.purpose}
                      rates={row}
                      change={(p) => edit(id, p)}
                    />
                  )
                )}
                {row.purpose === "video" && !router && (
                  <VideoFormat
                    label="本模型视频格式"
                    placeholder="沿用连接默认格式"
                    value={row.protocol ?? ""}
                    onChange={(protocol) => edit(id, { protocol })}
                  />
                )}
                <details>
                  <summary>线路能力与参数</summary>
                  <CapabilityFields
                    row={row}
                    candidate={c}
                    change={(p) => edit(id, p)}
                    router={router}
                    hideProtocol
                  />
                </details>
                {draft && (row.revision ?? 0) !== draft.revision && (
                  <button
                    className="ledger-button"
                    onClick={() => restoreDraft(id)}
                  >
                    重新载入服务端草稿
                  </button>
                )}
                {draft?.missing.length ? (
                  <small>
                    待补充 ·{" "}
                    {draft.missing.map((k) => missingLabels[k] ?? k).join("、")}
                  </small>
                ) : null}
              </section>
            );
          })}
          <div className="access-actions">
            <button
              className="ledger-button"
              onClick={() => run(() => save(false))}
            >
              保存草稿
            </button>
            <button
              className="ledger-button ledger-primary"
              onClick={() => run(() => save(true))}
            >
              确认上架所选模型
            </button>
          </div>
        </>
      )}
    </section>
  );
}
