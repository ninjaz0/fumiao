import { Fragment, useState, type ReactNode } from "react";
import { Download, Favorite, ReferenceMedia } from "./AssetMedia";
import {
  CancelGeneration,
  canEdit,
  duration,
  estimateTime,
  glyph,
  isMuse,
  status,
  timeTaken,
  timing,
} from "./History";
import { Icon } from "./Icon";
import { isOwner } from "./Library";
import { ResultPlayer } from "./ResultPlayer";
import {
  H3,
  mediaURL,
  modelAvailable,
  referenceAsset,
  referenceType,
  type Asset,
  type Job,
  type StudioState,
} from "./state";

const qualityLabels = { low: "草稿", medium: "标准", high: "高清" };

function DetailImage({ id, alt }: { id: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={loaded ? "detail-image fm-state-change" : "detail-image"}
      src={mediaURL(id)}
      alt={alt}
      onLoad={() => setLoaded(true)}
    />
  );
}

function parameters(state: StudioState, job: Job) {
  const { width, height, duration: seconds } = job.actual || {};
  const model = job.model;
  const spec = state.model_catalog[model];
  const name = isMuse(job)
    ? "Muse"
    : spec?.label || state.images.models[model] || model || "无模型";
  if (spec?.provider === "flow")
    return (
      name +
      (width ? ` · ${width} × ${height}` : "") +
      (seconds ? ` · ${seconds}s` : "")
    );
  if (model === "storyboard")
    return `成片 · ${width || job.width} × ${height || job.height} · ${Number(seconds || job.seconds).toFixed(1)}s`;
  if (job.kind === "audio")
    return (
      name +
      " · 24 kHz" +
      (seconds ? " · " + duration(Math.round(seconds)) : "")
    );
  if (isMuse(job))
    return (
      `Muse · ${width ? `${job.width} × ${job.height}` : "原生"}` +
      (job.kind === "image" ? "" : ` · ${seconds ?? job.seconds}s`)
    );
  if (job.kind === "image")
    return `${name} · ${job.quality === 2048 ? "2K" : "1K"} · ${job.image_quality && qualityLabels[job.image_quality]}`;
  return [name, job.seconds > 0 && `${job.seconds}s`, job.quality > 0 && `${job.quality}P`]
    .filter(Boolean).join(" · ");
}

const referenceNames = { Picture: "图片", Video: "视频", Audio: "音频" } as const;

function Prompt({ state, job }: { state: StudioState; job: Job }) {
  const parts: ReactNode[] = [];
  const assetsByType: Record<keyof typeof referenceNames, Asset[]> = {
    Picture: [], Video: [], Audio: [],
  };
  for (const id of job.refs) {
    const asset = referenceAsset(state, id);
    // A missing legacy reference can shift the numbering of any media type.
    if (!asset) break;
    assetsByType[referenceType(state, id)].push(asset);
  }
  let offset = 0;
  let text = "";
  for (const match of job.prompt.matchAll(/<(Picture|Video|Audio) (\d+)>/g)) {
    const type = match[1] as keyof typeof referenceNames;
    const number = match[2];
    const label = referenceNames[type] + number;
    const asset = assetsByType[type][Number(number) - 1];
    text += job.prompt.slice(offset, match.index);
    offset = match.index + match[0].length;
    if (!asset) {
      text += "@" + label;
      continue;
    }
    parts.push(
      text,
      <span key={match.index} className="inline-reference">
        <ReferenceMedia id={asset.id} kind={asset.kind} />
        {label}
      </span>,
    );
    text = "";
  }
  parts.push(text + job.prompt.slice(offset));
  return parts;
}

const phaseFields = {
  preparing: "prepare",
  generating: "generation",
  finalizing: "finalize",
  uploading: "upload",
  validating: "validation",
} as const;

function TimingDetails({ job, delta }: { job: Job; delta: number }) {
  const rows: [string, ReactNode][] = [];
  const value = job.timing;
  if (value?.source === "legacy")
    rows.push(["历史总等待", timeTaken(value.total)]);
  if (value?.source === "queued")
    rows.push(["排队时间", timeTaken(value.total + delta)]);
  if (value?.source === "measured") {
    const live = job.status === "running" ? delta : 0;
    const retried = value.attempt > 1;
    rows.push(
      [retried ? "本次处理" : "处理耗时", timeTaken(value.elapsed + live)],
      [retried ? "本次排队" : "排队时间", timeTaken(value.queue)],
      ["总等待", timeTaken(value.total + live)],
    );
    const phases = [
      ["prepare", "准备"],
      ["generation", job.kind === "image" ? "图片请求" : "生成"],
      ["finalize", "收尾"],
      ["upload", "回传"],
      ["validation", "校验"],
    ] as const;
    const phase = phaseFields[job.eta?.phase as keyof typeof phaseFields];
    for (const [key, label] of phases) {
      const amount = value[key];
      if (amount === undefined || !Number.isFinite(amount)) continue;
      const approx = value.phase_source === "observed" && job.kind !== "image";
      rows.push([
        label + (approx ? "（约）" : ""),
        timeTaken(amount + (phase === key ? live : 0)),
      ]);
    }
    if (retried) rows.push(["本次尝试", `第 ${value.attempt} 次`]);
    if (value.prediction?.high)
      rows.push([
        "开始时预估",
        "约 " + estimateTime(value.prediction.median ?? value.prediction.high),
      ]);
  }
  return (
    <div data-time-details={job.id}>
      {rows.map(([label, text]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{text}</dd>
        </Fragment>
      ))}
    </div>
  );
}

export function JobDetail({
  state,
  job,
  delta,
  close,
  favorite,
  cancel,
  cancelling,
  pageTo,
  locate,
  preview,
  imageToVideo,
  openCanvas,
  composer,
  edit,
  again,
  more,
  menuOpen,
  menuUsed,
  notify,
}: {
  state: StudioState;
  job: Job;
  delta: number;
  close: () => void;
  favorite: (id: string, saved: boolean) => void;
  cancel: (id: number) => void;
  cancelling: boolean;
  pageTo: (id: number) => void;
  locate: (job: Job) => void;
  preview: (id: string, button: HTMLButtonElement) => void;
  imageToVideo: (id: number) => void;
  openCanvas: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  composer: React.ReactNode;
  edit: (id: number) => void;
  again: (id: number) => void;
  more: (button: HTMLButtonElement) => void;
  menuOpen: boolean;
  menuUsed: boolean;
  notify: (message: string) => void;
}) {
  const audio = job.kind === "audio";
  const image = job.kind === "image";
  const muse = isMuse(job);
  const storyboard = job.model === "storyboard";
  const index = state.jobs.indexOf(job);
  const id = "job:" + job.id;
  const canvas = job.actual?.canvas_project;
  const pending = (
    <div className="result-pending">
      {!audio && <Icon name={glyph(job)} />}
      <h2 className="fm-state-change" key={status(job)}>{status(job)}</h2>
      <p data-time-job={job.id}>{timing(job, delta) || job.note}</p>
      {job.status === "queued" && isOwner(state, job) && (
        <CancelGeneration job={job} pending={cancelling} cancel={cancel} />
      )}
    </div>
  );
  return (
    <div
      className={`detail-view ${audio ? "audio-detail " : ""}${composer ? "editing" : ""}`}
    >
      <div className="detail-stage">
        <button
          className="detail-back icon-button"
          data-act="close-detail"
          aria-label="返回"
          onClick={close}
        >
          <Icon name="back" />
        </button>
        {audio ? (
          <div className="audio-stage">
            <Icon name="voice" />
            {job.result ? (
              <audio
                key={job.result}
                className="detail-audio"
                controls
                preload="metadata"
                src={mediaURL(job.result)}
                aria-label="生成语音"
              />
            ) : (
              pending
            )}
          </div>
        ) : (
          <>
            <div className="video-stage">
              {!job.result ? (
                pending
              ) : image ? (
                <DetailImage
                  key={job.result}
                  id={job.result}
                  alt="生成图片"
                />
              ) : (
                <ResultPlayer key={job.result} job={job} notify={notify} />
              )}
            </div>
            <div className="detail-paging">
              <button
                className="icon-button"
                data-act="previous"
                aria-label="上一个"
                disabled={index === 0}
                onClick={() => pageTo(state.jobs[index - 1].id)}
              >
                <Icon name="chevron" />
              </button>
              <button
                className="icon-button"
                data-act="next"
                aria-label="下一个"
                disabled={index === state.jobs.length - 1}
                onClick={() => pageTo(state.jobs[index + 1].id)}
              >
                <Icon name="chevron" />
              </button>
            </div>
          </>
        )}
        <div id="detail-composer" className="detail-composer">
          {composer}
        </div>
      </div>
      <aside className="detail-info">
        <div className="detail-actions">
          {job.result ? (
            <>
              <Favorite
                id={id}
                saved={state.favorites.includes(id)}
                change={favorite}
                detail
              />
              <Download id={job.result} detail />
            </>
          ) : (
            <span className="muted">{`#${job.id}`}</span>
          )}
          <button
            className="icon-button"
            data-menu="detail-more"
            aria-label="更多"
            aria-expanded={menuUsed ? menuOpen : undefined}
            onClick={(event) => more(event.currentTarget)}
          >
            <Icon name="more" />
          </button>
        </div>
        <div className="detail-copy">
          <div className="subheading">
            {audio
              ? "朗读文字"
              : storyboard
                ? "成片说明"
                : image
                  ? "图片提示词"
                  : "视频提示词"}
          </div>
          <p className="prompt-text fm-state-change" key={job.id}>
            {audio ? job.prompt : <Prompt state={state} job={job} />}
          </p>
          {audio ? (
            <>
              <div className="subheading">音色描述</div>
              <p>{job.audio_settings?.instruction || ""}</p>
              <div className="metadata detail-params">
                {parameters(state, job)}
              </div>
            </>
          ) : (
            <>
              {job.refs.length > 0 && (
                <div className="detail-references">
                  {job.refs.map((key, i) => (
                    <button
                      key={i}
                      data-act="h3-preview"
                      data-key={key}
                      aria-label={`预览参考素材${i + 1}`}
                      onClick={(event) => preview(key, event.currentTarget)}
                    >
                      <ReferenceMedia
                        id={key}
                        kind={
                          state.assets.find((asset) => asset.id === key)?.kind
                        }
                      />
                    </button>
                  ))}
                </div>
              )}
              <div className="metadata detail-params">
                <span>{parameters(state, job)}</span>
                {!muse && !storyboard && <span>{job.ratio}</span>}
              </div>
            </>
          )}
          <details
            key={job.id}
            className={audio ? undefined : muse ? "muse-details" : ""}
          >
            <summary>详细信息</summary>
            <dl>
              {!audio && (
                <>
                  <dt>尺寸</dt>
                  <dd>
                    {job.width && job.height
                      ? `${job.width} × ${job.height}`
                      : "原生"}
                  </dd>
                  {muse && (
                    <>
                      <dt>期望比例</dt>
                      <dd>{job.ratio}</dd>
                      {!image && (
                        <>
                          <dt>期望时长</dt>
                          <dd>{job.seconds + "s"}</dd>
                          <dt>实际时长</dt>
                          <dd>
                            {job.actual?.duration
                              ? job.actual.duration + "s"
                              : "—"}
                          </dd>
                        </>
                      )}
                    </>
                  )}
                  {!image && !muse && !storyboard && (
                    <>
                      <dt>采样步数</dt>
                      <dd>
                        {job.sampling_steps === 4
                          ? "4（快速）"
                          : (job.sampling_steps ?? 20)}
                      </dd>
                      <dt>随机种子</dt>
                      <dd>{String(job.seed)}</dd>
                    </>
                  )}
                </>
              )}
              <dt>创作者</dt>
              <dd>{job.author}</dd>
              <dt>时间</dt>
              <dd>{new Date(job.created * 1000).toLocaleString()}</dd>
              <TimingDetails job={job} delta={delta} />
            </dl>
          </details>
        </div>
        <div className="detail-footer">
          {image && job.result && (
            <button
              className="full-button"
              data-act="image-to-video"
              data-key={job.result}
              onClick={() => imageToVideo(job.id)}
            >
              <Icon name="film" />
              生成视频
            </button>
          )}
          {storyboard ? (
            canvas &&
            /^[a-f0-9]{32}$/.test(canvas) && (
              <a
                className="full-button"
                href={`/canvas/${canvas}?workspace=${state.workspace_id}`}
                onClick={openCanvas}
              >
                打开来源画布
              </a>
            )
          ) : (
            <div className="edit-actions">
              <button
                data-act="edit"
                data-id={job.id}
                disabled={!canEdit(state, job)}
                className={audio ? undefined : composer ? "selected" : ""}
                onClick={() => edit(job.id)}
              >
                <Icon name="edit" />
                重新编辑
              </button>
              <button
                data-act="again"
                data-id={job.id}
                disabled={
                  !modelAvailable(
                    state,
                    job.model || (image ? state.images.default_model : H3),
                  )
                }
                onClick={() => again(job.id)}
              >
                <Icon name="repeat" />
                再次生成
              </button>
            </div>
          )}
          {!audio && (
            <button
              className="locate-action"
              data-act="locate"
              data-id={job.id}
              onClick={() => locate(job)}
            >
              <Icon name="frame" />
              在资产中定位
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

export function ImageDetail({
  state,
  asset,
  close,
  favorite,
  use,
  remove,
  more,
}: {
  state: StudioState;
  asset: Asset;
  close: () => void;
  favorite: (id: string, saved: boolean) => void;
  use: (id: string) => void;
  more?: (button: HTMLButtonElement) => void;
  remove: (id: string) => void;
}) {
  const { id } = asset;
  const key = "asset:" + id;
  return (
    <div className="detail-view image-detail">
      <div className="detail-stage">
        <button
          className="detail-back icon-button"
          data-act="close-detail"
          aria-label="返回"
          onClick={close}
        >
          <Icon name="back" />
        </button>
        <div className="video-stage">
          <DetailImage key={id} id={id} alt="参考图片" />
        </div>
      </div>
      <aside className="detail-info">
        <div className="detail-actions">
          <Favorite
            id={key}
            saved={state.favorites.includes(key)}
            change={favorite}
            detail
          />
          <Download id={id} detail />
          {more && (
            <button
              className="icon-button"
              aria-label="更多"
              onClick={(e) => more(e.currentTarget)}
            >
              <Icon name="more" />
            </button>
          )}
        </div>
        <div className="detail-copy">
          <div className="metadata">{`${asset.w} × ${asset.h}`}</div>
        </div>
        <div className="detail-footer">
          <button
            className="full-button"
            data-act="use"
            data-key={id}
            onClick={() => use(id)}
          >
            <Icon name="picture" />
            用作参考图
          </button>
          {isOwner(state, asset) && (
            <button
              className="quiet-button danger"
              data-act="delete-image"
              data-key={id}
              onClick={() => remove(id)}
            >
              删除
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
