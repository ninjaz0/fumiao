import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Crosshair, ListVideo, Plus, X } from "lucide-react";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { canvasTailSourceId, directorAdoptionBasis, directorAudioEvidenceMismatch, directorAudioTargets, directorBasis, directorMissingApproval, directorShotIds, directorTargetKey, directorVideoSelection, episodeMaxSeconds, episodeMaxShots, type DirectorAudioInputs, type DirectorShotInputs, type DirectorTarget, type DirectorVideoSelection } from "@fumiao/web-compat/director.js";
import { Composition } from "./Composition";
import { VideoVersions } from "./VideoVersions";
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
import { linkedValue, videoSeconds, type Asset, type CanvasEdge, type CanvasNode, type Doc, type Job } from "./types";

type Inspection = { value?: DirectorShotInputs; error?: string; adoption?: string };
const readyRun = (run?: Job): run is Job & { result: string } => run?.status === "done" && Boolean(run.result);

function adoptedVideo(node: CanvasNode, runs: Job[]) {
  const pin = directorVideoSelection(node);
  if (pin && "media_id" in pin) return { pin, media: pin.media_id, job: runs.find(({ result }) => result === pin.media_id) };
  const job = pin ? runs.find((run) => run.id === pin.job_id && run.kind === "video" && run.canvas_node === node.id) : undefined;
  return { pin, job, media: readyRun(job) ? job.result : null };
}

function episodeShotAudio(node: CanvasNode, runs: Job[], inputs: DirectorShotInputs) {
  let seconds = 0;
  const targets = directorAudioTargets(node);
  for (const target of targets) {
    const line = target.stage === "dialogue" ? node.dialogue_lines?.find(({ id }) => id === target.line_id) : undefined;
    const label = line ? "对白" : "旁白";
    const pending = runs.find(({ id }) => id === (line ? line.audio_pending : node.narration_pending));
    if (pending && ["queued", "running", "processing", "uncertain"].includes(pending.status)) return { seconds, issue: `${label}仍在生成` };
    const voice = runs.find(({ id }) => id === (line ? line.audio_job : node.narration_job));
    if (!readyRun(voice) || voice.kind !== "audio") return { seconds, issue: `${label}尚未就绪` };
    const text = line ? line.text : node.narration_text;
    if (line?.audio_stale?.includes(voice.id) || pythonStrip(voice.prompt) !== pythonStrip(text ?? "") ||
      directorAudioEvidenceMismatch(voice.inputs ?? {}, inputs.audio_inputs[directorTargetKey(target)], voice)) {
      return { seconds, issue: `${label}已变更，请重新生成语音` };
    }
    seconds += voice.actual?.duration || 0;
  }
  return { seconds: seconds + Math.max(0, targets.length - 1) * 0.15, issue: "" };
}

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
  hasLocalScriptEdits: (id: string) => boolean;
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
  onAdoptVideo: (nodeId: string, selection: DirectorVideoSelection, reviewed: string, continuing?: boolean) => Promise<void>;
  onSave: () => Promise<number>;
  project: string;
  account: string;
  assets: Asset[];
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
  hasLocalScriptEdits,
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
  onAdoptVideo,
  onSave,
  project,
  account,
  assets,
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
  const [inputState, setInputState] = useState<{ key: string; revision: number; byNode: Map<string, Inspection> }>();
  const orderKey = JSON.stringify(order);
  const nodeId = node?.id;
  const inspectKey = JSON.stringify(videoNodes.flatMap((shot) => {
    const pin = directorVideoSelection(shot);
    return shot.id === nodeId || (pin && order.length <= episodeMaxShots && order.includes(shot.id))
      ? [{ id: shot.id, pin }] : [];
  }));
  const checked = canvasSaved && inputState?.key === inspectKey && inputState.revision === revision ? inputState.byNode : undefined;
  const inspected = nodeId ? checked?.get(nodeId) : undefined;
  const inputs = inspected?.value;

  useEffect(() => {
    if (!active || !canvasSaved) return;
    const targets: { id: string; pin: DirectorVideoSelection | null }[] = JSON.parse(inspectKey);
    if (!targets.length) return;
    let current = true;
    let reading = false;
    const read = async () => {
      if (reading || globalThis.document.hidden) return;
      reading = true;
      try {
        const results = await Promise.all(targets.map(async ({ id, pin }): Promise<[string, Inspection]> => {
          try {
            const value = await onReadInputs(id);
            if (value.revision !== revision) return [id, { error: "画布已有新版本，请重新载入。" }];
            const adoption = pin && value.adoption_input_basis
              ? await directorAdoptionBasis(value.adoption_input_basis, pin) : undefined;
            return [id, { value, adoption }];
          } catch (cause) {
            return [id, { error: (cause as Error).message }];
          }
        }));
        if (current) setInputState({ key: inspectKey, revision, byNode: new Map(results) });
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
  }, [active, canvasSaved, inspectKey, onReadInputs, revision]);

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
  const adopted = node && adoptedVideo(node, runs);
  const missingApproval = inputs && directorMissingApproval(inputs, savedState);
  const adoptionConfirmed = Boolean(!missingApproval && inspected?.adoption && inspected.adoption === savedState?.adoption_basis);
  const candidates = node ? runs.filter((run) => run.canvas_node === node.id && run.kind === "video" && readyRun(run)) : [];
  const adopt = (selection: DirectorVideoSelection, continuing = false) => {
    if (node && inputs?.adoption_input_basis)
      void apply(() => onAdoptVideo(node.id, selection, inputs.adoption_input_basis!, continuing));
  };
  let episodeIssue = !order.length ? "请先确认本集片单。"
    : order.length > episodeMaxShots ? "本集最多 30 镜，请缩减片单。"
    : !orderConfirmed ? "请保存并确认本集片单顺序。" : "";
  let episodeSeconds = 0;
  if (!episodeIssue) {
    for (const [index, id] of order.entries()) {
      const shot = videoNodes.find((item) => item.id === id)!;
      const video = adoptedVideo(shot, runs);
      const input = checked?.get(id);
      const saved = production?.shots?.find((item) => item.node_id === id);
      let issue = "";
      if (!video.media || !saved?.adoption_basis) issue = "请明确采用视频";
      else if (input?.error) issue = input.error;
      else if (!input?.value) issue = "正在检查镜头依据";
      else {
        const missing = directorMissingApproval(input.value, saved);
        if (missing) issue = `请先确认${missing}`;
        else if (!input.adoption || input.adoption !== saved.adoption_basis) issue = "请重新采用视频或确认沿用已采用视频";
      }
      const audio = input?.value && episodeShotAudio(shot, runs, input.value);
      if (!episodeIssue && (issue || audio?.issue)) episodeIssue = `镜头 ${index + 1} · ${issue || audio?.issue}`;
      const duration = videoSeconds(video.job) || assets.find((asset) => asset.id === video.media)?.seconds || shot.params.seconds;
      const seconds = Math.max(duration, audio ? audio.seconds : 0);
      episodeSeconds += Math.ceil(seconds * 24 - 1e-4) / 24;
    }
    if (episodeSeconds > episodeMaxSeconds) episodeIssue = "预计成片超过 5 分钟，请缩减片单或缩短音轨。";
  }
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
                <section className="fm-director-card fm-director-versions" aria-label="逐镜选版">
                  <h4>逐镜选版</h4>
                  {adopted?.media && <div className="fm-director-approved-video">
                    <p>{adoptionConfirmed ? "本镜视频已采用"
                      : savedState?.adoption_basis && inspected ? "本镜分镜或素材已变更，视频待确认"
                      : inspected ? "正在使用画布选定的视频，请确认用于本集" : "正在核对已采用的视频"}
                      {adopted.job && ` · #${adopted.job.id}`}</p>
                    <video src={`/media/${adopted.media}`} controls playsInline preload="metadata" />
                    {!adoptionConfirmed && adopted.pin && <button type="button" className="secondary"
                      disabled={pending || !inputs?.adoption_input_basis || Boolean(missingApproval)}
                      onClick={() => adopt(adopted.pin!, true)}>确认沿用已采用视频</button>}
                    {missingApproval && <p className="fm-director-note">先确认{missingApproval}，再选择是否沿用。</p>}
                  </div>}
                  {!adopted?.media && !candidates.length && <p>完成的视频候选会显示在这里。</p>}
                  {candidates.length === 1 && candidates[0].id !== adopted?.job?.id && <div className="fm-director-approved-video">
                    <video src={`/media/${candidates[0].result}`} controls playsInline preload="metadata" />
                    <button type="button" className="primary"
                      disabled={pending || !storyConfirmed || !materialConfirmed}
                      onClick={() => adopt({ job_id: candidates[0].id })}>采用此视频</button>
                  </div>}
                  {candidates.length > 1 && <details>
                    <summary>比较视频候选（{candidates.length}）</summary>
                    <VideoVersions key={node.id} runs={candidates}
                      adopted={node.use_media ? null : node.active_job}
                      disabled={pending || !storyConfirmed || !materialConfirmed}
                      onAdopt={(job_id) => adopt({ job_id })} />
                  </details>}
                  {candidates.length > 0 && (!storyConfirmed || !materialConfirmed) &&
                    <p className="fm-director-note">确认当前分镜和素材后可采用候选视频。</p>}
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
            <div className="fm-director-card">
              <Composition
                active={active}
                project={project}
                scope="episode"
                episode={{
                  account,
                  scriptRevision: production.script_revision,
                  hasLocalScriptEdits: () => hasLocalScriptEdits(production.script_id),
                  readScriptRevision: async () => (await scriptApi.get(production.script_id)).revision,
                }}
                getRevision={onSave}
                ready={!episodeIssue}
                waitingReason={episodeIssue}
              />
            </div>
          </main>
        </div>
      )}
    </section>
  );
}
