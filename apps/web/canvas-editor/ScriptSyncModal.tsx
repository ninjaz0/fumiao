import { useMemo, useState } from "react";
import {
  Check,
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Layers,
  Sparkles,
  User,
  X,
} from "lucide-react";
import {
  detectAmbiguousShotMatches,
  directorSyncPreview,
  nodeHasOutputOrActiveRun,
  type DirectorSyncOptions,
  type ScriptAnchorLink,
  type ScriptBreakdown,
  type ScriptSyncOptions,
  type ScriptSyncDestination,
} from "./script-fusion";
import type { CanvasGenerationMode, Doc, Job } from "./types";

const directorFieldLabels: Record<string, string> = {
  title: "标题", prompt: "镜头说明", narration: "旁白", seconds: "时长",
  dialogues: "对白", shot_size: "景别", camera_angle: "机位", camera_movement: "运镜",
  lighting: "光影", lens: "镜头", mood: "情绪",
};

function formatDirectorField(field: string, value: string): string {
  if (field !== "dialogues") return value || "空";
  const lines = JSON.parse(value) as [string, string][];
  return lines.map(([speaker, text]) => `${speaker}：${text}`).join(" / ") || "空";
}

export function ScriptSyncModal({
  canvasDoc,
  runs = [],
  runsKnown = true,
  breakdown,
  existingLinks,
  defaultVideoModel,
  defaultImageModel,
  director = false,
  onOpenAssistant,
  onSync,
  onClose,
}: {
  canvasDoc: Doc;
  runs?: Job[];
  runsKnown?: boolean;
  breakdown: ScriptBreakdown;
  existingLinks: Record<string, ScriptAnchorLink>;
  defaultVideoModel: string;
  defaultImageModel: string;
  director?: boolean;
  onOpenAssistant: () => void;
  onSync: (
    options: ScriptSyncOptions,
    destination: ScriptSyncDestination,
    directorOptions?: Omit<DirectorSyncOptions, "scriptRevision">,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [includeAssets, setIncludeAssets] = useState(true);
  const [generationMode, setGenerationMode] =
    useState<CanvasGenerationMode>("omni_ref");
  const [gridLayout, setGridLayout] = useState<"2x2" | "3x3">("3x3");
  const [tailChain, setTailChain] = useState(true);
  const [ratio, setRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [bindings, setBindings] = useState<NonNullable<DirectorSyncOptions["bindings"]>>({});
  const [choices, setChoices] = useState<NonNullable<DirectorSyncOptions["choices"]>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const directorRows = useMemo(
    () => director ? directorSyncPreview(canvasDoc, breakdown, { runs, runsKnown, bindings }) : [],
    [director, canvasDoc, breakdown, runs, runsKnown, bindings],
  );
  const previous = canvasDoc.director?.script_id === breakdown.docId ? canvasDoc.director : undefined;
  const [selectedAnchors, setSelectedAnchors] = useState<Set<string>>(() => new Set(
    director
      ? directorRows.filter((row) => !row.unresolved && (!row.nodeId || !previous || previous.shot_ids.includes(row.nodeId))).map((row) => row.anchor)
      : breakdown.shots.map((shot) => shot.anchor),
  ));
  const [requestedOrder, setRequestedOrder] = useState<string[] | null>(null);
  const defaultOrder = useMemo(() => {
    const anchors = new Map(directorRows.flatMap((row) => row.nodeId ? [[row.nodeId, row.anchor]] : []));
    return [...new Set([...(canvasDoc.shots ?? []).flatMap((id) => anchors.get(id) ?? []), ...breakdown.shots.map((shot) => shot.anchor)])];
  }, [breakdown.shots, canvasDoc.shots, directorRows]);
  const order = requestedOrder ?? defaultOrder;
  // Keyed by existingVideoNodeId -> "__keep_separate__" | targetAnchor
  const [ambiguousDecisions, setAmbiguousDecisions] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ambiguousMediaNodes = useMemo(
    () =>
      director ? [] : detectAmbiguousShotMatches(
        canvasDoc,
        breakdown,
        [...selectedAnchors],
        runs,
        runsKnown,
      ),
    [director, canvasDoc, breakdown, selectedAnchors, runs, runsKnown],
  );

  const hasUnresolvedAmbiguity = useMemo(
    () =>
      ambiguousMediaNodes.some(
        (amb) => !ambiguousDecisions[amb.existingVideoNodeId],
      ),
    [ambiguousMediaNodes, ambiguousDecisions],
  );

  const toggleAnchor = (anchor: string) => {
    setSelectedAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(anchor)) next.delete(anchor);
      else next.add(anchor);
      return next;
    });
  };

  const stats = useMemo(() => {
    let newCount = 0;
    let updateCount = 0;
    let totalSeconds = 0;
    for (const shot of breakdown.shots) {
      if (!selectedAnchors.has(shot.anchor)) continue;
      totalSeconds += shot.seconds;
      if (director ? directorRows.find((row) => row.anchor === shot.anchor)?.nodeId : existingLinks[shot.anchor]) updateCount++;
      else newCount++;
    }
    return { newCount, updateCount, totalSeconds };
  }, [breakdown.shots, director, directorRows, existingLinks, selectedAnchors]);

  const submit = async (destination: ScriptSyncDestination) => {
    if (hasUnresolvedAmbiguity) {
      setError(
        "请先确认上方已出片视频节点的归属方式（选择保留原节点独立或绑定到指定镜号）",
      );
      return;
    }
    const participating = directorRows.filter((row) => selectedAnchors.has(row.anchor));
    if (participating.some((row) => row.unresolved)) {
      setError("请先确认本集镜头的归属。");
      return;
    }
    if (participating.some((row) => row.missingBaseline.some((field) =>
      !choices[row.anchor]?.[field] && !(field === "prompt" && Object.hasOwn(prompts, row.anchor)),
    ))) {
      setError("请选择没有同步基线的字段如何处理。");
      return;
    }
    const explicitBindings: Record<string, string> = {};
    for (const [videoNodeId, decision] of Object.entries(ambiguousDecisions)) {
      if (decision && decision !== "__keep_separate__") {
        explicitBindings[decision] = videoNodeId;
      }
    }
    setBusy(true);
    setError("");
    try {
      await onSync(
        {
          includeAssets,
          generationMode,
          gridLayout,
          tailChain,
          ratio,
          videoModel: defaultVideoModel,
          imageModel: defaultImageModel,
          selectedAnchors: [...selectedAnchors],
          explicitNodeBindings: explicitBindings,
        },
        destination,
        director ? { bindings, choices, prompts, order } : undefined,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步画布失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={director ? "确认本集分镜" : "从剧本拆解并同步至画布"}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="fm-script-sync-dialog">
        <header className="fm-script-sync-head">
          <div>
            <h2>
              <Clapperboard size={18} />
              {director ? "确认本集分镜" : "剧本 ↔ 画布智能融合同步"}
            </h2>
            <p>
              {director ? `勾选「${breakdown.docPath}」中纳入本集的镜头，并确认剧本和画布之间的差异。` : `从「${breakdown.docPath}」自动识别角色/场景参考卡与镜头节点链；已生成的视频素材将无损保留。`}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭同步窗口"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="fm-script-sync-controls">
          <label>
            <span>生成链路</span>
            <select
              value={generationMode}
              disabled={busy}
              onChange={(e) =>
                setGenerationMode(e.target.value as CanvasGenerationMode)
              }
            >
              <option value="omni_ref">全能多参考（角色/场景连线引用）</option>
              <option value="first_last_frame">经典首尾帧连贯</option>
              <option value="grid_preview">九宫格/四宫格低成本预览</option>
            </select>
          </label>
          {generationMode === "grid_preview" && (
            <label>
              <span>宫格规格</span>
              <select
                value={gridLayout}
                disabled={busy}
                onChange={(e) =>
                  setGridLayout(e.target.value as "2x2" | "3x3")
                }
              >
                <option value="2x2">2×2 四宫格</option>
                <option value="3x3">3×3 九宫格</option>
              </select>
            </label>
          )}
          <label>
            <span>目标画幅</span>
            <select
              value={ratio}
              disabled={busy}
              onChange={(e) =>
                setRatio(e.target.value as "9:16" | "16:9" | "1:1")
              }
            >
              <option value="9:16">9:16 竖屏短剧</option>
              <option value="16:9">16:9 横屏电影</option>
              <option value="1:1">1:1 方形构图</option>
            </select>
          </label>
          <label className="fm-sync-checkbox">
            <input
              type="checkbox"
              checked={includeAssets}
              disabled={busy}
              onChange={(e) => setIncludeAssets(e.target.checked)}
            />
            <span>{director ? "为新镜头建立角色和场景参考连线" : "同步角色/场景参考图节点并自动连线"} ({breakdown.assets.length})</span>
          </label>
          {!director && <label className="fm-sync-checkbox">
            <input
              type="checkbox"
              checked={tailChain}
              disabled={busy}
              onChange={(e) => setTailChain(e.target.checked)}
            />
            <span>开启跨镜尾帧衔接标记</span>
          </label>}
        </div>

        <div className="fm-script-sync-body">
          {ambiguousMediaNodes.length > 0 && (
            <section className="fm-sync-section" role="region" aria-label="已出片镜头复用确认">
              <h3>已出片镜头复用确认（{ambiguousMediaNodes.length} 项）</h3>
              <p style={{ fontSize: 12.5, color: "var(--cv-muted)", marginBottom: 8 }}>
                检测到场次镜头数量增删且正文已改写。为防止把已有视频误挂到新插入的镜头上，请确认以下已出片节点的对应镜头（留空则保留原节点独立，不覆盖已有视频）：
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ambiguousMediaNodes.map((amb) => {
                  const chosenValue =
                    ambiguousDecisions[amb.existingVideoNodeId] ?? "";
                  return (
                    <label
                      key={amb.existingVideoNodeId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--cv-line)",
                        background: "var(--cv-bg)",
                        fontSize: 12.5,
                      }}
                    >
                      <span>
                        原已出片节点：<strong>{amb.existingTitle}</strong>
                        {amb.previousAnchor ? ` (${amb.previousAnchor})` : ""}
                      </span>
                      <select
                        aria-label={`确认已出片节点 ${amb.existingTitle} 的归属`}
                        value={chosenValue}
                        disabled={busy}
                        onChange={(e) => {
                          const decision = e.target.value;
                          setError("");
                          setAmbiguousDecisions((prev) => {
                            const next = { ...prev };
                            if (decision && decision !== "__keep_separate__") {
                              for (const [vid, val] of Object.entries(next)) {
                                if (val === decision && vid !== amb.existingVideoNodeId) {
                                  delete next[vid];
                                }
                              }
                            }
                            next[amb.existingVideoNodeId] = decision;
                            return next;
                          });
                        }}
                      >
                        <option value="">— 请确认此视频的归属 —</option>
                        <option value="__keep_separate__">
                          保留原视频节点独立（不绑定新镜头）
                        </option>
                        {amb.candidateAnchors.map((anc) => {
                          const shot = breakdown.shots.find(
                            (s) => s.anchor === anc,
                          );
                          return (
                            <option key={anc} value={anc}>
                              绑定到 {shot?.title || anc}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {breakdown.assets.length > 0 && (
            <section className="fm-sync-section">
              <h3>
                <ImageIcon size={15} />
                识别出的资产设定卡（{breakdown.assets.length} 项）
              </h3>
              <div className="fm-sync-asset-grid">
                {breakdown.assets.map((asset) => (
                  <div
                    key={asset.key}
                    className={`fm-sync-asset-card cat-${asset.category}`}
                  >
                    <div className="fm-sync-asset-top">
                      <span className="fm-sync-asset-badge">
                        {asset.category === "character" ? (
                          <User size={12} />
                        ) : (
                          <Layers size={12} />
                        )}
                        {asset.code}
                      </span>
                      <strong>{asset.name}</strong>
                    </div>
                    <p>{asset.description || asset.prompt}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="fm-sync-section">
            <div className="fm-sync-section-head">
              <h3>
                <Film size={15} />
                识别出的场次与镜头段（已选 {selectedAnchors.size} /{" "}
                {breakdown.shots.length} 镜 · 约 {stats.totalSeconds}s）
              </h3>
              {breakdown.shots.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setSelectedAnchors(
                      selectedAnchors.size === breakdown.shots.length
                        ? new Set()
                        : new Set(breakdown.shots.map((s) => s.anchor)),
                    )
                  }
                >
                  {selectedAnchors.size === breakdown.shots.length
                    ? "取消全选"
                    : "全选镜头"}
                </button>
              )}
            </div>

            {breakdown.shots.length === 0 ? (
              <div className="fm-sync-empty">
                当前文档尚未包含可拆解的场次或动作/台词段落。可使用工具栏插入「+ 场次 S01」「+ △动作」或「+ 角色对白」后再同步。
                {director && <div className="fm-director-actions">
                  <button type="button" className="secondary" onClick={onClose}>返回编辑剧本</button>
                  <button type="button" className="secondary" onClick={onOpenAssistant}>打开创作助手</button>
                </div>}
              </div>
            ) : director ? (
              <div className="fm-sync-shot-list">
                {order.map((anchor, index) => {
                  const shot = breakdown.shots.find((item) => item.anchor === anchor);
                  const row = directorRows.find((item) => item.anchor === anchor);
                  if (!shot || !row) return null;
                  const checked = selectedAnchors.has(anchor);
                  const move = (offset: number) => setRequestedOrder((current) => {
                    const next = [...(current ?? order)];
                    [next[index], next[index + offset]] = [next[index + offset], next[index]];
                    return next;
                  });
                  return (
                    <article key={anchor} className={`fm-sync-shot-card fm-director-sync-shot${checked ? " selected" : ""}`}>
                      <div className="fm-sync-shot-title">
                        <label><input type="checkbox" checked={checked} disabled={busy} onChange={() => toggleAnchor(anchor)} /> 纳入本集</label>
                        <strong>{shot.title}</strong>
                        <span className="fm-sync-state">{row.unresolved ? "待确认归属" : row.nodeId ? "已有画布镜头" : "新建镜头"}</span>
                        <button type="button" className="icon-button" aria-label={`上移 ${anchor}`} disabled={busy || index === 0} onClick={() => move(-1)}><ArrowUp size={14} /></button>
                        <button type="button" className="icon-button" aria-label={`下移 ${anchor}`} disabled={busy || index === order.length - 1} onClick={() => move(1)}><ArrowDown size={14} /></button>
                      </div>
                      {row.candidates.length > 0 && <label>
                        正式镜头
                        <select value={bindings[anchor] === null ? "new" : bindings[anchor] ?? ""} disabled={busy} onChange={(event) => {
                          const decision = event.target.value;
                          setBindings((current) => ({ ...current, [anchor]: decision === "new" ? null : decision }));
                          setChoices((current) => ({ ...current, [anchor]: {} }));
                        }}>
                          <option value="">请选择归属</option>
                          <option value="new">新建镜头，保留旧节点</option>
                          {row.candidates.map((node) => <option key={node.id} value={node.id} disabled={Object.entries(bindings).some(([other, id]) => other !== anchor && id === node.id)}>
                            {node.title} · {nodeHasOutputOrActiveRun(node, runs) ? "有成片或任务" : "无成片"} · {node.id.slice(-8)}
                          </option>)}
                        </select>
                      </label>}
                      {[...row.changes.takeScript, ...row.changes.preserve, ...row.changes.conflicts].map((field) => {
                        const conflict = row.changes.conflicts.includes(field);
                        const required = row.missingBaseline.includes(field);
                        return (
                          <div key={field} className="fm-director-sync-diff">
                            <strong>{directorFieldLabels[field]}</strong>
                            <span>剧本 · {formatDirectorField(field, row.incoming[field])}</span>
                            <span>画布 · {formatDirectorField(field, row.current[field])}</span>
                            {conflict ? (
                              <select aria-label={`${anchor} ${directorFieldLabels[field]}处理方式`} value={choices[anchor]?.[field] ?? (required ? "" : "preserve")} disabled={busy} onChange={(event) => {
                                const value = event.target.value === "script" ? "script" : "preserve";
                                setChoices((current) => ({ ...current, [anchor]: { ...current[anchor], [field]: value } }));
                              }}>
                                {required && <option value="" disabled>无同步基线，请选择</option>}
                                <option value="preserve">保留画布修改</option>
                                <option value="script">采用剧本内容</option>
                              </select>
                            ) : <small>{row.changes.takeScript.includes(field) ? "采用剧本更新" : "保留画布修改"}</small>}
                          </div>
                        );
                      })}
                      <label>
                        {anchor} 镜头说明
                        <textarea maxLength={12000} rows={2} disabled={busy || !checked || row.unresolved} value={prompts[anchor] ?? (
                          row.nodeId && !row.changes.takeScript.includes("prompt") && choices[anchor]?.prompt !== "script" ? row.current.prompt : shot.prompt
                        )} onChange={(event) => setPrompts((current) => ({ ...current, [anchor]: event.target.value }))} />
                      </label>
                      {Object.hasOwn(prompts, anchor) && <button type="button" className="secondary" disabled={busy} onClick={() => setPrompts((current) => {
                        const next = { ...current };
                        delete next[anchor];
                        return next;
                      })}>撤销说明修改</button>}
                    </article>
                  );
                })}
                {previous?.shot_ids.filter((id) => !directorRows.some((row) => selectedAnchors.has(row.anchor) && row.nodeId === id))
                  .map((id) => canvasDoc.nodes.find((node) => node.id === id && node.extra_params?.script_doc_id === breakdown.docId))
                  .filter((node) => node !== undefined)
                  .map((node) => <p className="fm-sync-empty" key={node.id}>移出本集 · {node.title}（仍可在画布使用）</p>)}
              </div>
            ) : (
              <div className="fm-sync-shot-list">
                {breakdown.shots.map((shot) => {
                  const linked = existingLinks[shot.anchor];
                  const checked = selectedAnchors.has(shot.anchor);
                  return (
                    <label
                      key={shot.anchor}
                      className={
                        "fm-sync-shot-card" + (checked ? " selected" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleAnchor(shot.anchor)}
                      />
                      <div className="fm-sync-shot-main">
                        <div className="fm-sync-shot-title">
                          <span className="fm-sync-anchor">{shot.anchor}</span>
                          <strong>{shot.title}</strong>
                          <span className="fm-sync-meta">{shot.seconds}s</span>
                          {shot.cinematography.shot_size && (
                            <span className="fm-sync-cine">
                              {shot.cinematography.shot_size}
                            </span>
                          )}
                          {shot.cinematography.camera_movement && (
                            <span className="fm-sync-cine">
                              {shot.cinematography.camera_movement}
                            </span>
                          )}
                          <span
                            className={
                              "fm-sync-state " + (linked ? "update" : "create")
                            }
                          >
                            {linked ? "更新已有节点" : "新建镜头链"}
                          </span>
                        </div>
                        <p className="fm-sync-shot-prompt">{shot.prompt}</p>
                        {shot.dialogues.length > 0 && (
                          <div className="fm-sync-dialogues">
                            {shot.dialogues.map((d, i) => (
                              <span key={i}>
                                <b>{d.speaker}：</b>
                                {d.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {error && (
          <p className="fm-sync-error" role="alert">
            {error}
          </p>
        )}

        <footer className="fm-script-sync-foot">
          <span className="fm-number">
            新增 {stats.newCount} 镜 · 增量同步 {stats.updateCount} 镜（不自动触发扣费生成）
          </span>
          <div className="fm-script-sync-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            {!director && <button
              type="button"
              className="secondary"
              disabled={
                busy ||
                (selectedAnchors.size === 0 &&
                  (!includeAssets || breakdown.assets.length === 0))
              }
              onClick={() => void submit("document")}
            >
              <Check size={15} />
              仅同步留在文档
            </button>}
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                (director ? breakdown.shots.length === 0 || (selectedAnchors.size === 0 && !previous) :
                  selectedAnchors.size === 0 && (!includeAssets || breakdown.assets.length === 0))
              }
              onClick={() => void submit(director ? "director" : "canvas")}
            >
              <Sparkles size={15} />
              {busy ? "正在落图…" : director ? "保存并进入导演台" : "一键落图并查看画布"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
