import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Download,
  Favorite,
  ReferenceMedia,
  pausePreview,
  playPreview,
  useCardClasses,
} from "./AssetMedia";
import { JobCard, kindLabel } from "./History";
import { Icon } from "./Icon";
import { mediaURL, type Asset, type Job, type StudioState } from "./state";
import { MAX_ASSET_SELECTION } from "@fumiao/original-api/asset-limits";
import { groupHistoryJobs } from "./library-history";
import { allAssetsSelected, selectAllAssets } from "./library-selection";

export type LibraryTab = "videos" | "images" | "audio";
export type LibraryScope = "history" | "favorites";
export type LibraryFilter = { tab: LibraryTab; scope: LibraryScope };

const jobKind = { videos: "video", images: "image", audio: "audio" } as const;
const uploadKind = {
  videos: "ref_video",
  images: "ref",
  audio: "ref_audio",
} as const;
const filters = [
  ["videos", "视频"],
  ["images", "图片"],
  ["audio", "语音"],
] as const;
const scopes = [
  ["history", "生成历史"],
  ["favorites", "收藏夹"],
] as const;

function moveFilterFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const index = tabs.findIndex((tab) => tab === event.target);
  if (index < 0) return;
  const count = tabs.length;
  const next = {
    ArrowLeft: (index + count - 1) % count,
    ArrowRight: (index + 1) % count,
    Home: 0,
    End: count - 1,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  if (next === index) return;
  tabs[next].focus();
  tabs[next].click();
}

export function isOwner(state: StudioState, item: { owner: number }) {
  return state.me.role === "admin" || item.owner === state.me.id;
}
export function canSelect(job: Job) {
  return job.status !== "queued" && job.status !== "running";
}
export function useLibrary(
  state: StudioState | null,
  notify: (message: string) => void,
) {
  const [filter, setFilter] = useState<LibraryFilter>({
    tab: "videos",
    scope: "history",
  });
  const [selecting, setSelecting] = useState(false);
  const [redraw, setRedraw] = useState(0);
  const [gridRevision, setGridRevision] = useState(0);
  const [uploadsVisible, setUploadsVisible] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [activity, setActivity] = useState<"favorite" | "download" | null>(
    null,
  );
  const { records, visibleJobs, visibleAssets, visible } = useMemo(() => {
    const jobs = state?.jobs ?? [];
    const assets = state?.assets ?? [];
    const favorites = state?.favorites ?? [];
    const results = new Set(jobs.map((job) => job.result));
    const matches = (key: string) =>
      filter.scope === "history" || favorites.includes(key);
    const visibleJobs = jobs.filter(
      (job) => job.kind === jobKind[filter.tab] && matches("job:" + job.id),
    );
    const visibleAssets = assets.filter(
      (asset) =>
        !results.has(asset.id) &&
        (asset.kind || "ref") === uploadKind[filter.tab] &&
        matches("asset:" + asset.id),
    );
    const records = new Map([
      ...jobs.filter(canSelect).map(
        (job) =>
          [
            "job:" + job.id,
            {
              owner: job.owner,
              downloadable: job.status === "done" && !!job.result,
            },
          ] as const,
      ),
      ...assets.map(
        (asset) =>
          [
            "asset:" + asset.id,
            { owner: asset.owner, downloadable: true },
          ] as const,
      ),
    ]);
    const visible = [
      ...visibleJobs.filter(canSelect).map((job) => "job:" + job.id),
      ...visibleAssets.map((asset) => "asset:" + asset.id),
    ];
    return { records, visibleJobs, visibleAssets, visible };
  }, [state, filter]);
  const favorites = state?.favorites ?? [];
  const keys = selected.filter((key) => records.has(key));
  const count = visible.filter((key) => keys.includes(key)).length;
  const all = allAssetsSelected(keys, visible);

  useEffect(() => {
    setSelected((current) => {
      const available = current.filter((key) => records.has(key));
      return available.length === current.length ? current : available;
    });
  }, [records]);

  function reset() {
    setSelecting(false);
    setSelected([]);
  }
  function choose(next: LibraryFilter, result: number | null = null) {
    reset();
    setUploadsVisible(true);
    setRedraw((value) => value + 1);
    setFilter(next);
    setHighlight(result);
  }
  function toggle(key: string) {
    if (!records.has(key) || activity) return;
    const checked = keys.includes(key);
    if (!checked && keys.length >= MAX_ASSET_SELECTION) {
      notify(`一次最多选择 ${MAX_ASSET_SELECTION} 项`);
      return;
    }
    setSelecting(true);
    setSelected(checked ? keys.filter((id) => id !== key) : [...keys, key]);
  }
  function selectAll() {
    if (!all && new Set([...keys, ...visible]).size > MAX_ASSET_SELECTION)
      notify(`一次最多选择 ${MAX_ASSET_SELECTION} 项，已选中 ${MAX_ASSET_SELECTION} 项`);
    setSelected(selectAllAssets(keys, visible));
  }

  return {
    filter,
    choose,
    redraw,
    gridRevision,
    uploadsVisible,
    showUploads: () => setUploadsVisible(true),
    redrawLibrary: () => {
      setUploadsVisible(true);
      setRedraw((value) => value + 1);
    },
    refreshGrid: () => {
      setUploadsVisible(true);
      setHighlight(null);
      setGridRevision((value) => value + 1);
    },
    selecting,
    start: () => setSelecting(true),
    reset,
    toggle,
    keys,
    visibleJobs,
    visibleAssets,
    highlight,
    clearHighlight: () => setHighlight(null),
    count,
    all,
    selectAll,
    hasVisible: !!visible.length,
    allSaved: keys.length > 0 && keys.every((key) => favorites.includes(key)),
    downloadable:
      keys.length > 0 && keys.every((key) => records.get(key)?.downloadable),
    removable:
      !!state &&
      keys.length > 0 &&
      keys.every((key) => isOwner(state, records.get(key)!)),
    activity,
    setActivity,
    removeSelected: (removed: string[]) =>
      setSelected((current) => current.filter((key) => !removed.includes(key))),
  };
}

type ReferencePicking = { ids: Set<string>; finish: () => void };
type LibraryActions = {
  favorite: (key: string, saved: boolean) => void;
  edit: (id: number) => void;
  job: (id: number) => void;
  image: (id: string) => void;
  preview: (id: string, button: HTMLButtonElement) => void;
  use: (id: string) => void;
  batchFavorite: () => void;
  batchDownload: () => void;
  batchDelete: () => void;
  filter: (next: LibraryFilter) => void;
};

export function Library({
  pluginButtons,
  importButton,
  library,
  state,
  delta,
  composer,
  referencePicking,
  actions,
}: {
  pluginButtons?: ReactNode;
  importButton?: ReactNode;
  library: ReturnType<typeof useLibrary>;
  state: StudioState;
  delta: number;
  composer: ReactNode;
  referencePicking: ReferencePicking | null;
  actions: LibraryActions;
}) {
  const { filter, keys, selecting, visibleJobs, visibleAssets, activity } =
    library;
  const surface = useRef<HTMLDivElement>(null);
  const floating = useRef<HTMLDivElement>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const browseScroll = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const node = surface.current!;
    const holder = floating.current!;
    // A full redraw measures the composer before selection hides it again.
    if (holder.hidden) {
      holder.hidden = false;
      const height = Math.ceil(
        holder.lastElementChild!.getBoundingClientRect().height,
      );
      node
        .closest<HTMLElement>(".shell")
        ?.style.setProperty("--composer-height", height + "px");
      holder.hidden = true;
    }
  }, [filter, library.redraw]);
  useLayoutEffect(() => {
    if (composerExpanded) {
      floating.current?.scrollIntoView({ block: "end", behavior: "instant" });
    } else if (browseScroll.current !== undefined) {
      scrollTo({ top: browseScroll.current, behavior: "instant" });
      browseScroll.current = undefined;
    }
  }, [composerExpanded]);
  const images = filter.tab === "images";
  const groups = groupHistoryJobs(
    referencePicking
      ? visibleJobs.filter(
          (job) =>
            job.status === "done" &&
            state.assets.some(
              (asset) =>
                asset.id === job.result && (!asset.kind || asset.kind === "ref"),
            ),
        )
      : visibleJobs,
  );

  function checkbox(key: string, label: string) {
    if (referencePicking)
      return (
        <span className="reference-pick-check" aria-hidden="true">
          <Icon name="check" />
        </span>
      );
    return (
      <button
        className="asset-checkbox"
        hidden={!selecting}
        role="checkbox"
        aria-checked={keys.includes(key)}
        aria-label={"选择" + label}
        data-act="select-asset"
        data-key={key}
        onClick={() => library.toggle(key)}
      >
        <Icon name="check" />
      </button>
    );
  }

  return (
    <>
      <div
        className={`assets-view ${selecting ? "is-selecting" : ""} ${referencePicking ? "is-picking-reference" : ""}`}
        ref={surface}
      >
        <div className="asset-top">
          <div
            className="library-scopes"
            role="tablist"
            aria-label="资产视图"
            onKeyDown={moveFilterFocus}
          >
            {scopes.map(([scope, label]) => (
              <button
                key={scope}
                className={`top-tab ${filter.scope === scope ? "selected" : ""}`}
                role="tab"
                aria-selected={filter.scope === scope}
                tabIndex={filter.scope === scope ? 0 : -1}
                data-act="library-scope"
                data-value={scope}
                onClick={() => actions.filter({ ...filter, scope })}
              >
                {label}
              </button>
            ))}
          </div>
          <div id="selection-toolbar" key={library.redraw}>
            {referencePicking ? (
              <div className="reference-pick-toolbar">
                <span role="status">{`已添加 ${referencePicking.ids.size} 张图片`}</span>
                <button
                  className="primary"
                  data-act="finish-reference-picking"
                  onClick={referencePicking.finish}
                >
                  完成选择
                </button>
              </div>
            ) : selecting ? (
              <div className="bulk-toolbar" role="group" aria-label="批量操作">
                <button
                  className="select-all"
                  role="checkbox"
                  aria-label="全选当前分类"
                  aria-checked={
                    library.all ? true : library.count ? "mixed" : false
                  }
                  data-act="select-all"
                  disabled={!library.hasVisible}
                  onClick={library.selectAll}
                >
                  <span>{library.count > 0 && <Icon name="check" />}</span>全选
                </button>
                <span
                  className="selection-count"
                  aria-live="polite"
                >{`已选择 ${keys.length} 项内容`}</span>
                <div className="bulk-actions">
                  {pluginButtons}
                  <button
                    data-act="batch-delete"
                    disabled={!library.removable || !!activity}
                    title={
                      keys.length && !library.removable
                        ? "只能删除自己的已结束任务和素材"
                        : "删除"
                    }
                    onClick={actions.batchDelete}
                  >
                    <Icon name="trash" />
                    删除
                  </button>
                  <button
                    data-act="batch-download"
                    disabled={!library.downloadable || !!activity}
                    onClick={actions.batchDownload}
                  >
                    <Icon name="download" />
                    {activity === "download" ? "准备下载" : "下载"}
                  </button>
                  <button
                    data-act="batch-favorite"
                    disabled={!library.downloadable || !!activity}
                    onClick={actions.batchFavorite}
                  >
                    <Icon name="star" />
                    {library.allSaved ? "取消收藏" : "收藏"}
                  </button>
                </div>
                <button
                  className="cancel-select"
                  data-act="cancel-select"
                  disabled={!!activity}
                  onClick={library.reset}
                >
                  <Icon name="close" />
                  取消选择
                </button>
              </div>
            ) : (
              <>
                {importButton}
                <button
                  className="quiet-button"
                  data-act="start-select"
                  onClick={library.start}
                >
                  多选
                </button>
              </>
            )}
          </div>
        </div>
        <div
          className="asset-filter"
          role="tablist"
          aria-label="资产类型"
          onKeyDown={moveFilterFocus}
        >
          {filters
            .filter(([tab]) => !referencePicking || tab === "images")
            .map(([tab, label]) => (
              <button
                key={tab}
                role="tab"
                aria-selected={filter.tab === tab}
                tabIndex={filter.tab === tab ? 0 : -1}
                data-tab={tab}
                onClick={() => actions.filter({ ...filter, tab })}
              >
                {label}
              </button>
            ))}
        </div>
        <div id="library-grid" key={library.redraw + ":" + library.gridRevision}>
          {!groups.length &&
            !(library.uploadsVisible && visibleAssets.length) && (
              <div className="empty-state">
                {filter.scope === "favorites" ? "暂无收藏" : "暂无相关资产"}
              </div>
            )}
          {groups.map(({ label, jobs }) => (
            <JobGroup
              key={jobs[0].id}
              date={label}
              jobs={jobs}
              state={state}
              delta={delta}
              checkbox={checkbox}
              library={library}
              referencePicking={referencePicking}
              actions={actions}
            />
          ))}
          {library.uploadsVisible && visibleAssets.length > 0 && (
            <>
              <h2 className="asset-date">
                {images
                  ? "上传图片"
                  : filter.tab === "videos"
                    ? "上传视频"
                    : "上传音频"}
              </h2>
              <div className="asset-grid">
                {visibleAssets.map((asset) => (
                  <UploadCard
                    key={asset.id}
                    asset={asset}
                    images={images}
                    state={state}
                    library={library}
                    referencePicking={referencePicking}
                    checkbox={checkbox}
                    actions={actions}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div
        id="asset-composer"
        className={`floating-composer${referencePicking ? "" : " mobile-asset-composer"}`}
        data-expanded={composerExpanded}
        hidden={selecting}
        ref={floating}
      >
        {!referencePicking && (
          <button
            type="button"
            className="quiet-button asset-composer-toggle"
            aria-controls="asset-composer-panel"
            aria-expanded={composerExpanded}
            onClick={() => {
              if (!composerExpanded) browseScroll.current = scrollY;
              setComposerExpanded(!composerExpanded);
            }}
          >
            {composerExpanded ? "收起创作框" : "展开创作框"}
          </button>
        )}
        <div id="asset-composer-panel">{composer}</div>
      </div>
    </>
  );
}

function UploadCard({
  asset,
  images,
  state,
  library,
  referencePicking,
  checkbox,
  actions,
}: {
  asset: Asset;
  images: boolean;
  state: StudioState;
  library: ReturnType<typeof useLibrary>;
  referencePicking: ReferencePicking | null;
  checkbox: (key: string, label: string) => ReactNode;
  actions: LibraryActions;
}) {
  const key = "asset:" + asset.id;
  const saved = state.favorites.includes(key);
  const { selecting } = library;
  const referenceAdded = referencePicking?.ids.has(asset.id);
  const classes = useCardClasses(
    saved,
    library.keys.includes(key),
    false,
    !images,
    referenceAdded,
  );
  return (
    <article {...classes} data-asset-key={key}>
      {checkbox(key, images ? "图片 " + asset.id.slice(0, 6) : "参考素材")}
      <button
        className="asset-preview"
        data-act={images ? "image-detail" : "h3-preview"}
        data-key={asset.id}
        aria-label={
          referencePicking
            ? referenceAdded
              ? "已添加为参考图片"
              : "添加为参考图片"
            : selecting
              ? images
                ? "选择图片 " + asset.id.slice(0, 6)
                : "选择参考素材"
              : images
                ? "预览图片"
                : "预览参考素材"
        }
        aria-pressed={referenceAdded}
        onClick={(event) => {
          if (referencePicking) actions.use(asset.id);
          else if (selecting) library.toggle(key);
          else if (!images) actions.preview(asset.id, event.currentTarget);
          else actions.image(asset.id);
        }}
        onMouseEnter={selecting ? undefined : playPreview}
        onMouseLeave={pausePreview}
      >
        {images ? (
          <img loading="lazy" src={mediaURL(asset.id)} alt="参考图片" />
        ) : (
          <ReferenceMedia id={asset.id} kind={asset.kind} />
        )}
      </button>
      <div
        className="asset-actions"
        style={
          !images && selecting ? { display: "flex", opacity: 1 } : undefined
        }
      >
        {!images && (
          <button
            type="button"
            data-act="h3-preview"
            data-key={asset.id}
            title="预览"
            aria-label="预览参考素材"
            style={selecting ? { display: "grid" } : undefined}
            onClick={(event) => actions.preview(asset.id, event.currentTarget)}
          >
            <Icon name="play" />
          </button>
        )}
        {!selecting && (
          <>
            <button
              data-act="use"
              data-key={asset.id}
              title={images ? "用作参考图" : "用作参考"}
              onClick={() => actions.use(asset.id)}
            >
              <Icon name="plus" />
            </button>
            <Download id={asset.id} />
            <Favorite id={key} saved={saved} change={actions.favorite} />
          </>
        )}
      </div>
    </article>
  );
}

function JobGroup({
  date,
  jobs,
  state,
  delta,
  checkbox,
  library,
  referencePicking,
  actions,
}: {
  date: string;
  jobs: Job[];
  state: StudioState;
  delta: number;
  checkbox: (key: string, label: string) => ReactNode;
  library: ReturnType<typeof useLibrary>;
  referencePicking: ReferencePicking | null;
  actions: {
    use: (id: string) => void;
    favorite: (key: string, saved: boolean) => void;
    edit: (id: number) => void;
    job: (id: number) => void;
  };
}) {
  return (
    <>
      <h2 className="asset-date">{date}</h2>
      <div className="asset-grid">
        {jobs.map((job) => {
          const key = "job:" + job.id;
          return (
            <JobCard
              key={job.id}
              job={job}
              state={state}
              delta={delta}
              selecting={library.selecting}
              selected={library.keys.includes(key)}
              selection={
                canSelect(job) && checkbox(key, kindLabel(job) + " #" + job.id)
              }
              highlight={library.highlight === job.id}
              referenceAdded={referencePicking?.ids.has(job.result!)}
              favorite={actions.favorite}
              edit={actions.edit}
              detail={
                referencePicking
                  ? () => actions.use(job.result!)
                  : library.selecting
                    ? () => library.toggle(key)
                    : actions.job
              }
            />
          );
        })}
      </div>
    </>
  );
}
