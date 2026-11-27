import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Crosshair, ListVideo, Plus, X } from "lucide-react";
import { directorBasis, directorShotIds } from "@fumiao/web-compat/director.js";
import { scriptApi, type ScriptDocumentDetail } from "./script-api";
import {
  directorShotDescription,
  directorSyncPreview,
  parseScriptBreakdown,
  reorderDirectorShots,
  scriptSourceJump,
} from "./script-fusion";
import type { Doc } from "./types";

type DirectorDeskProps = {
  document: Doc;
  active: boolean;
  activeShotId: string | null;
  onSelectShot: (nodeId: string) => void;
  onChooseScript: () => void;
  onEditSource: (request: NonNullable<ReturnType<typeof scriptSourceJump>>) => void;
  onUpdateScript: (docId: string) => void;
  onFocusCanvas: (nodeId: string) => void;
  onChangeDocument: (updater: (current: Doc) => Doc) => void;
  onConfirmOrder: () => Promise<void>;
};

export function DirectorDesk({
  document,
  active,
  activeShotId,
  onSelectShot,
  onChooseScript,
  onEditSource,
  onUpdateScript,
  onFocusCanvas,
  onChangeDocument,
  onConfirmOrder,
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState<string>();
  const orderKey = JSON.stringify(order);

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
  const confirmOrder = async () => {
    setPending(true);
    setError("");
    try {
      await onConfirmOrder();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPending(false);
    }
  };

  const activeIndex = order.indexOf(node?.id ?? "");
  const orderConfirmed = !error && Boolean(production?.order_basis && production.order_basis === confirmedOrder);

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
        {production && (
          <button type="button" className="secondary" onClick={() => onUpdateScript(production.script_id)}>
            <BookOpen size={14} /> 更新本集分镜
          </button>
        )}
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
              <button type="button" className="primary" disabled={!order.length || pending || orderConfirmed} onClick={() => void confirmOrder()}>
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
                  <p>{directorShotDescription(document, node) || "尚未填写镜头说明。"}</p>
                  {shotDiff?.changes.preserve.length ? <p className="fm-director-note">本镜保留了画布修改。</p> : null}
                  {shotDiff && (shotDiff.changes.conflicts.length > 0 || shotDiff.changes.takeScript.length > 0) &&
                    <p className="fm-director-note">剧本与画布有新的差异，可在更新预览中选择采用的内容。</p>}
                  {node.tail_inherited && <p className="fm-director-note">本镜开启了自动尾帧继承，可到画布调整。</p>}
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
