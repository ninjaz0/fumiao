import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, ShieldAlert } from "lucide-react";
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
  onSubmitted,
  onClose,
}: {
  workspace: number;
  projectId: string;
  revision: number;
  nodeIds: string[];
  title?: string;
  initialStages?: PrecheckStage[];
  onSubmitted: (result: {
    submitted: { node: string; stage: PrecheckStage; job_id: number; line_id?: string }[];
    skipped: { node: string; stage: PrecheckStage; reason: string; line_id?: string }[];
    total_credits: number;
  }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [stages, setStages] = useState<PrecheckStage[]>(initialStages);
  const [data, setData] = useState<PrecheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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
      if (!stages.length || !nodeIds.length) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/canvases/${projectId}/batch-precheck`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Workspace-Id": String(workspace),
          },
          body: JSON.stringify({
            expected_revision: revision,
            node_ids: nodeIds,
            stages,
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
  }, [workspace, projectId, revision, nodeIds.join(","), stages.join(",")]);

  const toggleStage = (stage: PrecheckStage) => {
    setStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
    );
  };

  const confirm = async () => {
    if (!data) return;
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
          expected_total_credits: data.summary.total_credits,
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
    !loading &&
    !submitting &&
    data.summary.runnable > 0 &&
    data.summary.sufficient &&
    !data.summary.budget_blocked &&
    !data.stale_revision;

  return (
    <div className="fm-precheck" aria-label={title}>
      <div className="fm-precheck-stages" role="group" aria-label="选择执行阶段">
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
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
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
                预计冻结：<strong>{data.summary.total_credits}</strong> 积分
              </span>
              <span
                className={data.summary.sufficient ? "" : "fm-credits-short"}
              >
                可用余额：{data.summary.available_credits} 积分
              </span>
            </div>
          </div>

          {!data.summary.sufficient && (
            <p className="error" role="alert">
              当前工作区可用积分不足（需 {data.summary.total_credits}，当前{" "}
              {data.summary.available_credits}），请先充值或减少选中镜头。
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
                  key={`${item.node_id}:${item.stage}`}
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
                    {item.status === "blocked" ? "跳过" : `${item.credits} 积分`}
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
              ? `确认冻结 ${data.summary.total_credits} 积分并提交 (${data.summary.runnable} 项)`
              : "确认提交"}
        </button>
      </div>
    </div>
  );
}
