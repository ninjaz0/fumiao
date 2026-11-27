import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Crosshair, ListVideo, Plus, X } from "lucide-react";
import { canvasTailSourceId, directorAudioTargets, directorBasis, directorShotIds, type DirectorAudioInputs, type DirectorShotInputs, type DirectorTarget } from "@fumiao/web-compat/director.js";
import { directorGenerationTargets } from "./director-batch";
import { scriptApi, type ScriptDocumentDetail } from "./script-api";
import {
  directorShotDescription,
  directorSyncPreview,
  parseScriptBreakdown,
  reorderDirectorShots,
  scriptSourceJump,
} from "./script-fusion";
import type { Pack } from "./AssetPacks";
import { linkedValue, type CanvasEdge, type Doc, type Job } from "./types";

type DirectorDeskProps = {
  document: Doc;
  active: boolean;
  canvasSaved: boolean;
  revision: number;
  runs: Job[];
  packs: Pack[];
  activeShotId: string | null;
  onSelectShot: (nodeId: string) => void;
  onChooseScript: () => void;
  onEditSource: (request: NonNullable<ReturnType<typeof scriptSourceJump>>) => void;
  onUpdateScript: (docId: string) => void;
  onFocusCanvas: (nodeId: string) => void;
  onChangeDocument: (updater: (current: Doc) => Doc) => void;
  onConfirmOrder: () => Promise<void>;
  onReadInputs: (nodeId: string) => Promise<DirectorShotInputs>;
  onConfirmShot: (nodeId: string, field: "story_basis" | "material_basis", basis: string) => Promise<void>;
  onChooseImage: (nodeId: string | null, shotId: string | null) => void;
  onPinImage: (edge: CanvasEdge, media: string) => void;
  onAddImage: (shotId: string) => void;
  onPrecheckImage: (nodeId: string) => Promise<void>;
  onPrecheck: (targets: DirectorTarget[], title: string) => Promise<void>;
  hasPendingBatch: boolean;
  onRecoverBatch: () => void;
  onChoosePack: (nodeId: string) => void;
  onFixTailFrame: (sourceId: string, nodeId: string) => Promise<void>;
};

export function DirectorDesk({
  document,
  active,
  canvasSaved,
  revision,
  runs,
  packs,
  activeShotId,
  onSelectShot,
  onChooseScript,
  onEditSource,
  onUpdateScript,
  onFocusCanvas,
  onChangeDocument,
  onConfirmOrder,
  onReadInputs,
  onConfirmShot,
  onChooseImage,
  onPinImage,
  onAddImage,
  onPrecheckImage,
  onPrecheck,
  hasPendingBatch,
  onRecoverBatch,
  onChoosePack,
  onFixTailFrame,
}: DirectorDeskProps) {
  const production = document.director;
  const order = production ? directorShotIds(document.shots ?? [], production) : [];
  const videoNodes = document.nodes.filter((node) => node.type === "video");
  const node = videoNodes.find((item) => item.id === activeShotId && order.includes(item.id))
    ?? videoNodes.find((item) => item.id === order[0]);
  const source = node && scriptSourceJump(node);
  const sourceId = source?.docId ?? production?.script_id;
  const [loadedSource, setLoadedSource] = useState<ScriptDocumentDetail>();
  const [sourceErrorId, setSourceErrorId] = useState<string>();
  const [manualId, setManualId] = useState("");
  const [selectedShots, setSelectedShots] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState<string>();
  const [inputState, setInputState] = useState<{ nodeId: string; revision: number; value?: DirectorShotInputs; error?: string }>();
  const orderKey = JSON.stringify(order);
  const nodeId = node?.id;
  const inspected = canvasSaved && inputState?.nodeId === nodeId && inputState?.revision === revision ? inputState : undefined;
  const inputs = inspected?.value;

  useEffect(() => {
    if (!active || !canvasSaved || !nodeId) return;
    let current = true;
    let reading = false;
    const read = async () => {
      if (reading || globalThis.document.hidden) return;
      reading = true;
      try {
        const value = await onReadInputs(nodeId);
        if (current) setInputState(value.revision === revision
          ? { nodeId, revision, value }
          : { nodeId, revision, error: "画布已有新版本，请重新载入。" });
      } catch (cause) {
        if (current) setInputState({ nodeId, revision, error: (cause as Error).message });
      } finally {
        reading = false;
      }
    };
    const refresh = () => void read();
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [active, canvasSaved, nodeId, onReadInputs, revision]);

  useEffect(() => {
    if (!active || !sourceId) return;
    let current = true;
    void scriptApi.get(sourceId).then((detail) => {
      if (!current) return;
      setLoadedSource(detail);
      setSourceErrorId(undefined);
    }).catch(() => {
      if (current) setSourceErrorId(sourceId);
    });
    return () => { current = false; };
  }, [active, sourceId, production?.script_revision]);

  useEffect(() => {
    let current = true;
    void directorBasis(JSON.parse(orderKey)).then((basis) => {
      if (current) setConfirmedOrder(basis);
    });
    return () => { current = false; };
  }, [orderKey]);

  const excerptScript = sourceId === loadedSource?.id ? loadedSource : undefined;
  const breakdown = useMemo(
    () => excerptScript && parseScriptBreakdown(excerptScript.body_md, {
      docId: excerptScript.id,
      docPath: excerptScript.path,
    }),
    [excerptScript],
  );
  const excerpt = (source?.shotId && breakdown?.shots.find((shot) => shot.shotId === source.shotId))
    || breakdown?.shots.find((shot) => shot.anchor === source?.anchor);
  const preview = useMemo(
    () => breakdown ? directorSyncPreview(document, breakdown) : [],
    [document, breakdown],
  );
  const shotDiff = preview.find((row) => row.nodeId === node?.id && row.anchor === excerpt?.anchor);

  const changeOrder = (offset: number) => {
    if (!node) return;
    setError("");
    onChangeDocument((current) => {
      if (!current.director) return current;
      const next = directorShotIds(current.shots ?? [], current.director);
      const old = next.indexOf(node.id);
      const target = old + offset;
      if (old < 0 || target < 0 || target >= next.length) return current;
      [next[old], next[target]] = [next[target], next[old]];
      return {
        ...current,
        shots: reorderDirectorShots(current.shots ?? [], next),
        director: { ...current.director, order_basis: undefined },
      };
    });
  };
  const changeMembership = (id: string, include: boolean) => {
    setError("");
    try {
      onChangeDocument((current) => {
        const state = current.director;
        if (!state || !current.nodes.some((item) => item.id === id && item.type === "video") ||
          state.shot_ids.includes(id) === include) return current;
        const shots = current.shots ?? [];
        if (include && shots.length >= 200 && !shots.includes(id)) throw new Error("全画布镜头列表已达上限。");
        return {
          ...current,
          shots: include && !shots.includes(id) ? [...shots, id] : shots,
          director: {
            ...state,
            shot_ids: include ? [...state.shot_ids, id] : state.shot_ids.filter((item) => item !== id),
            shots: state.shots?.filter((item) => item.node_id !== id),
            order_basis: undefined,
          },
        };
      });
      if (include) {
        onSelectShot(id);
        setManualId("");
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const apply = async (action: () => void | Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  };

  const activeIndex = order.indexOf(node?.id ?? "");
  const orderConfirmed = canvasSaved && Boolean(production?.order_basis && production.order_basis === confirmedOrder);
  const savedState = production?.shots?.find((shot) => shot.node_id === nodeId);
  const storyConfirmed = Boolean(inputs?.story_basis && inputs.story_basis === savedState?.story_basis);
  const materialConfirmed = Boolean(inputs?.material_basis && inputs.material_basis === savedState?.material_basis);
  const selectedIds = order.filter((id) => selectedShots.includes(id));
  const selected = (selectedIds.length ? selectedIds : node ? [node.id] : [])
    .map((id) => videoNodes.find((item) => item.id === id))
    .filter((shot) => shot !== undefined);
  // The current shot also has a live inspection. Other selected shots are
  // validated against their current input in the server's per-item precheck.
  const eligible = selected.filter((shot) => {
    if (shot.id === nodeId) return storyConfirmed && materialConfirmed;
    const confirmation = production?.shots?.find((item) => item.node_id === shot.id);
    return Boolean(confirmation?.story_basis && confirmation.material_basis);
  });
  const videoTargets = directorGenerationTargets(eligible, runs, "video");
  const audioShots = eligible.filter((shot) => directorAudioTargets(shot).length);
  const audioTargets = directorGenerationTargets(audioShots, runs, "audio", inputs?.audio_inputs);
  const currentDialogueTargets = node
    ? directorGenerationTargets([node], runs, "audio", inputs?.audio_inputs).filter(({ stage }) => stage === "dialogue")
    : [];
  const precheckAudio = async (only?: DirectorTarget) => {
    const shots = only && node?.id === only.node_id ? [node] : audioShots;
    const checked = await Promise.all(shots.map((shot) => onReadInputs(shot.id)));
    if (checked.some((item) => item.revision !== revision)) throw new Error("画布版本已变更，请重新载入。");
    const styles = Object.assign({}, ...checked.map((item) => item.audio_inputs)) as DirectorAudioInputs;
    const targets = directorGenerationTargets(shots, runs, "audio", styles).filter((target) =>
      !only || (target.node_id === only.node_id && target.stage === only.stage && target.line_id === only.line_id));
    if (!targets.length) throw new Error("所选音频已就绪或正在生成。");
    await onPrecheck(targets, only ? "对白单句预检" : "音频生成预检");
  };
  const tailSource = node?.tail_inherited && videoNodes.find((item) => item.id === canvasTailSourceId(document, node.id));
  const imageRefs = document.edges.flatMap((edge) => {
    if (edge.target !== nodeId) return [];
    const source = document.nodes.find((item) => item.id === edge.source);
    if (!source) return [];
    const { kind, value } = linkedValue(source, edge, runs);
    if (kind !== "image") return [];
    const affected = videoNodes.filter((shot) => order.includes(shot.id) && document.edges.some((item) =>
      item.source === edge.source && item.sourcePort === edge.sourcePort && item.target === shot.id,
    ));
    return [{ edge, source, media: value, affected, fixed: !source.extension && (source.use_media || source.active_job) }];
  });
  const selectedPacks = (node?.asset_packs ?? []).map((binding) => {
    const pack = packs.find((item) => item.id === binding.id);
    const affected = videoNodes.filter((shot) => order.includes(shot.id) && shot.asset_packs?.some((item) => item.id === binding.id));
    const text = inputs?.pack_texts?.find((packText) => packText.id === binding.id)?.text;
    return { binding, pack, affected, text };
  });

  return (
    <section className="fm-director-desk" aria-label="导演台" hidden={!active}>
      <header className="fm-director-header">
        <div>
          <h1>导演台</h1>
          {production && <p>{order.length} 镜 · 剧本同步版本 {production.script_revision}</p>}
          {production && excerptScript?.id === production.script_id && excerptScript.revision > production.script_revision && (
            <p className="fm-director-note">主剧本有新的已保存版本，可更新本集分镜。</p>
          )}
        </div>
        <div className="fm-director-actions">
          {hasPendingBatch && <button type="button" className="secondary" onClick={onRecoverBatch}>恢复上次提交</button>}
          {production && (
            <button type="button" className="secondary" onClick={() => onUpdateScript(production.script_id)}>
              <BookOpen size={14} /> 更新本集分镜
            </button>
          )}
        </div>
      </header>
      {!production ? (
        <div className="fm-director-empty">
          <p>从分集剧本选择镜头，建立本集片单。</p>
          <button type="button" className="primary" onClick={onChooseScript}>选择本集剧本</button>
        </div>
      ) : (
        <div className="fm-director-content">
          <aside className="fm-director-list" aria-label="本集片单">
            <h2><ListVideo size={16} /> 本集片单</h2>
            <ol>
              {order.map((id) => {
                const shot = videoNodes.find((item) => item.id === id);
                return shot && <li key={id}>
                  <input
                    type="checkbox"
                    aria-label={`选择${shot.title}参与批量生成`}
                    checked={selectedIds.includes(id)}
                    onChange={(event) => {
                      const included = event.target.checked;
                      setSelectedShots((ids) => included ? [...ids, id] : ids.filter((item) => item !== id));
                    }}
                  />
                  <button type="button" aria-pressed={shot.id === node?.id} onClick={() => onSelectShot(id)}>
                    <span>{shot.title}</span>
                    <small>{shot.extra_params?.script_doc_id === production.script_id ? "主剧本" : "手动纳入"}</small>
                  </button>
                </li>;
              })}
            </ol>
            <div className="fm-director-actions">
              <button type="button" className="secondary" disabled={pending || activeIndex <= 0} onClick={() => changeOrder(-1)}><ArrowUp size={14} /> 上移</button>
              <button type="button" className="secondary" disabled={pending || activeIndex < 0 || activeIndex === order.length - 1} onClick={() => changeOrder(1)}><ArrowDown size={14} /> 下移</button>
              <button type="button" className="primary" disabled={!order.length || pending || orderConfirmed} onClick={() => void apply(onConfirmOrder)}>
                {pending ? "正在保存" : orderConfirmed ? "顺序已确认" : "保存并确认顺序"}
              </button>
            </div>
            <div className="fm-director-actions fm-director-join">
              <select aria-label="选择画布镜头" value={manualId} onChange={(event) => setManualId(event.target.value)}>
                <option value="">选择画布镜头</option>
                {videoNodes.filter((item) => !order.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <button type="button" className="secondary" disabled={!manualId || pending} onClick={() => changeMembership(manualId, true)}><Plus size={14} /> 纳入本集</button>
            </div>
            {error && <p role="alert" className="fm-sync-error">{error}</p>}
          </aside>
          <main className="fm-director-detail">
            <h2>确认分镜</h2>
            {node ? (
              <>
                <div className="fm-director-shot-head">
                  <h3>{node.title}</h3>
                  <div className="fm-director-actions">
                    <button type="button" className="secondary" onClick={() => onFocusCanvas(node.id)}><Crosshair size={14} /> 定位画布</button>
                    <button type="button" className="secondary" disabled={pending} onClick={() => changeMembership(node.id, false)}><X size={14} /> 移出本集</button>
                  </div>
                </div>
                <section className="fm-director-card">
                  <h4>镜头说明</h4>
                  <p>{(inputs?.description ?? directorShotDescription(document, node)) || "尚未填写镜头说明。"}</p>
                  {shotDiff?.changes.preserve.length ? <p className="fm-director-note">本镜保留了画布修改。</p> : null}
                  {shotDiff && (shotDiff.changes.conflicts.length > 0 || shotDiff.changes.takeScript.length > 0) &&
                    <p className="fm-director-note">剧本与画布有新的差异，可在更新预览中选择采用的内容。</p>}
                  <button type="button" className="secondary" disabled={!inputs?.story_basis || pending || storyConfirmed}
                    onClick={() => inputs?.story_basis && void apply(() => onConfirmShot(node.id, "story_basis", inputs.story_basis!))}>
                    {storyConfirmed ? "分镜已确认" : savedState?.story_basis && inputs ? "分镜已更新，重新确认" : "确认分镜"}
                  </button>
                </section>
                <section className="fm-director-card">
                  <h4>确认素材</h4>
                  {inspected?.error && <p role="alert">{inspected.error}</p>}
                  {!inspected && <p className="fm-director-note">{canvasSaved ? "正在检查生成素材…" : "画布保存后检查生成素材。"}</p>}
                  {node.tail_inherited && <div>
                    <p>自动尾帧来源：{tailSource ? tailSource.title : "没有可用的上一镜"}。关闭自动继承后可确认素材。</p>
                    <div className="fm-director-actions">
                      {tailSource && <button type="button" className="secondary" disabled={pending} onClick={() => void apply(() => onFixTailFrame(tailSource.id, node.id))}>固定尾帧为首帧</button>}
                      <button type="button" className="secondary" disabled={pending} onClick={() => onChangeDocument((current) => ({
                        ...current,
                        nodes: current.nodes.map((item) => item.id === node.id ? { ...item, tail_inherited: false } : item),
                      }))}>关闭自动尾帧</button>
                    </div>
                  </div>}
                  {imageRefs.length > 0 && <ul className="fm-director-materials">
                    {imageRefs.map(({ edge, source, media, fixed, affected }) => <li key={edge.id}>
                      {media && <img src={`/media/${media}?variant=thumb`} alt="" loading="lazy" />}
                      <div>
                        <strong>{source.title}</strong>
                        <small>{media ? fixed ? "已固定" : "待选定" : "缺图"}{affected.length > 1 && ` · 关联镜头 ${affected.map((shot) => shot.title).join("、")}`}</small>
                        <div className="fm-director-actions">
                          {media && !fixed && <button type="button" className="secondary" onClick={() => void apply(() => onPinImage(edge, media))}>固定此图</button>}
                          {!source.extension && <button type="button" className="secondary" onClick={() => onChooseImage(source.id, null)}>{media ? "替换图片" : "选择或上传图片"}</button>}
                          {source.type === "image" && <button type="button" className="secondary" disabled={pending || !orderConfirmed || !storyConfirmed} onClick={() => void apply(() => onPrecheckImage(source.id))}>预检参考图</button>}
                          <button type="button" className="secondary" onClick={() => onFocusCanvas(source.id)}>定位素材节点</button>
                        </div>
                      </div>
                    </li>)}
                  </ul>}
                  {selectedPacks.length > 0 && <ul className="fm-director-materials">
                    {selectedPacks.map(({ binding, pack, affected, text }) => <li key={binding.id}>
                      <div>
                        <strong>{pack?.name || `素材包 ${binding.id.slice(0, 6)}`}</strong>
                        <small>{!pack ? "缺失" : binding.revision !== pack.revision ? `待更新至版本 ${pack.revision}` : `已绑定版本 ${binding.revision}`}{affected.length > 1 && ` · 关联镜头 ${affected.map((shot) => shot.title).join("、")}`}</small>
                        {text && <p>{text}</p>}
                      </div>
                    </li>)}
                  </ul>}
                  {inputs && inputs.references.length > 0 && <div className="fm-director-effective">
                    <p>生成使用的参考素材顺序</p>
                    <ol>
                      {inputs.references.map(({ id, mime, role }) => <li key={`${id}:${role ?? "ref"}`}>
                        {mime.startsWith("image/") ? <img src={`/media/${id}?variant=thumb`} alt="参考图" loading="lazy" /> : <a href={`/media/${id}`} target="_blank" rel="noreferrer">{role === "continuation" ? "续写来源视频" : mime.startsWith("video/") ? "参考视频" : "参考音频"}</a>}
                      </li>)}
                    </ol>
                  </div>}
                  {inputs && !inputs.references.length && !imageRefs.length && !selectedPacks.length && <p className="fm-director-note">本镜未绑定参考图。</p>}
                  {inputs?.voices.map(({ speaker, model, voice, pack_id, rate, pitch, instruction }, index) => (
                    <p key={index}>{[
                      speaker, packs.find((pack) => pack.id === pack_id)?.name, model, voice,
                      rate && `语速 ${rate}`, pitch && `音高 ${pitch}`, instruction,
                    ].filter(Boolean).join(" · ")}</p>
                  ))}
                  {inputs && <ul className="fm-director-issues">
                    {[...new Set([...inputs.visual_issues, ...inputs.material_issues])].map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>}
                  <div className="fm-director-actions">
                    <button type="button" className="secondary" disabled={pending} onClick={() => onChooseImage(null, node.id)}>添加参考图</button>
                    <button type="button" className="secondary" disabled={pending} onClick={() => void apply(() => onAddImage(node.id))}>新建生图节点</button>
                    <button type="button" className="secondary" disabled={pending} onClick={() => onChoosePack(node.id)}>素材包</button>
                    <button type="button" className="primary" disabled={!inputs?.material_basis || pending || materialConfirmed}
                      onClick={() => inputs?.material_basis && void apply(() => onConfirmShot(node.id, "material_basis", inputs.material_basis!))}>
                      {materialConfirmed ? "素材已确认" : savedState?.material_basis && inputs ? "素材已变更，重新确认" : "确认素材"}
                    </button>
                  </div>
                </section>
                <section className="fm-director-card">
                  <h4>预检与生成</h4>
                  {!orderConfirmed && <p>保存并确认本集片单顺序后可预检。</p>}
                  {orderConfirmed && selected.length !== eligible.length && <p>所选镜头中有 {selected.length - eligible.length} 镜待确认分镜或素材。</p>}
                  <div className="fm-director-actions">
                    <button type="button" className="primary" disabled={pending || !orderConfirmed || !videoTargets.length}
                      onClick={() => void apply(() => onPrecheck(videoTargets, "视频生成预检"))}>
                      预检视频{videoTargets.length ? `（${videoTargets.length} 镜）` : ""}
                    </button>
                    <button type="button" className="secondary" disabled={pending || !orderConfirmed || !audioShots.length}
                      onClick={() => void apply(() => precheckAudio())}>
                      预检待生成音频{audioTargets.length ? `（${audioTargets.length} 项）` : ""}
                    </button>
                  </div>
                  {orderConfirmed && storyConfirmed && materialConfirmed && currentDialogueTargets.length > 0 && (
                    <ul className="fm-director-dialogue-targets" aria-label="本镜待生成对白">
                      {currentDialogueTargets.map((target) => {
                        const line = node.dialogue_lines?.find(({ id }) => id === target.line_id);
                        if (!line) return null;
                        const label = [line.speaker, line.text].filter(Boolean).join("：");
                        return (
                          <li key={line.id}>
                            <span>{label}</span>
                            <button type="button" className="secondary" disabled={pending}
                              aria-label={`预检对白 ${label}`} onClick={() => void apply(() => precheckAudio(target))}>
                              预检此句
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                <section className="fm-director-card">
                  <h4>剧本原文</h4>
                  {source ? (
                    <>
                      <p className="fm-director-note">{excerptScript?.path ?? "关联剧本"}{source.anchor && " · " + source.anchor}</p>
                      {excerpt ? <blockquote>
                        {excerpt.action && <p>{excerpt.action}</p>}
                        {excerpt.dialogues.map((line, index) => <p key={index}>{line.speaker}：{line.text}</p>)}
                      </blockquote> : <p>{sourceErrorId === source.docId ? "无法读取关联剧本。" : excerptScript ? "当前剧本中找不到这段原文。" : "正在读取关联剧本…"}</p>}
                      <button type="button" className="secondary" onClick={() => onEditSource(source)}><BookOpen size={14} /> 在文档中编辑</button>
                    </>
                  ) : <p>此镜头由画布纳入，尚无原文关联。</p>}
                </section>
              </>
            ) : <p>本集尚无镜头。可更新剧本分镜，或从画布纳入已有镜头。</p>}
          </main>
        </div>
      )}
    </section>
  );
}
