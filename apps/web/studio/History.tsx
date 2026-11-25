import type { ReactNode } from "react";
import {
  Download,
  Favorite,
  playPreview,
  pausePreview,
  useCardClasses,
} from "./AssetMedia";
import { Icon } from "./Icon";
import { mediaURL, modelAvailable, type Job, type StudioState } from "./state";

const labels = {
  queued: "排队中",
  running: "生成中",
  done: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};
const waiting: Record<string, string> = {
  model_paused: "等待模型开放",
  waiting_flow: "等待 Flow 就绪",
  flow_busy: "等待 Flow 空闲",
  waiting_muse: "等待 Muse 就绪",
  muse_busy: "等待 Muse 空闲账号",
  waiting_gpu: "等待 GPU 上线",
  worker_update: "等待实例更新",
  service_paused: "等待图片服务开启",
};
export const isMuse = (job: Job) =>
  ["muse-video", "muse-image"].includes(job.model);
export const kindLabel = (job: Job) =>
  job.kind === "audio" ? "语音" : job.kind === "image" ? "图片" : "视频";
export const glyph = (job: Job) =>
  job.kind === "audio" ? "voice" : job.kind === "image" ? "picture" : "film";
export const status = (job: Job) =>
  isMuse(job) && job.status === "running" && job.eta?.phase === "queued"
    ? labels.queued
    : labels[job.status];
export const duration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function timeParts(seconds: number) {
  return [
    [Math.floor(seconds / 3600), "小时"],
    [Math.floor((seconds % 3600) / 60), "分"],
    [seconds % 60, "秒"],
  ]
    .filter(([value]) => value)
    .map(([value, unit]) => `${value} ${unit}`)
    .join(" ");
}
export function estimateTime(seconds: number) {
  const unit = seconds >= 3600 ? 60 : seconds >= 60 ? 15 : 5;
  return timeParts(Math.max(5, Math.round(Math.max(0, seconds) / unit) * unit));
}
export function timeTaken(seconds: number | undefined) {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? timeParts(Math.max(0, Math.round(seconds))) || "不到 1 秒"
    : "—";
}
function waitLabel(job: Job) {
  if (isMuse(job))
    return (
      job.note || (job.status === "queued" ? "等待 Muse 就绪" : "Muse 生成中")
    );
  return job.status === "queued"
    ? job.kind === "image"
      ? "等待图片生成"
      : "等待 GPU 接单"
    : "正在生成";
}
export function timing(job: Job, delta: number) {
  if (isMuse(job) && job.note?.includes("待确认")) return job.note;
  const eta = job.eta || {};
  if (job.status === "done")
    return job.timing?.source === "measured"
      ? "耗时 " + timeTaken(job.timing.elapsed)
      : "";
  if (job.status === "queued" || (isMuse(job) && eta.phase === "queued")) {
    if (eta.reason && waiting[eta.reason]) return waiting[eta.reason];
    if (typeof eta.high === "number") {
      const remaining = (eta.median ?? eta.high) - delta;
      return remaining <= 0
        ? "等待开始"
        : "预计约 " + estimateTime(remaining) + "后开始";
    }
    const ahead = job.ahead ? `前方 ${job.ahead} 个任务` : "";
    return eta.reason === "observing"
      ? ahead
        ? "观测中 · " + ahead
        : "观测中"
      : ahead || waitLabel(job);
  }
  if (job.status !== "running") return "";
  if (eta.phase === "uploading") return "正在回传";
  if (eta.phase === "validating") return "正在校验";
  if (eta.phase === "finalizing")
    return job.kind === "image" ? "正在保存图片" : "正在整理成片";
  if (eta.overdue || (typeof eta.high === "number" && eta.high - delta <= 0))
    return "生成时间较长，仍在处理中";
  if (typeof eta.high === "number") {
    const left = (eta.median ?? eta.high) - delta;
    return left > 0 ? "预计还需约 " + estimateTime(left) : "仍在生成，请稍候";
  }
  if (typeof eta.elapsed === "number")
    return "已用 " + timeTaken(eta.elapsed + delta);
  return job.note || waitLabel(job);
}
function Preview({ job }: { job: Job }) {
  if (job.result && job.kind === "audio")
    return (
      <span className="audio-cover">
        <Icon name="voice" />
        <span>{job.prompt.slice(0, 58)}</span>
      </span>
    );
  if (job.result && job.kind === "image")
    return <img loading="lazy" src={mediaURL(job.result)} alt="生成图片" />;
  if (job.result)
    return (
      <video
        preload="metadata"
        muted
        loop
        playsInline
        src={mediaURL(job.result) + "#t=0.05"}
        ref={(video) => {
          // React sets the media property, while the original also has the
          // attribute. The pinned workbench distinguishes previews by it.
          video?.setAttribute("muted", "");
        }}
      />
    );
  return job.refs[0] ? (
    <img loading="lazy" src={mediaURL(job.refs[0])} alt="" />
  ) : (
    <span className="placeholder-media">
      <Icon name={glyph(job)} />
    </span>
  );
}

export function canEdit(state: StudioState, job: Job) {
  const models =
    job.kind === "audio"
      ? state.audio_models
      : job.kind === "image"
        ? state.images.models
        : state.video_models;
  return Object.keys(models).some((model) => modelAvailable(state, model));
}

type CardActions = {
  favorite: (key: string, enabled: boolean) => void;
  detail: (id: number) => void;
  edit: (id: number) => void;
};
type CardProps = {
  job: Job;
  state: StudioState;
  delta: number;
  selection?: ReactNode;
  selecting?: boolean;
  selected?: boolean;
  highlight?: boolean;
  referenceAdded?: boolean;
} & CardActions;

export function JobCard({
  job,
  state,
  delta,
  selection,
  selecting,
  selected,
  highlight,
  referenceAdded,
  favorite,
  detail,
  edit,
}: CardProps) {
  const key = "job:" + job.id;
  const saved = state.favorites.includes(key);
  const classes = useCardClasses(
    saved,
    selected,
    highlight,
    false,
    referenceAdded,
  );
  return (
    <article
      {...classes}
      data-asset-key={key}
      data-job={job.id}
      id={`job-${job.id}`}
    >
      {selection}
      <button
        className="asset-preview"
        data-act="detail"
        data-id={job.id}
        aria-label={
          referenceAdded === undefined
            ? `预览${kindLabel(job)} #${job.id}`
            : referenceAdded
              ? "已添加为参考图片"
              : "添加为参考图片"
        }
        aria-pressed={referenceAdded}
        onClick={() => detail(job.id)}
        onMouseEnter={selecting ? undefined : playPreview}
        onMouseLeave={pausePreview}
      >
        <Preview job={job} />
        <span className="asset-duration">
          {job.status === "done"
            ? job.kind === "image"
              ? ""
              : duration(Math.round(job.actual?.duration ?? job.seconds))
            : status(job)}
        </span>
        {job.kind !== "image" && job.result && (
          <span className="asset-play">
            <Icon name="play" />
          </span>
        )}
      </button>
      <div className="asset-actions">
        {job.model !== "storyboard" && (
          <button
            data-act="edit"
            data-id={job.id}
            disabled={!canEdit(state, job)}
            title="重新编辑"
            onClick={() => edit(job.id)}
          >
            <Icon name="edit" />
          </button>
        )}
        {job.result && (
          <>
            <Download id={job.result} />
            <Favorite id={key} saved={saved} change={favorite} />
          </>
        )}
      </div>
      {["running", "queued", "done"].includes(job.status) && (
        <div className="pending-caption fm-number" data-time-job={job.id}>
          {timing(job, delta)}
        </div>
      )}
    </article>
  );
}

export function History({
  state,
  delta,
  ...actions
}: { state: StudioState; delta: number } & CardActions) {
  if (!state.jobs.length)
    return <div className="empty-state">生成的作品会出现在这里</div>;
  return (
    <div className="asset-grid">
      {state.jobs.slice(0, 8).map((job) => (
        <JobCard
          key={job.id}
          job={job}
          state={state}
          delta={delta}
          {...actions}
        />
      ))}
    </div>
  );
}

export function Queue({
  state,
  delta,
  detail,
  cancel,
  cancelling,
}: {
  state: StudioState;
  delta: number;
  detail: (id: number) => void;
  cancel: (id: number) => void;
  cancelling: ReadonlySet<number>;
}) {
  const jobs = state.jobs
    .filter(({ status }) => status === "queued" || status === "running")
    .reverse();
  return (
    <div className="management-view">
      <div className="page-heading">
        <h1>任务队列</h1>
      </div>
      <div className="list-surface">
        {jobs.length ? (
          jobs.map((job) => (
            <div className="job-row" key={job.id}>
              <span className="job-id">{`#${job.id}`}</span>
              <div className="job-row-main">
                <button
                  data-act="detail"
                  data-id={job.id}
                  onClick={() => detail(job.id)}
                >
                  {job.prompt}
                </button>
                <div className="metadata">
                  <span>{job.author}</span>
                  <span>
                    {job.width && job.height
                      ? `${job.width} × ${job.height}`
                      : "原生"}
                  </span>
                  <span>
                    {job.kind === "video" ? job.seconds + "s" : kindLabel(job)}
                  </span>
                </div>
              </div>
              <div className="job-progress">
                <span className="fm-state-change" key={status(job)}>{status(job)}</span>
                <small data-time-job={job.id}>{timing(job, delta)}</small>
              </div>
              <div className="job-actions">
                {job.status === "queued" &&
                  (job.owner === state.me.id || state.me.role === "admin") && (
                    <CancelGeneration job={job} pending={cancelling.has(job.id)} cancel={cancel} />
                  )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state" role="status">暂无待处理任务</div>
        )}
      </div>
    </div>
  );
}

export function CancelGeneration({
  job,
  pending,
  cancel,
}: {
  job: Job;
  pending: boolean;
  cancel: (id: number) => void;
}) {
  return (
    <button
      className="quiet-button"
      data-act="cancel"
      data-id={job.id}
      disabled={pending}
      aria-busy={pending}
      onClick={() => cancel(job.id)}
    >
      {pending ? "正在取消…" : "取消生成"}
    </button>
  );
}
