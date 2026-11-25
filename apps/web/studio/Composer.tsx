import { ParameterFields } from "./ParameterFields";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
  type RefObject,
  type ReactNode,
} from "react";
import { Chevron, Icon } from "./Icon";
import { estimateTime } from "./History";
import { ReferenceMedia } from "./AssetMedia";
import type { ComposerMenu } from "./ComposerMenu";
import {
  appendAtCaret,
  createReferenceToken,
  paintPrompt,
  readPrompt,
  rememberSelection,
} from "./prompt";
import { label as modelLabel } from "../canvas-editor/flowPicker";
import {
  estimateBody,
  activeReferences,
  composerFeedback,
  creationOptions,
  flowSpec,
  frames,
  h3Options,
  imageQualityLabels,
  isH3,
  modelForm,
  modelAvailable,
  packReferences,
  referenceAsset,
  referenceLabel,
  selectedModel,
  type FrameSlot,
  quote,
  type DraftSession,
  type StudioState,
} from "./state";

const imageAccept =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,image/avif,image/tiff,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif";

type Estimate = {
  duration?: {
    high?: number;
    median?: number;
    samples?: number;
    source?: string;
  };
};
export type RequestEstimate = (
  body: ReturnType<typeof estimateBody>,
) => Promise<Estimate>;

export function useEstimate(
  state: StudioState | null,
  session: DraftSession | null,
  request: RequestEstimate,
) {
  const [estimate, setEstimate] = useState<Estimate>();
  const [revision, setRevision] = useState(0);
  const body =
    state &&
    session &&
    modelAvailable(state, selectedModel(session.draft)) &&
    (session.draft.kind !== "audio" || session.draft.prompt.trim())
      ? estimateBody(state, session)
      : null;
  const serialized = body && JSON.stringify(body);
  const requestKey =
    serialized && state
      ? `${state.me.id}/${state.workspace_id}/${serialized}`
      : null;
  const key = useRef<string | null>(null);
  useEffect(() => {
    if (!requestKey || !serialized) {
      if (key.current) setEstimate(undefined);
      key.current = null;
      return;
    }
    if (key.current !== requestKey) setEstimate(undefined);
    key.current = requestKey;
    let live = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await request(JSON.parse(serialized));
          if (live) setEstimate(result);
        } catch {
          if (live) setEstimate(undefined);
        }
      })();
    }, 220);
    const repeat = window.setTimeout(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 18_000);
    const resume = () => {
      if (!document.hidden && performance.now() - started > 18_000)
        setRevision((value) => value + 1);
    };
    const started = performance.now();
    document.addEventListener("visibilitychange", resume);
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(repeat);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [request, requestKey, serialized, revision]);
  return key.current === requestKey ? estimate : undefined;
}

export type ComposerEditor = {
  remember: () => void;
  insert: (id: string) => void;
  reindex: (refs: string[]) => string;
};

export type ReferenceDisplay = { controls: ReactNode; busy: boolean };
export type FlowSourceDisplay = {
  jobs: StudioState["jobs"];
  selected: number | null;
};

export function Composer({
  state, managePlugins,
  session,
  estimate,
  submitting,
  uploading,
  change,
  update,
  submit,
  upload,
  menu,
  open,
  close,
  preview,
  editor,
  seenMenus,
  referenceContents,
  flowSourceContents,
}: {
  state: StudioState;
  session: DraftSession;
  estimate: Estimate | undefined;
  submitting: boolean;
  uploading: boolean;
  change: (prompt: string) => void;
  update: (session: DraftSession) => void;
  submit: () => void;
  upload: (files: FileList, frame?: FrameSlot) => void;
  menu: ComposerMenu | null;
  open: (kind: ComposerMenu, button: HTMLButtonElement, focus?: boolean) => void;
  close: () => void;
  preview: (id: string, button: HTMLButtonElement) => void;
  editor: Ref<ComposerEditor>;
  seenMenus: ReadonlySet<ComposerMenu>;
  referenceContents: RefObject<ReferenceDisplay | null>;
  flowSourceContents: RefObject<FlowSourceDisplay | null>;
  managePlugins: () => void;
}) {
  const { draft } = session;
  const box = useRef<HTMLElement>(null);
  const prompt = useRef<HTMLDivElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const frameSlot = useRef<FrameSlot | undefined>(undefined);
  const painted = useRef<{
    plain: boolean;
    refsKey: string;
    prompt: string;
    serialized: string;
  } | null>(null);

  const [dragging, setDragging] = useState(false);
  const model = selectedModel(draft);
  const h3 = isH3(draft);
  const image = draft.kind === "image";
  const audio = draft.kind === "audio";
  const form = modelForm(state, draft);
  const muse = form?.nativeResolution;
  const flow = flowSpec(state, model);
  const fixed = !!flow && !flow.family;
  const frameMode = frames(draft);
  const plainPrompt = frameMode || audio;
  const frameOptions = h3Options(draft.h3);
  const references = useMemo(() => packReferences(session), [session]);
  const price = quote(state, draft);
  const available = modelAvailable(state, model);
  const { status, submitReason } = composerFeedback(state, session, {
    uploading,
    submitting,
  });
  const ratio = audio
    ? ""
    : frameMode && activeReferences(session).length
      ? "自动"
      : draft.ratio;
  const sizes =
    audio || muse || flow
      ? [0, 0]
      : image
        ? state.images.sizes?.[draft.ratio]
        : state.sizes[draft.ratio];
  const sizeOffset = image
    ? draft.resolution === "2K"
      ? 2
      : 0
    : draft.quality === "480"
      ? 0
      : 2;
  const size =
    audio || muse || flow
      ? [0, 0]
      : (sizes?.slice(sizeOffset, sizeOffset + 2) ?? []);
  const title = flow?.family
    ? "选择生成方式和比例"
    : flow
      ? "该模型的固定规格"
      : muse
        ? "原生分辨率"
        : `${size[0]} × ${size[1]}`;
  const quality = audio
    ? ""
    : flow
      ? flow.resolution
      : muse
        ? "原生"
        : image
          ? draft.resolution
          : draft.quality + "P";
  const modelName = model ? modelLabel(state.model_catalog, model) : "暂无可用模型";
  const [, creation, creationIcon] = creationOptions.find(
    ([kind]) => kind === draft.kind,
  )!;
  const durationName = audio
    ? "音色描述"
    : image
      ? "选择图片质量"
      : "选择视频生成时长";
  const duration = estimate?.duration;
  const estimateLabel = duration?.high
    ? (duration.source === "legacy" ? "历史参考总耗时约 " : "约 ") +
      estimateTime(duration.median ?? duration.high)
    : estimate
      ? "观测中"
      : "";
  const hint = duration?.samples
    ? `参考 ${duration.samples} 条相近记录${duration.source === "legacy" ? "，历史记录包含排队时间" : ""}`
    : "";

  useLayoutEffect(() => {
    const element = prompt.current!;
    const refsKey = references.join("\0");
    const current = readPrompt(element, state, references, plainPrompt);
    const staleChip =
      !plainPrompt &&
      Array.from(element.querySelectorAll<HTMLElement>("[data-refid]")).some(
        (chip) => {
          const id = chip.dataset.refid!;
          return (
            !references.includes(id) ||
            chip.lastElementChild?.textContent !==
              referenceLabel(state, id, references)
          );
        },
      );
    const samePainted =
      painted.current?.plain === plainPrompt &&
      painted.current?.refsKey === refsKey &&
      painted.current?.prompt === draft.prompt &&
      painted.current?.serialized === current;
    if (
      painted.current?.plain !== plainPrompt ||
      staleChip ||
      (current !== draft.prompt && !samePainted)
    ) {
      paintPrompt(element, state, references, draft.prompt, plainPrompt);
      savedRange.current = null;
      painted.current = {
        plain: plainPrompt,
        refsKey,
        prompt: draft.prompt,
        serialized: readPrompt(element, state, references, plainPrompt),
      };
    }
  }, [state, references, draft.prompt, plainPrompt]);

  useLayoutEffect(() => {
    const composer = box.current!;
    const shell = composer.closest<HTMLElement>(".shell");
    const resize = () => {
      const height = Math.ceil(composer.getBoundingClientRect().height);
      shell?.style.setProperty("--composer-height", `${height}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(composer);
    const input = files.current!;
    const cancel = () => {
      frameSlot.current = undefined;
    };
    input.addEventListener("cancel", cancel);
    return () => {
      observer.disconnect();
      input.removeEventListener("cancel", cancel);
    };
  }, []);

  function remember() {
    savedRange.current = rememberSelection(prompt.current!, savedRange.current);
  }
  function savePrompt() {
    change(readPrompt(prompt.current!, state, references, plainPrompt));
    remember();
  }
  useImperativeHandle(editor, () => ({
    remember,
    reindex(next) {
      const element = prompt.current!;
      for (const chip of element.querySelectorAll<HTMLElement>(
        "[data-refid]",
      )) {
        const id = chip.dataset.refid!;
        if (!plainPrompt && next.includes(id))
          chip.lastElementChild!.textContent = referenceLabel(state, id, next);
        else chip.remove();
      }
      return readPrompt(element, state, next, plainPrompt);
    },
    insert(id) {
      if (plainPrompt || !references.includes(id)) return;
      const range = savedRange.current;
      if (
        range?.collapsed &&
        range.startContainer.nodeType === Node.TEXT_NODE &&
        range.startContainer.textContent?.[range.startOffset - 1] === "@"
      )
        range.setStart(range.startContainer, range.startOffset - 1);
      savedRange.current = appendAtCaret(
        prompt.current!,
        createReferenceToken(state, references, id),
        range,
      );
      savedRange.current = appendAtCaret(
        prompt.current!,
        document.createTextNode(" "),
        savedRange.current,
      );
      savePrompt();
    },
  }));

  function h3Frame(slot: FrameSlot, label: string) {
    const id = frameOptions[slot];
    return (
      <div className="h3-frame">
        <button
          className="h3-frame-preview"
          data-act={id ? "h3-preview" : "h3-upload"}
          data-slot={slot}
          data-key={id || ""}
          aria-label={(id ? "预览" : "上传") + label}
          onClick={(event) => {
            if (id) preview(id, event.currentTarget);
            else {
              frameSlot.current = slot;
              files.current?.click();
            }
          }}
        >
          {id ? (
            <ReferenceMedia id={id} kind={referenceAsset(state, id)?.kind} />
          ) : (
            <Icon name="plus" />
          )}
          <span>{label}</span>
        </button>
        {id && (
          <button
            className="h3-remove"
            data-act="h3-remove-frame"
            data-slot={slot}
            aria-label={"移除" + label}
            onClick={() =>
              update({
                ...session,
                draft: { ...draft, h3: { ...frameOptions, [slot]: null } },
              })
            }
          >
            <Icon name="close" />
          </button>
        )}
      </div>
    );
  }

  const layers = references.slice(0, 3).reverse();
  const extending = flow?.mode === "extend";
  const source = extending
    ? {
        selected: draft.flowSourceJob ?? null,
        jobs: state.jobs.filter(
          (job) =>
            job.kind === "video" &&
            job.status === "done" &&
            flowSpec(state, job.model) &&
            job.actual?.flow_media_id &&
            job.ratio === flow.ratio,
        ),
      }
    : flowSourceContents.current;
  const opener =
    (kind: ComposerMenu) => (event: React.MouseEvent<HTMLButtonElement>) => {
      remember();
      open(kind, event.currentTarget);
    };
  const referenceControls = frameMode ? (
    <div className="h3-frame-pair">
      {h3Frame("first_frame", "首帧")}
      <button
        className="h3-swap icon-button"
        data-act="h3-swap"
        aria-label="交换首尾帧"
        disabled={!frameOptions.first_frame && !frameOptions.last_frame}
        onClick={() =>
          update({
            ...session,
            draft: {
              ...draft,
              h3: {
                ...frameOptions,
                first_frame: frameOptions.last_frame,
                last_frame: frameOptions.first_frame,
              },
            },
          })
        }
      >
        <Icon name="switch" />
      </button>
      {h3Frame("last_frame", "尾帧")}
    </div>
  ) : (
    <button
      className="reference-deck"
      data-act="reference"
      aria-label={
        references.length
          ? `管理参考内容，已添加 ${references.length} 个素材`
          : "添加参考内容"
      }
      aria-haspopup="dialog"
      aria-expanded={menu === "references"}
      title={
        references.length
          ? `已添加 ${references.length} 个素材，点击管理`
          : undefined
      }
      onClick={opener("references")}
    >
      {layers.length ? (
        <>
          {layers.map((id, index) => (
            <span
              key={id}
              className="reference-layer"
              ref={(element) =>
                element?.setAttribute(
                  "style",
                  "--depth:" + (layers.length - index - 1),
                )
              }
              aria-hidden="true"
            >
              <ReferenceMedia id={id} kind={referenceAsset(state, id)?.kind} />
              {index === layers.length - 1 && (
                <span className="reference-layer-label">参考内容</span>
              )}
            </span>
          ))}
          <span className="reference-deck-count" aria-hidden="true">
            {references.length}
          </span>
        </>
      ) : (
        <span className="reference-deck-empty">
          <Icon name="plus" />
          <small>参考内容</small>
        </span>
      )}
    </button>
  );
  // The original leaves hidden controls in the shared composer across views.
  useLayoutEffect(() => {
    if (!audio)
      referenceContents.current = {
        controls: referenceControls,
        busy: uploading,
      };
    if (extending) flowSourceContents.current = source;
  });
  return (
    <section
      className={`composer${audio ? " audio-composer" : ""}${dragging ? " dragging" : ""}`}
      aria-label="生成"
      ref={box}
      onPointerDownCapture={remember}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setDragging(false);
        if (!audio) upload(event.dataTransfer.files);
      }}
    >
      <div className="editor-row">
        <div
          className={`composer-references${frameMode ? " has-frames" : ""}`}
          aria-label="参考素材"
          aria-busy={audio ? referenceContents.current?.busy : uploading}
          hidden={
            audio ||
            (form?.parameterObject &&
              !form.references.max &&
              !references.length)
          }
        >
          {audio ? referenceContents.current?.controls : referenceControls}
        </div>
        <div
          id="prompt"
          className="prompt"
          ref={prompt}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="提示词"
          aria-multiline="true"
          data-placeholder={
            frameMode
              ? "描述画面的运动与首尾帧之间的过渡"
              : h3
                ? "添加图片、视频或音频，输入 @ 引用参考内容"
                : audio
                  ? "输入要朗读的文字，最多 300 字"
                  : `描述你想生成的${image ? "图片" : "视频"}，输入文字或 @ 参考内容`
          }
          onInput={savePrompt}
          onKeyUp={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              event.key === "@" &&
              references.length &&
              !frameMode &&
              !audio &&
              form?.references.max !== 0
            ) {
              remember();
              open(
                "mention",
                box.current!.querySelector('[data-menu="mention"]')!,
                false,
              );
            }
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              menu === "mention" &&
              ["ArrowDown", "ArrowUp"].includes(event.key)
            ) {
              event.preventDefault();
              const entries = document.querySelectorAll<HTMLElement>(
                "#popover .ref-entry",
              );
              entries[
                event.key === "ArrowDown" ? 0 : entries.length - 1
              ]?.focus();
            } else if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape" && menu) {
              event.stopPropagation();
              close();
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            if (event.clipboardData.files.length) {
              if (!audio) upload(event.clipboardData.files);
              return;
            }
            remember();
            savedRange.current = appendAtCaret(
              event.currentTarget,
              document.createTextNode(
                event.clipboardData.getData("text/plain"),
              ),
              savedRange.current,
            );
            savePrompt();
          }}
        />
        <input
          className="hide"
          id="files"
          ref={files}
          type="file"
          accept={
            imageAccept +
            (h3 && !frameMode
              ? ",video/mp4,video/webm,video/quicktime,audio/*"
              : "")
          }
          multiple={!frameMode}
          onChange={(event) => {
            if (event.currentTarget.files)
              upload(event.currentTarget.files, frameSlot.current);
            frameSlot.current = undefined;
            event.currentTarget.value = "";
          }}
        />
      </div>
      <div className="composer-toolbar">
        <div className="composer-parameters">
          <button
            className="creation-type parameter-button"
            data-menu="creation"
            aria-label="创作类型"
            aria-expanded={menu === "creation"}
            onClick={opener("creation")}
          >
            <Icon name={creationIcon} />
            <span>{creation}</span>
            <Chevron />
          </button>
          {state.studio_plugins && !Object.entries(state.model_catalog).some(([id,m])=>!m.hidden && state.model_access?.[id]) && (
            state.me.role === "admin"
              ? <button className="parameter-button" onClick={managePlugins}>去导入插件</button>
              : <span>请联系管理员开通模型</span>
          )}
          <button
            className={`model-name parameter-button${available ? "" : " model-unavailable"}`}
            data-menu="image-model"
            aria-label={"选择模型，当前" + modelName}
            aria-expanded={menu === "image-model"}
            disabled={!model}
            onClick={opener("image-model")}
          >
            <Icon name="model" />
            <span>{modelName}{state.studio_plugins && model && !available ? "（已停用）" : ""}</span>
            <Chevron />
          </button>
          {form?.parameterObject && (
            <ParameterFields
              form={form}
              values={draft.params ?? {}}
              change={(params) =>
                update({ ...session, draft: { ...draft, params } })
              }
            />
          )}
          <button
            className="parameter-button h3-mode-control"
            data-menu="h3-mode"
            aria-label="选择参考模式"
            aria-expanded={menu === "h3-mode"}
            hidden={!form?.referenceModes || form.referenceModes.length < 2}
            disabled={uploading}
            onClick={opener("h3-mode")}
          >
            <Icon name={frameMode ? "film" : "link"} />
            <span>{frameMode ? "首尾帧" : "全能参考"}</span>
            <Chevron />
          </button>
          <button
            className={`parameter-button${fixed ? " fixed-parameter" : ""}`}
            data-menu="format"
            aria-expanded={menu === "format"}
            aria-label="选择比例和分辨率"
            title={title}
            hidden={audio || !!form?.parameterObject}
            disabled={fixed}
            onClick={opener("format")}
          >
            <Icon name="frame" />
            <span>{ratio}</span>
            <span className="quality-label">{quality}</span>
          </button>
          <button
            className={`parameter-button${fixed ? " fixed-parameter" : ""}`}
            data-menu="duration"
            aria-expanded={menu === "duration"}
            aria-label={durationName}
            hidden={
              !!form?.parameterObject || (image && !form?.fields.image_quality)
            }
            disabled={fixed}
            onClick={opener("duration")}
          >
            <Icon name={audio || image ? "sliders" : "clock"} />
            <span>
              {audio
                ? durationName
                : image
                  ? imageQualityLabels[
                      draft.imageQuality as keyof typeof imageQualityLabels
                    ]
                  : draft.seconds + "s"}
            </span>
            {(audio || image) && <Chevron />}
          </button>
        </div>
        <div className="composer-actions">
          <div className="composer-utilities">
            <button
              className="parameter-button only-icon"
              data-menu="mention"
              aria-label="引用参考"
              aria-expanded={
                seenMenus.has("mention") ? menu === "mention" : undefined
              }
              hidden={audio || frameMode || form?.references.max === 0}
              onClick={opener("mention")}
            >
              <Icon name="at" />
            </button>
            <button
              className="parameter-button only-icon"
              data-menu="advanced"
              aria-label="更多设置"
              aria-expanded={
                seenMenus.has("advanced") ? menu === "advanced" : undefined
              }
              hidden={!!form?.parameterObject || !form?.fields.seed}
              onClick={opener("advanced")}
            >
              <Icon name="sliders" />
            </button>
          </div>
          <span className="submit-controls">
            <span
              className="composer-credit fm-number"
              aria-label={model ? price.label : ""}
              title={
                model
                  ? `${price.label}；当前空间可用 ${price.available} 积分`
                  : undefined
              }
            >
              {model &&
                (price.amount === undefined ? (
                  "未定价"
                ) : (
                  <>
                    <svg
                      className="credit-spark"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M12 2C13.4 8.7 15.3 10.6 22 12C15.3 13.4 13.4 15.3 12 22C10.6 15.3 8.7 13.4 2 12C8.7 10.6 10.6 8.7 12 2Z" />
                    </svg>
                    <span>{price.amount}</span>
                  </>
                ))}
            </span>
            <span className="composer-estimate fm-number" aria-live="polite" title={hint}>
              {estimateLabel}
            </span>
            <button
              className={`generate-button${submitting ? " working" : ""}`}
              data-act="submit"
              aria-label={submitReason ? `生成（${submitReason}）` : "生成"}
              title={submitReason || "生成"}
              disabled={!!submitReason}
              aria-busy={submitting}
              onClick={submit}
            >
              <Icon name="arrow" />
            </button>
          </span>
        </div>
      </div>
      <div className="flow-source" hidden={!extending}>
        {source && (
          <label>
            来源视频
            <select
              aria-label="续写来源视频"
              value={source.selected ?? ""}
              onChange={(event) =>
                update({
                  ...session,
                  draft: {
                    ...draft,
                    flowSourceJob: Number(event.currentTarget.value) || null,
                  },
                })
              }
            >
              <option value="">请选择已完成的 Flow 视频</option>
              {source.jobs.map((job) => (
                <option
                  key={job.id}
                  value={job.id}
                >{`#${job.id} · ${job.prompt.slice(0, 42)}`}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="composer-status" aria-live="polite">
        {status && <span className="fm-state-change" key={status}>{status}</span>}
      </div>
    </section>
  );
}
