import type { MenuEntry } from "@fumiao/plugin-sdk/contributions";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ReferenceMedia } from "./AssetMedia";
import { Icon } from "./Icon";
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
  | { kind: "preview"; id: string; mediaKind: Asset["kind"] }
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
}: {
  dialog: AssetDialogState | null;
  admin: boolean;
  onClose: () => void;
  notify: (message: string) => void;
  state: StudioState | null;
  session: DraftSession | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeFrame = useRef(0);
  const shownDialog = useRef(dialog);
  const confirmationPending = useRef(false);
  const [previous, setPrevious] = useState<AssetDialogState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const retained = dialog || previous;
  const content = retained?.adminOnly && !admin ? undefined : retained?.content;

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
      if (dialog.content.kind !== "preview")
        element!.setAttribute("aria-labelledby", "modal-heading");
      if (!element!.open) element!.showModal();
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
    try {
      await content.run(values);
      if (shownDialog.current === dialog) closeDialog();
    } catch (error) {
      notify((error as Error).message);
      if (shownDialog.current === dialog) {
        confirmationPending.current = false;
        setConfirming(false);
      }
    }
  }

  return (
    <dialog
      id="modal"
      className={
        content?.kind === "settings" && content.presentation === "invite-sheet"
          ? "ledger-invite-sheet"
          : content?.kind === "settings" &&
              content.presentation === "account-sheet"
            ? "console-account-sheet"
            : undefined
      }
      ref={ref}
      onCancel={() => stopDialogMedia(ref.current)}
      onClose={() => {
        stopDialogMedia(ref.current);
        closeFrame.current = requestAnimationFrame(() => {
          const opener = dialog?.opener;
          const target =
            opener?.isConnected && opener.getClientRects().length
              ? opener
              : document.querySelector<HTMLElement>(".workspace-switch");
          target?.focus({ preventScroll: true });
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
        {dialog?.content.kind === "preview" && (
          <>
            <PreviewMedia
              key={dialog.content.id}
              id={dialog.content.id}
              mediaKind={dialog.content.mediaKind}
            />
            <button
              className="quiet-button"
              data-act="close"
              onClick={closeDialog}
            >
              关闭
            </button>
          </>
        )}
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
                  required={field.required}
                  maxLength={300}
                />
              </label>
            ))}
            <div className="buttons">
              <button className="primary" disabled={confirming}>
                执行
              </button>
              <button type="button" className="ghost" onClick={closeDialog}>
                取消
              </button>
            </div>
          </form>
        )}
        {content?.kind === "confirm" && (
          <>
            <h2 id="modal-heading">{content.title}</h2>
            <p>{content.summary}</p>
            <div className="buttons">
              <button
                id="confirm"
                className="primary"
                disabled={confirming}
                onClick={() => void confirm()}
              >
                确定
              </button>
              <button id="back" className="ghost" onClick={closeDialog}>
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
        onClick={closeDialog}
      >
        <Icon name="close" />
      </button>
    </dialog>
  );
}
