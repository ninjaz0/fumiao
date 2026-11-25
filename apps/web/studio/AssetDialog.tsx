import type { MenuEntry } from "@fumiao/plugin-sdk/contributions";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Download, Favorite, ReferenceMedia } from "./AssetMedia";
import { Icon } from "./Icon";
import { isOwner } from "./Library";
import { PREVIEW_LABELS, assetMetadataItems } from "./media-metadata";
import type { SettingsDialogPresentation } from "./settings-admin";
import "./asset-packs.css";
import { AssetPacks } from "../canvas-editor/AssetPacks";
import {
  packReferences,
  type Asset,
  type DraftSession,
  type Pack,
  type StudioState,
} from "./state";

export type DialogContent =
  | {
      kind: "packs";
      importImages: (ids: string[]) => Promise<void>;
      importPack: (pack: Pack) => Promise<void>;
      removePack: (id: string) => Promise<void>;
      deletePack?: (id: string) => Promise<void>;
    }
  | {
      kind: "plugin-action";
      entry: MenuEntry;
      run: (values: Record<string, string>) => Promise<void>;
    }
  | {
      kind: "preview";
      id: string;
      mediaKind: Asset["kind"];
      manage?: boolean;
    }
  | {
      kind: "settings";
      body: ReactNode;
      version: number;
      presentation?: SettingsDialogPresentation;
    }
  | {
      kind: "confirm";
      title: string;
      summary: string;
      run: () => Promise<void>;
      onCancel?: () => void;
    };
export type AssetDialogState = {
  content: DialogContent;
  opener: HTMLElement | null;
  adminOnly?: boolean;
};

export function openDialogFor(element: HTMLElement) {
  const dialog = element.closest("dialog");
  return dialog?.open ? dialog : null;
}

function stopDialogMedia(container: ParentNode | null) {
  if (!container) return;
  for (const media of container.querySelectorAll<HTMLMediaElement>(
    "video, audio",
  )) {
    media.pause();
    try {
      media.currentTime = 0;
    } catch {
      // Ignore when media is not seekable yet.
    }
  }
}

function PreviewMedia({
  id,
  mediaKind,
}: {
  id: string;
  mediaKind: Asset["kind"];
}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    return () => stopDialogMedia(element);
  }, []);
  return (
    <div className="h3-media-preview" ref={host}>
      <ReferenceMedia id={id} kind={mediaKind} controls />
    </div>
  );
}

export function AssetDialog({
  dialog,
  admin,
  onClose,
  notify,
  state,
  session,
  onFavorite,
  onUse,
  onDelete,
}: {
  dialog: AssetDialogState | null;
  admin: boolean;
  onClose: () => void;
  notify: (message: string) => void;
  state: StudioState | null;
  session: DraftSession | null;
  onFavorite?: (key: string, saved: boolean) => void;
  onUse?: (id: string) => string | null | undefined;
  onDelete?: (id: string, button: HTMLButtonElement) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeFrame = useRef(0);
  const shownDialog = useRef(dialog);
  const confirmationPending = useRef(false);
  const restoreOpenerFocus = useRef(true);
  const [previous, setPrevious] = useState<AssetDialogState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const retained = dialog || previous;
  const content = retained?.adminOnly && !admin ? undefined : retained?.content;
  const previewAsset =
    content?.kind === "preview"
      ? state?.assets.find((item) => item.id === content.id)
      : undefined;
  const previewLabel =
    content?.kind === "preview"
      ? PREVIEW_LABELS[previewAsset?.kind ?? content.mediaKind ?? "ref"]
      : undefined;

  useLayoutEffect(() => {
    if (!admin) setPrevious((value) => (value?.adminOnly ? null : value));
  }, [admin]);

  useLayoutEffect(() => {
    const element = ref.current;
    shownDialog.current = dialog;
    confirmationPending.current = false;
    if (dialog) {
      setPrevious(dialog);
      setConfirming(false);
      setDialogError("");
      if (!element!.open) element!.showModal();
      else if (!element!.contains(document.activeElement)) {
        element!
          .querySelector<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]',
          )
          ?.focus({ preventScroll: true });
      }
    } else {
      stopDialogMedia(element);
      if (element!.open) element!.close();
    }
    return () => {
      cancelAnimationFrame(closeFrame.current);
      if (dialog?.content.kind === "preview") stopDialogMedia(element);
    };
  }, [dialog]);

  function closeDialog() {
    if (confirmationPending.current) return;
    stopDialogMedia(ref.current);
    ref.current?.close();
  }

  async function confirm(values: Record<string, string> = {}) {
    if (
      !dialog ||
      (content?.kind !== "confirm" && content?.kind !== "plugin-action") ||
      confirmationPending.current
    )
      return;
    confirmationPending.current = true;
    setConfirming(true);
    setDialogError("");
    try {
      await content.run(values);
      if (shownDialog.current === dialog) {
        confirmationPending.current = false;
        closeDialog();
      }
    } catch (error) {
      const message = (error as Error).message;
      notify(message);
      if (shownDialog.current === dialog) {
        confirmationPending.current = false;
        setConfirming(false);
        if (content.kind === "confirm") setDialogError(message);
      }
    }
  }

  return (
    <dialog
      id="modal"
      data-motion-exit={
        content?.kind === "settings" ||
        content?.kind === "confirm" ||
        content?.kind === "plugin-action"
          ? ""
          : undefined
      }
      aria-label={previewLabel}
      aria-labelledby={
        content && content.kind !== "preview" ? "modal-heading" : undefined
      }
      className={
        content?.kind === "settings" && content.presentation === "invite-sheet"
          ? "ledger-invite-sheet"
          : content?.kind === "settings" &&
              content.presentation === "account-sheet"
            ? "console-account-sheet"
            : content?.kind === "preview"
              ? "asset-preview-modal"
              : undefined
      }
      ref={ref}
      onCancel={(event) => {
        if (confirmationPending.current) event.preventDefault();
        else stopDialogMedia(ref.current);
      }}
      onClose={(event) => {
        if (event.currentTarget.open) return;
        stopDialogMedia(ref.current);
        const shouldRestoreFocus = restoreOpenerFocus.current;
        restoreOpenerFocus.current = true;
        closeFrame.current = requestAnimationFrame(() => {
          if (ref.current?.open) return;
          if (shouldRestoreFocus) {
            const opener = dialog?.opener;
            const target =
              opener?.isConnected && opener.getClientRects().length
                ? opener
                : document.querySelector<HTMLElement>(".workspace-switch");
            target?.focus({ preventScroll: true });
          }
          onClose();
        });
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          closeDialog();
      }}
    >
      <div id="dialog-body">
        {content?.kind === "settings" && (
          <Fragment key={content.version}>{content.body}</Fragment>
        )}
        {content?.kind === "packs" && state && session && (
          <>
            <h2 id="modal-heading">素材包</h2>
            <div id="asset-packs-host">
              {dialog && (
                <AssetPacks
                  workspace={state.workspace_id}
                  userId={state.me.id}
                  admin={state.me.role === "admin"}
                  selected={session.draft.packs}
                  imageRefs={packReferences(session)}
                  onImportImages={content.importImages}
                  onImportPack={content.importPack}
                  onRemovePack={content.removePack}
                  onDeletePack={content.deletePack}
                />
              )}
            </div>
          </>
        )}
        {dialog?.content.kind === "preview" &&
          (() => {
            const { id, mediaKind, manage } = dialog.content;
            const asset = state?.assets.find((item) => item.id === id);
            const effectiveKind = asset?.kind ?? mediaKind;
            const meta = assetMetadataItems(asset, effectiveKind);
            const key = "asset:" + id;
            const saved = !!state?.favorites.includes(key);
            const canManage = !!(manage && state && asset);
            const canDelete = !!(canManage && isOwner(state, asset));
            return (
              <div className={`preview-dialog${canManage ? " is-managed" : ""}`}>
                {(canManage || meta.length > 0) && (
                  <div className="preview-dialog-head">
                    <strong className="preview-dialog-title">
                      {PREVIEW_LABELS[effectiveKind ?? "ref"]}
                    </strong>
                    {meta.length > 0 && (
                      <div className="metadata preview-dialog-meta">
                        {meta.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <PreviewMedia key={id} id={id} mediaKind={effectiveKind} />
                {dialogError && (
                  <p role="alert" className="dialog-error danger">
                    {dialogError}
                  </p>
                )}
                <div className="preview-dialog-actions">
                  {canManage && (
                    <>
                      {onUse && (
                        <button
                          type="button"
                          className="primary preview-use-button"
                          data-act="use"
                          data-key={id}
                          onClick={() => {
                            const result = onUse(id);
                            if (result === null) {
                              restoreOpenerFocus.current = false;
                              closeDialog();
                            } else if (result) {
                              setDialogError(result);
                            }
                          }}
                        >
                          <Icon name="plus" />
                          用作参考
                        </button>
                      )}
                      {onFavorite && (
                        <Favorite
                          id={key}
                          saved={saved}
                          change={onFavorite}
                          detail
                        />
                      )}
                      <Download id={id} detail />
                      {canDelete && onDelete && (
                        <button
                          type="button"
                          className="quiet-button danger preview-delete-button"
                          data-act="delete-asset"
                          data-key={id}
                          onClick={(event) => onDelete(id, event.currentTarget)}
                        >
                          <Icon name="trash" />
                          删除
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="quiet-button preview-close-button"
                    data-act="close"
                    onClick={closeDialog}
                  >
                    关闭
                  </button>
                </div>
              </div>
            );
          })()}
        {content?.kind === "plugin-action" && (
          <form
            key={content.entry.plugin + "/" + content.entry.id}
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void confirm(
                Object.fromEntries(
                  (content.entry.fields ?? []).map((f) => [
                    f.name,
                    String(data.get(f.name) ?? ""),
                  ]),
                ),
              );
            }}
          >
            <h2 id="modal-heading">{content.entry.title}</h2>
            {content.entry.fields?.map((field) => (
              <label key={field.name}>
                {field.label}
                <input
                  name={field.name}
                  disabled={confirming}
                  required={field.required}
                  maxLength={300}
                />
              </label>
            ))}
            <div className="buttons">
              <button className="primary" disabled={confirming}>
                {confirming ? "处理中…" : "执行"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={confirming}
                onClick={closeDialog}
              >
                取消
              </button>
            </div>
          </form>
        )}
        {content?.kind === "confirm" && (
          <>
            <h2 id="modal-heading">{content.title}</h2>
            <p>{content.summary}</p>
            {dialogError && (
              <p role="alert" className="dialog-error danger">
                {dialogError}
              </p>
            )}
            <div className="buttons">
              <button
                id="confirm"
                className="primary"
                disabled={confirming}
                onClick={() => void confirm()}
              >
                {confirming ? "处理中…" : "确定"}
              </button>
              <button
                id="back"
                className="ghost"
                disabled={confirming}
                onClick={() => {
                  if (content.onCancel) {
                    setDialogError("");
                    content.onCancel();
                  } else {
                    closeDialog();
                  }
                }}
              >
                取消
              </button>
            </div>
          </>
        )}
      </div>
      <button
        id="close-modal"
        type="button"
        aria-label="关闭对话框"
        disabled={confirming}
        onClick={closeDialog}
      >
        <Icon name="close" />
      </button>
    </dialog>
  );
}
