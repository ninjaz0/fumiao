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
import { AssetPacks } from "../../../legacy/pure/canvas/src/AssetPacks";
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
    shownDialog.current = dialog;
    confirmationPending.current = false;
    if (dialog) {
      setPrevious(dialog);
      setConfirming(false);
      if (dialog.content.kind !== "preview")
        ref.current!.setAttribute("aria-labelledby", "modal-heading");
      if (!ref.current!.open) ref.current!.showModal();
    } else if (ref.current!.open) ref.current!.close();
    return () => cancelAnimationFrame(closeFrame.current);
  }, [dialog]);

  async function confirm() {
    if (!dialog || content?.kind !== "confirm" || confirmationPending.current)
      return;
    confirmationPending.current = true;
    setConfirming(true);
    try {
      await content.run();
      if (shownDialog.current === dialog) ref.current?.close();
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
          : undefined
      }
      ref={ref}
      onClose={() => {
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
          event.currentTarget.close();
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
                />
              )}
            </div>
          </>
        )}
        {content?.kind === "preview" && (
          <>
            <div className="h3-media-preview">
              <ReferenceMedia
                id={content.id}
                kind={content.mediaKind}
                controls
              />
            </div>
            <button
              className="quiet-button"
              data-act="close"
              onClick={() => ref.current!.close()}
            >
              关闭
            </button>
          </>
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
                onClick={confirm}
              >
                确定
              </button>
              <button
                id="back"
                className="ghost"
                onClick={() => ref.current!.close()}
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
        onClick={() => ref.current!.close()}
      >
        <Icon name="close" />
      </button>
    </dialog>
  );
}
