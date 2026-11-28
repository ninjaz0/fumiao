import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, ShieldAlert } from "lucide-react";
import { directorBatchUnclaimed, directorLocalScriptDraft, directorScriptConflict, type DirectorBatchSelection, type DirectorTarget } from "@fumiao/web-compat/director.js";
import { receiptTarget, type BatchReceipt, type DirectorSubmission, type PendingDirectorBatch } from "./director-batch";
import type { PrecheckResponse, PrecheckStage } from "./types";

const STAGE_LABELS: { id: PrecheckStage; label: string }[] = [
  { id: "image", label: "图片生成" },
  { id: "video", label: "视频生成" },
  { id: "narration", label: "单人旁白" },
  { id: "dialogue", label: "多角色对白" },
];

export function PrecheckCostModal({
  workspace,
  projectId,
  revision,
  nodeIds,
  title = "批量生成预检与积分确认",
  initialStages = ["image", "video"],
  lockedStages = false,
  director,
  onSubmitted,
  onClose,
}: {
  workspace: number;
  projectId: string;
  revision: number;
  nodeIds: string[];
  title?: string;
  initialStages?: PrecheckStage[];
  lockedStages?: boolean;
  director?: {
    selection?: DirectorBatchSelection;
    pending?: PendingDirectorBatch;
    hasLocalScriptEdits: () => boolean;
    batches: PendingDirectorBatch[];
    onPick: (uid: string) => void;
    onPending: (pending: PendingDirectorBatch) => void;
    onClear: (uid: string) => void;
    onAttach: (receipt: BatchReceipt) => Promise<{ note?: string }>;
    onRecheck: (pending: PendingDirectorBatch, only?: DirectorTarget) => Promise<void>;
    canRetryItem: (jobId: number) => boolean;
    describe: (item: { node: string; line_id?: string }) => string;
  };
  onSubmitted: (result: BatchReceipt) => void | Promise<void>;
  onClose: () => void;
}) {
  const [stages, setStages] = useState<PrecheckStage[]>(initialStages);
  const [data, setData] = useState<PrecheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [useConfirmedScript, setUseConfirmedScript] = useState(false);
  const pending = director?.pending;
  const directorSelection = director?.selection;
  const selectionKey = directorSelection ? JSON.stringify(directorSelection) : "";
  // F010 (#9): Persist deterministic batch UID across retries AND page reloads
  // keyed by (workspace, project, nodes, stages) so lost responses recover the same receipt.
  const batchStorageKey = `fm-batch-uid:${workspace}:${projectId}:${[...new Set(nodeIds)].sort().join(",")}:${[...new Set(stages)].sort().join(",")}`;
  const batchUidRef = useRef<{ key: string; uid: string } | null>(null);
  const getOrCreateBatchUid = () => {
    if (batchUidRef.current?.key === batchStorageKey) {
      return batchUidRef.current.uid;
    }
    try {
      const saved = localStorage.getItem(batchStorageKey);
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) {
        batchUidRef.current = { key: batchStorageKey, uid: saved };
        return saved;
      }
    } catch {
      // Ignore storage errors in restricted contexts.
    }
    const fresh = crypto.randomUUID();
    batchUidRef.current = { key: batchStorageKey, uid: fresh };
    try {
      localStorage.setItem(batchStorageKey, fresh);
    } catch {
      // Ignore storage errors.
    }
    return fresh;
  };
  const clearBatchUid = () => {
    batchUidRef.current = null;
    try {
      localStorage.removeItem(batchStorageKey);
    } catch {
      // Ignore storage errors.
    }
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const run = async () => {
      if (pending || (director ? !directorSelection : (!stages.length || !nodeIds.length))) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      if (director) setData(null);
      try {
        if (director && !useConfirmedScript && director.hasLocalScriptEdits()) throw new Error(directorLocalScriptDraft);
        const res = await fetch(`/api/canvases/${projectId}/batch-precheck`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": String(workspace),
          },
          body: JSON.stringify({
            expected_revision: revision,
            ...(directorSelection ? {
              director: { ...directorSelection, use_confirmed_script: useConfirmedScript },
            } : { node_ids: nodeIds, stages }),
          }),
        });
        const json = await res.json();
        if (!res.ok)
          throw new Error(
            typeof json.detail === "string" ? json.detail : "预检失败",
          );
        if (active) setData(json);
      } catch (e) {
        if (active && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [workspace, projectId, revision, nodeIds.join(","), stages.join(","), selectionKey, useConfirmedScript, Boolean(pending)]);

  const toggleStage = (stage: PrecheckStage) => {
    setStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
    );
  };

  const settleDirector = async (current: PendingDirectorBatch) => {
    if (!director || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      let receipt = current.receipt;
      if (!receipt) {
        const res = await fetch(`/api/canvases/${projectId}/batch-runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-Id": String(workspace) },
          body: JSON.stringify(current.request),
        });
        const json = await res.json();
        if (!res.ok) {
          const detail = typeof json.detail === "string" ? json.detail : "批量提交失败，请恢复上次提交";
          if (detail.startsWith(directorBatchUnclaimed)) director.onPending({ ...current, rejected: true });
          throw new Error(detail);
        }
        if (!Array.isArray(json.submitted) || !Array.isArray(json.skipped) || typeof json.total_credits !== "number") {
          throw new Error("未收到完整回执，请恢复上次提交");
        }
        receipt = json as BatchReceipt;
        current = { ...current, receipt };
        director.onPending(current);
      }
      const attachment = await director.onAttach(receipt);
      director.onPending({ ...current, attachment });
    } catch (cause) {
      setError(current.receipt
        ? `任务已接单，挂接音轨失败。${(cause as Error).message}。处理保存冲突后可重试挂接音轨。`
        : cause instanceof TypeError || cause instanceof SyntaxError
          ? "提交响应中断，请恢复上次提交。"
          : (cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  const newDirectorQuote = async (only?: DirectorTarget) => {
    if (!director || !pending) return;
    setSubmitting(true);
    setError("");
    try {
      await director.onRecheck(pending, only);
      setUseConfirmedScript(false);
      director.onClear(pending.request.uid);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async () => {
    if (!data || submitting) return;
    if (director) {
      if (!directorSelection || !data.precheck_token || pending) return;
      const request: DirectorSubmission = {
        expected_revision: data.revision,
        price_revision: data.price_revision,
        precheck_token: data.precheck_token,
        expected_total_credits: data.summary.exact_total_credits ?? data.summary.total_credits,
        director: { ...directorSelection, use_confirmed_script: useConfirmedScript },
        uid: crypto.randomUUID(),
      };
      try {
        director.onPending({ request });
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
      await settleDirector({ request });
      return;
    }
    setSubmitting(true);
    setError("");
    const uid = getOrCreateBatchUid();
    try {
      const res = await fetch(`/api/canvases/${projectId}/batch-runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": String(workspace),
        },
        body: JSON.stringify({
          expected_revision: revision,
          price_revision: data.price_revision,
          precheck_token: data.precheck_token,
          expected_total_credits: (data.summary.exact_total_credits ?? data.summary.total_credits),
          uid,
          node_ids: nodeIds,
          stages,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status < 500) clearBatchUid();
        throw new Error(
          typeof json.detail === "string" ? json.detail : "批量提交失败",
        );
      }
      clearBatchUid();
      await onSubmitted(json);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !!data &&
    !pending &&
    (!director || !error) &&
    !loading &&
    !submitting &&
    data.summary.runnable > 0 &&
    data.summary.sufficient &&
    !data.summary.budget_blocked &&
    !data.stale_revision;

  if (director && pending) return (
    <div className="fm-precheck" aria-label={title}>
      {director.batches.length > 1 && (
        <label className="fm-precheck-stage-pill">
          提交记录
          <select aria-label="选择要恢复的提交"
            disabled={submitting}
            value={pending.request.uid}
            onChange={(event) => {
              setError("");
              director.onPick(event.target.value);
            }}>
            {director.batches.map((batch) => (
              <option key={batch.request.uid} value={batch.request.uid}>
                #{batch.request.uid.slice(0, 8)} · {batch.receipt ? "已收到回执" : batch.rejected ? "可重新预检" : "待恢复"}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {pending.receipt ? (
        <>
          <h3>已接单 {pending.receipt.submitted.length} 项 · 冻结 {pending.receipt.exact_total_credits ?? pending.receipt.total_credits} 积分</h3>
          <ul>
            {pending.receipt.submitted.map((item) => (
              <li key={item.job_id}>
                {director.describe(item)} · {STAGE_LABELS.find((stage) => stage.id === item.stage)?.label} · #{item.job_id}
                {item.stage === "dialogue" && pending.attachment && director.canRetryItem(item.job_id) && (
                  <button type="button" className="secondary" disabled={submitting}
                    aria-label={`仅补跑 ${director.describe(item)}`} onClick={() => void newDirectorQuote(receiptTarget(item))}>
                    仅补跑此句
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3>跳过 {pending.receipt.skipped.length} 项</h3>
          <ul>
            {pending.receipt.skipped.map((item) => (
              <li key={`${item.node}:${item.stage}:${item.line_id ?? ""}`}>
                {director.describe(item)} · {item.reason}
                {item.stage === "dialogue" && pending.attachment && (
                  <button type="button" className="secondary" disabled={submitting}
                    aria-label={`仅补跑 ${director.describe(item)}`} onClick={() => void newDirectorQuote(receiptTarget(item))}>
                    仅补跑此句
                  </button>
                )}
              </li>
            ))}
          </ul>
          {pending.attachment?.note && <p role="status">{pending.attachment.note}</p>}
          {!pending.attachment && <p>回执已保存。挂接音轨可按此回执重试。</p>}
        </>
      ) : <p>{pending.rejected ? "本次未创建回执，可重新预检。" : "上次提交的回执待恢复。恢复时会使用原提交号。"}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary" disabled={submitting} onClick={() => {
          if (pending.attachment || pending.rejected) {
            try {
              director.onClear(pending.request.uid);
            } catch (cause) {
              setError((cause as Error).message);
              return;
            }
          }
          onClose();
        }}>{pending.attachment ? "确认回执并关闭" : "关闭"}</button>
        {!pending.receipt && !pending.rejected && (
          <button type="button" className="primary" disabled={submitting} onClick={() => void settleDirector(pending)}>
            {submitting ? "正在恢复回执…" : "恢复上次提交"}
          </button>
        )}
        {pending.receipt && !pending.attachment && (
          <button type="button" className="primary" disabled={submitting} onClick={() => void settleDirector(pending)}>
            {submitting ? "正在挂接…" : "重试挂接音轨"}
          </button>
        )}
        {(pending.rejected || pending.attachment) && (
          <button type="button" className="primary" disabled={submitting} onClick={() => void newDirectorQuote()}>
            重新预检并补跑
          </button>
        )}
      </div>
    </div>
  );

  if (director && !directorSelection) return (
    <div className="fm-precheck" aria-label={title}>
      <p>此提交回执已处理。</p>
      <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose}>关闭</button></div>
    </div>
  );

  return (
    <div className="fm-precheck" aria-label={title}>
      {!lockedStages && <div className="fm-precheck-stages" role="group" aria-label="选择执行阶段">
        <span>勾选重跑环节：</span>
        {STAGE_LABELS.map((s) => (
          <label key={s.id} className="fm-precheck-stage-pill">
            <input
              type="checkbox"
              checked={stages.includes(s.id)}
              onChange={() => toggleStage(s.id)}
            />
            <span>{s.label}</span>
          </label>
        ))}
      </div>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {directorSelection && (error === directorScriptConflict || error === directorLocalScriptDraft) && !useConfirmedScript && (
        <button type="button" className="secondary" onClick={() => setUseConfirmedScript(true)}>
          使用已确认的剧本版本 {directorSelection.script_revision} 预检
        </button>
      )}
      {directorSelection && useConfirmedScript && !error && (
        <p className="fm-precheck-warning">按已确认的剧本版本 {directorSelection.script_revision} 继续。</p>
      )}

      {loading ? (
        <p className="fm-precheck-loading">正在检查节点状态与积分预算…</p>
      ) : data ? (
        <>
          <div className="fm-precheck-summary">
            <div>
              <span className="fm-dot-ready">就绪 {data.summary.ready}</span>
              <span className="fm-dot-warn">提醒 {data.summary.warning}</span>
              <span className="fm-dot-block">阻塞 {data.summary.blocked}</span>
            </div>
            <div className="fm-precheck-credits">
              <span>
                预计冻结：<strong>{(data.summary.exact_total_credits ?? data.summary.total_credits)}</strong> 积分
              </span>
              <span
                className={data.summary.sufficient ? "" : "fm-credits-short"}
              >
                可用余额：{(data.summary.exact_available_credits ?? data.summary.available_credits)} 积分
              </span>
            </div>
          </div>

          {!data.summary.sufficient && (
            <p className="error" role="alert">
              当前工作区可用积分不足（需 {(data.summary.exact_total_credits ?? data.summary.total_credits)}，当前{" "}
              {(data.summary.exact_available_credits ?? data.summary.available_credits)}），请先充值或减少选中镜头。
            </p>
          )}
          {data.summary.budget_blocked &&
            (data.summary.budget_blocks ?? []).map((msg, idx) => (
              <p key={idx} className="error" role="alert">
                {msg}
              </p>
            ))}
          {!data.summary.budget_blocked &&
            (data.summary.budget_warnings ?? []).map((msg, idx) => (
              <p key={idx} className="fm-precheck-warning" role="status">
                {msg}
              </p>
            ))}
          {data.stale_revision && (
            <p className="error" role="alert">
              画布版本已过期，请先关闭弹窗同步保存后再执行预检。
            </p>
          )}

          <div className="fm-precheck-list">
            {data.items.length === 0 ? (
              <p className="fm-precheck-empty">
                所选节点与当前勾选的阶段无匹配任务。
              </p>
            ) : (
              data.items.map((item) => (
                <div
                  key={`${item.node_id}:${item.stage}:${item.line_id ?? ""}`}
                  className={`fm-precheck-row status-${item.status}`}
                >
                  <span className="fm-precheck-icon">
                    {item.status === "ready" ? (
                      <CheckCircle2 size={15} />
                    ) : item.status === "warning" ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <ShieldAlert size={15} />
                    )}
                  </span>
                  <div className="fm-precheck-info">
                    <strong>
                      {item.title}{" "}
                      <small>
                        [{STAGE_LABELS.find((s) => s.id === item.stage)?.label}]
                        {item.model ? ` · ${item.model}` : ""}
                      </small>
                    </strong>
                    {item.issues.length > 0 && (
                      <p>{item.issues.join("；")}</p>
                    )}
                  </div>
                  <span className="fm-precheck-cost">
                    {item.status === "blocked" ? "跳过" : `${item.exact_credits ?? item.credits} 积分`}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}

      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={!canSubmit}
          onClick={() => void confirm()}
        >
          <Play size={15} />
          {submitting
            ? "提交中…"
            : data
              ? `确认冻结 ${(data.summary.exact_total_credits ?? data.summary.total_credits)} 积分并提交 (${data.summary.runnable} 项)`
              : "确认提交"}
        </button>
      </div>
    </div>
  );
}
