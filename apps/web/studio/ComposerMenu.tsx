import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as FlowPicker from "../../../legacy/pure/canvas/src/flowPicker";
import { ReferenceMedia } from "./AssetMedia";
import { Icon } from "./Icon";
import {
  activeReferences,
  changeFlow,
  changeH3Mode,
  chooseModel,
  creationOptions,
  flowSpec,
  frames,
  h3Options,
  imageQualityLabels,
  isH3,
  isMuseDraft,
  modelAvailable,
  modelsForKind,
  normalizeParams,
  packReferences,
  referenceAsset,
  referenceLabel,
  selectedModel,
  standardSteps,
  videoDurations,
  type Draft,
  type DraftSession,
  type StudioState,
} from "./state";

export type ComposerMenu =
  | "creation"
  | "image-model"
  | "h3-mode"
  | "format"
  | "duration"
  | "advanced"
  | "mention"
  | "references";

const labels = {
  creation: "创作类型",
  "image-model": "选择模型",
  "h3-mode": "选择参考模式",
  advanced: "更多设置",
  mention: "参考内容",
  references: "参考内容",
};
export function composerMenuLabel(
  kind: ComposerMenu,
  state: StudioState,
  draft: Draft,
) {
  if (kind === "duration")
    return draft.kind === "audio"
      ? "音色描述"
      : draft.kind === "image"
        ? "选择图片质量"
        : "选择视频生成时长";
  if (kind === "format")
    return flowSpec(state, selectedModel(draft))?.family
      ? "选择生成方式和比例"
      : isMuseDraft(draft)
        ? "选择比例"
        : "选择比例和分辨率";
  return labels[kind];
}

function Option({
  action,
  value,
  label,
  selected,
  pick,
  title,
  icon,
  hidden,
  duration,
}: {
  action: string;
  value: string;
  label: string;
  selected: boolean;
  pick: () => void;
  title?: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  hidden?: boolean;
  duration?: boolean;
}) {
  return (
    <button
      type={duration ? "button" : undefined}
      role="option"
      aria-selected={selected}
      tabIndex={duration ? (selected ? 0 : -1) : undefined}
      data-act={action}
      data-value={value}
      title={title}
      hidden={hidden}
      onClick={pick}
    >
      {icon && <Icon name={icon} />}
      <span>{label}</span>
      {selected && <Icon name="check" />}
    </button>
  );
}

function Radio({
  action,
  value,
  current,
  pick,
  children,
  disabled,
}: {
  action: string;
  value: string;
  current?: string;
  pick: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const checked = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      data-act={action}
      data-value={value}
      onClick={pick}
      disabled={disabled}
    >
      {children ?? value}
    </button>
  );
}

function Advanced({
  session,
  save,
  notify,
  reposition,
}: {
  session: DraftSession;
  save: (patch: Partial<Draft>, focus?: boolean) => void;
  notify: (message: string) => void;
  reposition: () => void;
}) {
  const { draft, retainedSeed } = session;
  const [fast, setFast] = useState(draft.fast_mode);
  const [steps, setSteps] = useState(standardSteps(draft.sampling_steps));
  const seed = useRef<HTMLInputElement>(null);
  useLayoutEffect(reposition, [fast, reposition]);
  return (
    <>
      <div className="popover-label">更多设置</div>
      {isH3(draft) && (
        <>
          <div className="advanced-mode-row">
            <span>快速模式</span>
            <label className="model-switch">
              <input
                id="fast-mode"
                type="checkbox"
                role="switch"
                aria-label="快速模式"
                checked={fast}
                onChange={(event) => setFast(event.currentTarget.checked)}
              />
              <span aria-hidden="true"></span>
            </label>
          </div>
          <div data-standard-sampling="" hidden={fast}>
            <div className="popover-label">采样步数</div>
            <div
              className="quality-options sampling-options"
              role="radiogroup"
              aria-label="采样步数"
              data-value={steps}
            >
              {[16, 20, 32, 50].map((value) => (
                <Radio
                  action="sampling-steps"
                  key={value}
                  value={String(value)}
                  current={String(steps)}
                  pick={() => setSteps(value)}
                />
              ))}
            </div>
          </div>
        </>
      )}
      <label className="formlabel">
        <input
          ref={seed}
          id="seed"
          aria-label="随机种子"
          inputMode="numeric"
          defaultValue={draft.seed}
          placeholder="随机种子"
        />
      </label>
      {retainedSeed !== null && (
        <label className="check">
          <input
            id="reuse-seed"
            type="checkbox"
            onChange={(event) => {
              seed.current!.value = event.currentTarget.checked
                ? String(retainedSeed)
                : "";
            }}
          />
          沿用原种子
        </label>
      )}
      <button
        className="primary"
        data-act="save-seed"
        onClick={() => {
          const value = seed.current!.value.trim();
          if (
            value &&
            (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          ) {
            notify("请输入有效的非负整数");
            return;
          }
          save({ seed: value, fast_mode: fast, sampling_steps: steps }, false);
        }}
      >
        确定
      </button>
    </>
  );
}

export function ComposerMenuContents({
  kind,
  state,
  session,
  uploading,
  update,
  close,
  preview,
  insert,
  changeRefs,
  pickAssets,
  openPacks,
  notify,
  reposition,
}: {
  kind: ComposerMenu;
  state: StudioState;
  session: DraftSession;
  uploading: boolean;
  update: (session: DraftSession) => void;
  close: (focus?: boolean) => void;
  preview: (id: string) => void;
  insert: (id: string) => void;
  changeRefs: (refs: string[], removed?: string) => void;
  pickAssets: () => void;
  openPacks: () => void;
  notify: (message: string) => void;
  reposition: () => void;
}) {
  const { draft, refs } = session;
  const model = selectedModel(draft);
  const flow = flowSpec(state, model);
  const image = draft.kind === "image";
  const audio = draft.kind === "audio";
  const h3 = isH3(draft);
  const muse = isMuseDraft(draft);
  const [search, setSearch] = useState("");
  const voice = useRef<HTMLTextAreaElement>(null);
  const dragged = useRef<string | null>(null);
  const available = (id: string) => modelAvailable(state, id);
  const flowOptions = flow?.family
    ? FlowPicker.options(state.model_catalog, model, available)
    : null;
  const patch = (values: Partial<Draft>) =>
    update({ ...session, draft: { ...draft, ...values } });
  function save(values: Partial<Draft>, focus = true) {
    patch(values);
    close(focus);
  }
  switch (kind) {
    case "creation":
      return (
        <div className="choice-list" role="listbox" aria-label="创作类型">
          {creationOptions.map(([value, label, icon]) => (
            <Option
              key={value}
              action="creation"
              value={value}
              label={label}
              icon={icon}
              selected={draft.kind === value}
              pick={() => {
                if (uploading) return;
                const saved = value === "image" && session.suspendedImageDraft;
                if (saved) {
                  update({
                    ...saved,
                    suspendedImageDraft: null,
                    refs: saved.refs.filter((id) => referenceAsset(state, id)),
                    parent: state.jobs.some((job) => job.id === saved.parent)
                      ? saved.parent
                      : null,
                  });
                } else {
                  const changed = ensureCreation(state, draft, value);
                  update({
                    ...session,
                    draft: changed,
                    parent: null,
                    retainedSeed: null,
                  });
                }
                close(true);
              }}
            />
          ))}
        </div>
      );
    case "image-model": {
      const grouped = FlowPicker.grouped(
        modelsForKind(state, draft.kind),
        state.model_catalog,
        available,
        model,
        { ratio: draft.ratio, seconds: Number(draft.seconds) },
      );
      const filter = search.trim().toLowerCase();
      return (
        <>
          {grouped.length > 12 && (
            <input
              className="model-search"
              data-model-search=""
              aria-label="搜索模型"
              placeholder="搜索模型"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          )}
          <div
            className="choice-list flow-model-options"
            role="listbox"
            aria-label="选择模型"
          >
            {grouped.map(([value, label]) => (
              <Option
                key={value}
                action="image-model"
                value={value}
                label={label}
                title={label}
                hidden={!label.toLowerCase().includes(filter)}
                selected={FlowPicker.sameFamily(
                  state.model_catalog,
                  model,
                  value,
                )}
                pick={() => {
                  if (uploading || !available(value)) return;
                  update({
                    ...session,
                    draft: normalizeParams(state, chooseModel(draft, value)),
                  });
                  close(true);
                }}
              />
            ))}
          </div>
          <p
            className="model-search-empty"
            hidden={
              grouped.length <= 12 ||
              grouped.some(([, label]) => label.toLowerCase().includes(filter))
            }
          >
            没有匹配的模型
          </p>
        </>
      );
    }
    case "h3-mode":
      return (
        <div className="choice-list" role="listbox" aria-label="参考模式">
          {(
            [
              ["reference", "全能参考", "link"],
              ["frames", "首尾帧", "film"],
            ] as const
          ).map(([value, label, icon]) => (
            <Option
              key={value}
              action="h3-mode"
              value={value}
              label={label}
              icon={icon}
              selected={h3Options(draft.h3).mode === value}
              pick={() => {
                if (uploading || value === h3Options(draft.h3).mode) return;
                update(changeH3Mode(state, session, value));
                close(true);
              }}
            />
          ))}
        </div>
      );
    case "format": {
      const ratios =
        flowOptions?.ratios ??
        (muse
          ? image
            ? ["1:1", "16:9", "9:16", "4:3", "3:4"]
            : ["16:9", "9:16"]
          : ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
      const auto = frames(draft) && activeReferences(session).length > 0;
      return (
        <Fragment key={session.submitId}>
          {flowOptions && flowOptions.modes.length > 1 && (
            <>
              <div className="popover-label">生成方式</div>
              <div
                className="quality-options"
                role="radiogroup"
                aria-label="生成方式"
              >
                {flowOptions.modes.map((value) => (
                  <Radio
                    key={value}
                    action="flow-mode"
                    value={value}
                    current={flow?.mode}
                    pick={() => {
                      const changed = changeFlow(state, draft, { mode: value });
                      if (changed) update({ ...session, draft: changed });
                    }}
                  >
                    {FlowPicker.modeLabels[value]}
                  </Radio>
                ))}
              </div>
            </>
          )}
          <div className="popover-label">
            {auto ? "按图片自动匹配比例" : "选择比例"}
          </div>
          <div
            className="ratio-options"
            ref={(element) =>
              element?.setAttribute(
                "style",
                `grid-template-columns:repeat(${ratios.length},1fr)`,
              )
            }
            role="radiogroup"
            aria-label="选择比例"
          >
            {ratios.map((value) => (
              <Radio
                key={value}
                action="ratio"
                value={value}
                current={draft.ratio}
                disabled={auto}
                pick={() =>
                  update({
                    ...session,
                    draft: changeFlow(state, draft, { ratio: value }) ?? {
                      ...draft,
                      ratio: value,
                    },
                  })
                }
              >
                <span
                  className="ratio-glyph"
                  ref={(element) =>
                    element?.setAttribute(
                      "style",
                      "--ratio:" + value.replace(":", "/"),
                    )
                  }
                ></span>
                <span>{value}</span>
              </Radio>
            ))}
          </div>
          {!muse && !flowOptions && (
            <>
              <div className="popover-label resolution-label">选择分辨率</div>
              <div
                className="quality-options"
                role="radiogroup"
                aria-label="选择分辨率"
              >
                {(image ? ["1K", "2K"] : ["480", "768"]).map((value) => (
                  <Radio
                    key={value}
                    action={image ? "resolution" : "quality"}
                    value={value}
                    current={image ? draft.resolution : String(draft.quality)}
                    pick={() =>
                      patch(image ? { resolution: value } : { quality: value })
                    }
                  >
                    {image ? value : value + "P"}
                  </Radio>
                ))}
              </div>
            </>
          )}
        </Fragment>
      );
    }
    case "duration":
      if (audio)
        return (
          <>
            <div className="popover-label">音色描述</div>
            <label className="formlabel">
              <textarea
                id="voice-description"
                rows={4}
                maxLength={300}
                aria-label="音色描述"
                placeholder="例如：温柔自然的女声，语速舒缓，使用普通话"
                ref={voice}
                defaultValue={draft.voiceDescription}
              />
            </label>
            <button
              className="primary"
              data-act="save-voice"
              onClick={() =>
                save({ voiceDescription: voice.current!.value.trim() })
              }
            >
              确定
            </button>
          </>
        );
      if (image)
        return (
          <>
            <div className="popover-label">选择质量</div>
            <div
              className="choice-list"
              role="listbox"
              aria-label="选择图片质量"
            >
              {Object.entries(imageQualityLabels).map(([value, label]) => (
                <Option
                  key={value}
                  action="image-quality"
                  value={value}
                  label={label}
                  selected={draft.imageQuality === value}
                  pick={() => save({ imageQuality: value })}
                />
              ))}
            </div>
          </>
        );
      return (
        <>
          <div className="popover-label">选择时长</div>
          <div
            className="duration-options"
            role="listbox"
            aria-label="选择视频生成时长"
          >
            {(flowOptions?.seconds.map(String) ?? videoDurations(draft)).map(
              (value) => (
                <Option
                  key={value}
                  action="seconds"
                  value={value}
                  label={value + "s"}
                  selected={String(draft.seconds) === value}
                  duration
                  pick={() => {
                    update({
                      ...session,
                      draft: changeFlow(state, draft, {
                        seconds: Number(value),
                      }) ?? { ...draft, seconds: value },
                    });
                    close(true);
                  }}
                />
              ),
            )}
          </div>
        </>
      );
    case "advanced":
      return (
        <Advanced
          session={session}
          save={save}
          notify={notify}
          reposition={reposition}
        />
      );
    case "mention":
    case "references": {
      const manage = kind === "references";
      const selected = manage ? packReferences(session) : refs;
      function moveReference(id: string, index: number) {
        const from = refs.indexOf(id);
        if (from < 0 || index < 0 || from === index) return;
        const moved = [...refs];
        moved.splice(index, 0, ...moved.splice(from, 1));
        changeRefs(moved);
      }
      return (
        <>
          <div className="popover-label">
            参考内容<span>{`${selected.length}/${h3 ? 12 : 9}`}</span>
          </div>
          {selected.length ? (
            <div className="reference-list">
              {selected.map((id) => {
                const direct = refs.includes(id);
                const asset = referenceAsset(state, id);
                const label = direct
                  ? referenceLabel(state, id, refs)
                  : "素材包图片";
                const options = h3Options(draft.h3);
                return (
                  <Fragment key={id}>
                    <div
                      className="reference-row"
                      draggable={manage && direct}
                      data-ref={id}
                      onDragStart={() => {
                        dragged.current = direct ? id : null;
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                      }}
                      onDragOver={(event) => {
                        if (dragged.current && direct) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!dragged.current || !direct) return;
                        event.preventDefault();
                        moveReference(dragged.current, refs.indexOf(id));
                        dragged.current = null;
                      }}
                    >
                      <button
                        data-act={manage ? "h3-preview" : "mention"}
                        data-key={id}
                        className="ref-entry"
                        aria-label={(manage ? "预览" : "引用") + label}
                        onClick={() => (manage ? preview(id) : insert(id))}
                      >
                        <ReferenceMedia id={id} kind={asset?.kind} />
                        <span>{label}</span>
                      </button>
                      {manage && direct && (
                        <>
                          <button
                            className="icon-button"
                            data-act="mention"
                            data-key={id}
                            aria-label={"引用" + label}
                            title="引用"
                            onClick={() => insert(id)}
                          >
                            <Icon name="at" />
                          </button>
                          <button
                            className="icon-button"
                            data-act="ref-left"
                            data-key={id}
                            aria-label={"前移" + label}
                            title="前移"
                            onClick={() =>
                              moveReference(id, refs.indexOf(id) - 1)
                            }
                          >
                            <Icon name="back" />
                          </button>
                          <button
                            className="icon-button"
                            data-act="unref"
                            data-key={id}
                            aria-label={"移除" + label}
                            title="移除"
                            onClick={() =>
                              changeRefs(
                                refs.filter((ref) => ref !== id),
                                id,
                              )
                            }
                          >
                            <Icon name="close" />
                          </button>
                        </>
                      )}
                    </div>
                    {h3 && asset?.kind === "ref_video" && asset.has_audio && (
                      <label className="h3-video-audio">
                        <input
                          type="checkbox"
                          data-video-audio={id}
                          checked={options.video_audio.includes(id)}
                          onChange={(event) =>
                            patch({
                              h3: {
                                ...options,
                                video_audio: event.currentTarget.checked
                                  ? [...options.video_audio, id]
                                  : options.video_audio.filter(
                                      (ref) => ref !== id,
                                    ),
                              },
                            })
                          }
                        />
                        同时参考{referenceLabel(state, id, refs)}的声音
                      </label>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <p className="empty-note">暂无参考内容</p>
          )}
          {manage && (
            <>
              <button
                className="menu-item"
                data-act="upload"
                onClick={() => {
                  close();
                  document.getElementById("files")?.click();
                }}
              >
                <Icon name="plus" />
                {h3 ? "上传素材" : "上传图片"}
              </button>
              <button
                className="menu-item"
                data-act="choose-assets"
                onClick={pickAssets}
              >
                <Icon name="library" />
                从资产选择
              </button>
              <button
                className="menu-item"
                data-act="asset-packs"
                onClick={openPacks}
              >
                <Icon name="library" />
                素材包{draft.packs?.length ? " · " + draft.packs.length : ""}
              </button>
              {h3 && (
                <p className="h3-upload-note">
                  最多 9 张图片、3 段视频、3 段音频，合计 12 个。视频、音频各
                  2–15 秒，同类总时长不超过 15 秒。
                </p>
              )}
            </>
          )}
        </>
      );
    }
  }
}

function ensureCreation(state: StudioState, draft: Draft, kind: Draft["kind"]) {
  const next = { ...draft, kind };
  const available = Object.keys(modelsForKind(state, kind)).filter((id) =>
    modelAvailable(state, id),
  );
  return normalizeParams(
    state,
    available.includes(selectedModel(next))
      ? next
      : chooseModel(next, available[0] || ""),
  );
}
