"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import Auth from "../auth/Auth";
import { ApiError, workspaceURL } from "../canvas/api";
import { ChatWorkspace } from "../canvas-editor/chat/ChatWorkspace";
import { ImageDetail, JobDetail } from "./AssetDetail";
import {
  AssetDialog,
  type AssetDialogState,
  type DialogContent,
} from "./AssetDialog";
import { Library, isOwner, useLibrary, type LibraryFilter } from "./Library";
import type {
  AdminOpen,
  AdminRequest,
  SettingsDialogPresentation,
} from "./settings-admin";
import { api } from "./api";
import {
  Composer,
  useEstimate,
  type ComposerEditor,
  type FlowSourceDisplay,
  type ReferenceDisplay,
  type RequestEstimate,
} from "./Composer";
import {
  ComposerMenuContents,
  composerMenuLabel,
  type ComposerMenu,
} from "./ComposerMenu";
import { History, Queue, kindLabel } from "./History";
import { Icon } from "./Icon";
import {
  HistoryHeading,
  MenuContents,
  Sidebar,
  type Destination,
  type Menu,
} from "./Navigation";
import { Settings } from "./Settings";
import { WorkspaceDialog } from "./SettingsWorkspaces";
import { adminSettingsTabs, type SettingsTab } from "./settings-tabs";
import {
  addImages,
  assignFrame,
  checkImages,
  emptyH3,
  ensureModel,
  flowIssue,
  frames,
  generationRequest,
  h3Options,
  hasDraftPacks,
  isH3,
  loadJob,
  modelAvailable,
  normalizeParams,
  packReferences,
  promptLimit,
  pruneDraftPacks,
  referenceAsset,
  referenceIssue,
  referenceType,
  removeDraftPack,
  resultTab,
  selectedModel,
  suspendAudioDraft,
  syncDraftReferences,
  quote,
  readDraft,
  writeDraft,
  type Asset,
  type DraftSession,
  type FrameSlot,
  type Pack,
  type Job,
  type Member,
  type Space,
  type StudioState,
} from "./state";

type Page = "home" | "queue" | "library" | "chat" | "settings";
type Detail = { job: number } | { image: string };
type StudioMenu = Menu | ComposerMenu;
function isComposerMenu(menu: StudioMenu): menu is ComposerMenu {
  return menu !== "workspaces" && menu !== "account" && menu !== "detail-more";
}
function sameSpace(before: StudioState, after: StudioState | null) {
  return (
    before.me.id === after?.me.id && before.workspace_id === after.workspace_id
  );
}

function animateMove(element: Element, before: DOMRect) {
  const after = element.getBoundingClientRect();
  if (!before.width || !after.width || !after.height) return;
  element.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${before.left - after.left}px,${before.top - after.top}px) scale(${before.width / after.width},${before.height / after.height})`,
      },
      { transformOrigin: "top left", transform: "none" },
    ],
    { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
  );
}

export default function Studio({ loadingLogo }: { loadingLogo: string }) {
  const [state, setState] = useState<StudioState | null>(null);
  const [session, setSession] = useState<DraftSession | null>(null);
  const [expired, setExpired] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("plugins");
  const [settingsVisit, setSettingsVisit] = useState(0);
  const profileDraft = useRef<string | null>(null);
  const modelPreferences = useRef({ scope: "global", search: "" });
  const settingsDialogVersion = useRef(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [referencePicking, setReferencePicking] = useState<{
    page: Page;
    filter: LibraryFilter;
    scroll: number;
  } | null>(null);
  const [detailMenuUsed, setDetailMenuUsed] = useState(false);
  const [dialog, setDialog] = useState<AssetDialogState | null>(null);
  const [chatVisit, setChatVisit] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<StudioMenu | null>(null);
  const [menuShown, setMenuShown] = useState(false);
  const [menuHidden, setMenuHidden] = useState(true);
  const [sidebarChanged, setSidebarChanged] = useState(false);
  const [accountOpened, setAccountOpened] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [delta, setDelta] = useState(0);
  const receivedAt = useRef(0);
  const shell = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const menuFocusTarget = useRef<HTMLElement | null>(null);
  const menuTimer = useRef(0);
  const toastTimer = useRef(0);
  const busy = useRef(new Set<string>());
  const editor = useRef<ComposerEditor>(null);
  const referenceContents = useRef<ReferenceDisplay>(null);
  const flowSourceContents = useRef<FlowSourceDisplay>(null);
  const composerMenuAria = useRef<string>(undefined);
  const seenComposerMenus = useRef(new Set<ComposerMenu>());
  const retryIds = useRef(new Map<number, string>());
  const focusEditor = () =>
    view.current?.querySelector<HTMLElement>("#prompt")?.focus();
  const active = useRef<StudioState | null>(null);
  const currentDraft = useRef<DraftSession | null>(null);
  const workspaceId = useRef<string | null>(null);
  const stateRead = useRef(0);
  const leaving = useRef(false);
  const onLibraryRead = useRef<
    ((before: StudioState, after: StudioState) => void) | null
  >(null);
  const assetScroll = useRef(0);
  const scrollAfterRender = useRef<(() => void) | null>(null);
  const animateAfterRender = useRef<(() => void) | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    setToastVisible(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), 4200);
  }, []);

  const library = useLibrary(state, notify);
  const job =
    detail && "job" in detail
      ? state?.jobs.find(({ id }) => id === detail.job)
      : undefined;
  const image =
    detail && "image" in detail
      ? state?.assets.find(({ id }) => id === detail.image)
      : undefined;

  const ready = !!state && !!session;
  useLayoutEffect(() => {
    // Let the shell measure the initial composer before moving to the receipt.
    if (!ready) return;
    const url = new URL(location.href);
    if (url.searchParams.get("recharge")) setSettingsTab("credits");
    else if (url.searchParams.has("settings")) {
      setSettingsTab((url.searchParams.get("settings") || "plugins") as SettingsTab);
      url.searchParams.delete("settings");
      history.replaceState(null, "", url);
    } else return;
    setPage("settings");
  }, [ready]);

  useLayoutEffect(() => {
    onLibraryRead.current = (before, after) => {
      if (page !== "library" || detail) return;
      const content = ({ jobs, assets, favorites }: StudioState) => [
        jobs.map(({ timing, eta, ...job }) => job),
        assets,
        favorites,
      ];
      if (JSON.stringify(content(before)) !== JSON.stringify(content(after)))
        library.refreshGrid();
    };
    animateAfterRender.current?.();
    animateAfterRender.current = null;
    scrollAfterRender.current?.();
    scrollAfterRender.current = null;
  });

  const persist = useCallback((space: StudioState, draft: DraftSession) => {
    writeDraft(space, draft);
    currentDraft.current = draft;
    setSession(draft);
  }, []);

  const closeMenu = useCallback((focus = false) => {
    if (focus || popover.current?.contains(document.activeElement))
      menuFocusTarget.current?.focus({ preventScroll: true });
    anchor.current = null;
    menuFocusTarget.current = null;
    setMenuShown(false);
    clearTimeout(menuTimer.current);
    menuTimer.current = window.setTimeout(() => setMenuHidden(true), 100);
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (leaving.current) return;
      const version = ++stateRead.current;
      try {
        const next = await api<StudioState>(workspaceId.current, "/api/state");
        if (version !== stateRead.current || leaving.current) return;
        const previous = active.current;
        if (
          previous &&
          (previous.me.id !== next.me.id ||
            previous.workspace_id !== next.workspace_id)
        ) {
          leaving.current = true;
          location.replace(workspaceURL("/studio", String(next.workspace_id)));
          return;
        }
        if (previous?.me.role === "admin" && next.me.role !== "admin") {
          modelPreferences.current = { scope: "global", search: "" };
          closeMenu();
          setMenuHidden(true);
          setDialog((current) => (current?.adminOnly ? null : current));
          setSettingsTab((tab) =>
            adminSettingsTabs.some((key) => key === tab) ? "general" : tab,
          );
        }
        const initialDraft = currentDraft.current || readDraft(next);
        let livePacks: Map<string, Pack> | null = null;
        if (hasDraftPacks(initialDraft)) {
          try {
            const result = await api<{ packs?: Pack[] }>(
              String(next.workspace_id),
              "/api/asset-packs",
            );
            if (Array.isArray(result?.packs)) {
              livePacks = new Map(
                result.packs.map((pack) => [pack.id, pack]),
              );
            }
          } catch {
            // Keep existing pack references when /api/asset-packs fails.
          }
          if (version !== stateRead.current || leaving.current) return;
        }
        const priorDraft = currentDraft.current || initialDraft;
        const prevSpace = previous ?? next;
        const model = selectedModel(priorDraft.draft);
        const changedForm =
          previous &&
          JSON.stringify(previous.model_forms?.[model]) !==
            JSON.stringify(next.model_forms?.[model]);
        const keepUnavailable =
          next.studio_plugins && model && !modelAvailable(next, model);
        const normalizedDraft = keepUnavailable
          ? priorDraft.draft
          : ensureModel(
              next,
              changedForm
                ? normalizeParams(next, priorDraft.draft)
                : priorDraft.draft,
            );
        const afterPacks = livePacks
          ? pruneDraftPacks(prevSpace, next, priorDraft, livePacks)
          : priorDraft;
        const filteredRefs = priorDraft.refs.filter((id) =>
          referenceAsset(next, id),
        );
        const lostRef = filteredRefs.length !== priorDraft.refs.length;
        const refs = lostRef ? filteredRefs : priorDraft.refs;
        const hasParent = next.jobs.some(({ id }) => id === priorDraft.parent);
        const lostParent = priorDraft.parent !== null && !hasParent;
        const draftChanged =
          normalizedDraft !== priorDraft.draft ||
          afterPacks.draft.packs !== priorDraft.draft.packs ||
          afterPacks.draft.h3ReferenceDraft !==
            priorDraft.draft.h3ReferenceDraft;
        const mergedDraft = draftChanged
          ? {
              ...normalizedDraft,
              packs: afterPacks.draft.packs,
              h3ReferenceDraft: afterPacks.draft.h3ReferenceDraft,
            }
          : priorDraft.draft;
        const nextBase: DraftSession =
          mergedDraft !== priorDraft.draft ||
          afterPacks !== priorDraft ||
          lostRef ||
          lostParent
            ? {
                ...afterPacks,
                draft: mergedDraft,
                refs,
                ...(lostParent ? { parent: null, retainedSeed: null } : {}),
              }
            : priorDraft;
        const nextSession =
          nextBase === priorDraft
            ? priorDraft
            : syncDraftReferences(
                prevSpace,
                next,
                priorDraft,
                nextBase,
                editor.current
                  ? (nextRefs) => editor.current!.reindex(nextRefs)
                  : undefined,
              );
        if (nextSession !== priorDraft) {
          persist(next, {
            ...nextSession,
            submitId: crypto.randomUUID(),
          });
        } else if (!previous) {
          currentDraft.current = priorDraft;
          setSession(priorDraft);
        }
        if (
          previous &&
          JSON.stringify(previous.workspaces) !==
            JSON.stringify(next.workspaces) &&
          anchor.current?.dataset.menu === "workspaces"
        )
          closeMenu();
        workspaceId.current = String(next.workspace_id);
        if (previous && !force) onLibraryRead.current?.(previous, next);
        active.current = next;
        receivedAt.current = Date.now();
        setDelta(0);
        setState(next);
      } catch (error) {
        if (version !== stateRead.current || leaving.current) return;
        if (error instanceof ApiError && error.status === 401) {
          active.current = null;
          currentDraft.current = null;
          closeMenu();
          setDialog(null);
          setState(null);
          setSession(null);
          setExpired(true);
        } else if (
          error instanceof ApiError &&
          error.status === 403 &&
          workspaceId.current
        ) {
          active.current = null;
          currentDraft.current = null;
          closeMenu();
          setDialog(null);
          setState(null);
          setSession(null);
          try {
            const spaces = await api<{ workspace_id: number }>(
              workspaceId.current,
              "/api/workspaces",
            );
            if (version !== stateRead.current) return;
            leaving.current = true;
            location.replace(
              workspaceURL("/studio", String(spaces.workspace_id)),
            );
          } catch (recovery) {
            if (version === stateRead.current)
              notify((recovery as Error).message);
          }
        } else notify((error as Error).message);
      }
    },
    [closeMenu, notify, persist],
  );

  useEffect(() => {
    const narrow = matchMedia("(max-width:760px)");
    setCollapsed(
      narrow.matches || localStorage.getItem("fm-sidebar") === "collapsed",
    );
    const onNarrow = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setCollapsed(true);
        setSidebarChanged(true);
        closeMenu();
      } else {
        setCollapsed(localStorage.getItem("fm-sidebar") === "collapsed");
        setSidebarChanged(true);
      }
    };
    narrow.addEventListener("change", onNarrow);
    const params = new URLSearchParams(location.search);
    workspaceId.current = params.get("workspace");
    sessionStorage.removeItem("fm-invite");
    if (new URLSearchParams(location.hash.slice(1)).has("invite")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    void refresh();
    const poll = window.setInterval(() => {
      if (active.current && !document.hidden && !busy.current.has("upload"))
        void refresh();
    }, 6000);
    const clock = window.setInterval(() => {
      if (active.current && !document.hidden)
        setDelta((Date.now() - receivedAt.current) / 1000);
    }, 1000);
    return () => {
      ++stateRead.current;
      narrow.removeEventListener("change", onNarrow);
      clearInterval(poll);
      clearInterval(clock);
      clearTimeout(menuTimer.current);
      clearTimeout(toastTimer.current);
    };
  }, [closeMenu, refresh]);

  const requestEstimate = useCallback<RequestEstimate>(
    (body) => api(workspaceId.current, "/api/estimate", body),
    [],
  );
  const estimate = useEstimate(state, session, requestEstimate);

  const positionMenu = useCallback(() => {
    const trigger = anchor.current;
    const element = popover.current;
    if (!trigger?.isConnected || !element) return;
    const box = trigger.getBoundingClientRect();
    const beside = trigger.dataset.menu === "workspaces" && innerWidth > 760;
    const left = Math.min(
      Math.max(12, beside ? box.right + 12 : box.left - 16),
      innerWidth - element.offsetWidth - 12,
    );
    let top = beside ? box.top : box.bottom + 8;
    const above = top + element.offsetHeight > innerHeight - 14;
    if (above) top = Math.max(12, box.top - element.offsetHeight - 8);
    Object.assign(element.style, {
      left: left + "px",
      top: top + "px",
      transformOrigin: above ? "bottom left" : "top left",
    });
  }, []);

  useLayoutEffect(() => {
    if (!menu || menuHidden || !anchor.current) return;
    positionMenu();
    const element = popover.current;
    if (
      (isComposerMenu(menu) || menu === "workspaces") &&
      menuFocusTarget.current === anchor.current
    ) {
      const visible = (selector: string) =>
        Array.from(element?.querySelectorAll<HTMLElement>(selector) ?? []).find(
          (control) => control.getClientRects().length > 0,
        );
      const option =
        visible(
          '[aria-selected="true"]:not(:disabled), [role="radio"][aria-checked="true"]:not(:disabled)',
        ) ??
        visible(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], a[href]',
        ) ?? element;
      option?.focus({ preventScroll: true });
    }
    const frame = requestAnimationFrame(() => setMenuShown(true));
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (event.type === "pointerdown") editor.current?.remember();
      if (
        !element?.contains(target) &&
        (event.type === "scroll" || !anchor.current?.contains(target))
      )
        closeMenu();
    };
    window.addEventListener("resize", positionMenu);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", outside, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", outside, true);
    };
  }, [menu, menuHidden, closeMenu, positionMenu]);

  function openMenu(kind: StudioMenu, button: HTMLButtonElement, focus = true) {
    if (anchor.current === button) {
      closeMenu();
      return;
    }
    clearTimeout(menuTimer.current);
    anchor.current = button;
    menuFocusTarget.current = focus
      ? button
      : document.activeElement as HTMLElement;
    if (isComposerMenu(kind) && active.current && currentDraft.current) {
      seenComposerMenus.current.add(kind);
      composerMenuAria.current = composerMenuLabel(
        kind,
        active.current,
        currentDraft.current.draft,
      );
    }
    if (kind === "account") setAccountOpened(true);
    if (kind === "detail-more") setDetailMenuUsed(true);
    setMenuHidden(false);
    if (kind === menu && !menuHidden) {
      positionMenu();
      setMenuShown(true);
      if (kind === "workspaces")
        popover.current
          ?.querySelector<HTMLElement>('[aria-selected="true"]')
          ?.focus({ preventScroll: true });
    } else {
      setMenuShown(false);
      setMenu(kind);
    }
  }

  const leaveStudio = useCallback(
    (leave: (space: StudioState) => void) => {
      const space = active.current;
      if (!space || leaving.current) return;
      if (busy.current.has("upload")) {
        notify("图片正在上传，请稍候切换");
        return;
      }
      if (busy.current.has("submit") || busy.current.has("session")) return;
      const draft = currentDraft.current;
      if (draft) writeDraft(space, draft);
      leaving.current = true;
      leave(space);
    },
    [notify],
  );

  function openCanvas(path = "/canvas") {
    leaveStudio((space) =>
      location.assign(workspaceURL(path, String(space.workspace_id))),
    );
  }

  function followCanvas(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 || event.altKey || event.ctrlKey ||
      event.metaKey || event.shiftKey
    ) return;
    event.preventDefault();
    openCanvas(event.currentTarget.pathname);
  }

  function navigate(destination: Destination | "settings") {
    const space = active.current;
    if (!space || leaving.current) return;
    setReferencePicking(null);
    if (destination === "canvas") {
      openCanvas();
      return;
    }
    if (page === "library") assetScroll.current = scrollY;
    library.reset();
    if (destination === "library") library.redrawLibrary();
    transition(null);
    // The original navigation remounts chat even when it is already selected.
    if (destination === "chat") setChatVisit((visit) => visit + 1);
    if (destination === "settings") setSettingsVisit((visit) => visit + 1);
    setPage(destination);
    scrollAfterRender.current = () => scrollTo({ top: 0, behavior: "instant" });
  }

  function openSettingsDialog(
    body: ReactNode,
    opener: HTMLElement | null,
    adminOnly = false,
    presentation?: SettingsDialogPresentation,
  ) {
    if (leaving.current || !active.current) return;
    closeMenu();
    setMenuHidden(true);
    const version = ++settingsDialogVersion.current;
    setDialog((current) => ({
      content: { kind: "settings", body, version, presentation },
      opener: current ? current.opener : opener,
      adminOnly,
    }));
  }

  const saveProfile = useCallback(async (member: Member) => {
    const space = active.current;
    if (leaving.current || space?.me.id !== member.id) return;
    const next = { ...space, me: member };
    active.current = next;
    setState(next);
    await refresh();
  }, [refresh]);

  const refreshSettings = useCallback(() => refresh(true), [refresh]);

  const adminRequest: AdminRequest = useCallback(
    async (path, body, method) => {
      try {
        return await api(workspaceId.current, path, body, method);
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status))
          void refresh();
        throw error;
      }
    },
    [refresh],
  );

  const openAdminDialog: AdminOpen = (body, opener, presentation) => {
    if (active.current?.me.role === "admin")
      openSettingsDialog(body, opener, true, presentation);
  };

  function showWorkspace(opener: HTMLButtonElement, space?: Space) {
    const current = active.current;
    if (!current || current.me.role !== "admin") return;
    openAdminDialog(
      <WorkspaceDialog
        state={current}
        space={space}
        request={adminRequest}
        refresh={refreshSettings}
        notify={notify}
      />,
      opener,
    );
  }

  function confirmAdmin(
    title: string,
    summary: string,
    run: () => Promise<void>,
    opener: HTMLElement,
  ) {
    if (active.current?.me.role !== "admin") return;
    showDialog(
      {
        kind: "confirm",
        title,
        summary,
        run: async () => {
          await run();
          void refreshSettings();
        },
      },
      opener,
      true,
    );
  }

  function transition(next: Detail | null, animate = true) {
    closeMenu();
    library.clearHighlight();
    library.showUploads();
    setDetail(next);
    setEditing(false);
    setDetailMenuUsed(false);
    if (
      !animate ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !view.current
    )
      return;
    const root = view.current;
    const oldComposer = root
      .querySelector(".composer")
      ?.getBoundingClientRect();
    const oldVideo = root.querySelector(".detail-video");
    const videoBox = oldVideo?.getBoundingClientRect();
    const videoSource = oldVideo?.getAttribute("src");
    animateAfterRender.current = () => {
      root.animate([{ opacity: 0.5 }, { opacity: 1 }], {
        duration: 160,
        easing: "ease-out",
      });
      const video = root.querySelector(".detail-video");
      if (videoBox && videoSource === video?.getAttribute("src") && video)
        animateMove(video, videoBox);
      const composer = root.querySelector(".composer");
      if (
        oldComposer &&
        composer &&
        oldComposer.top >= 0 &&
        oldComposer.top < innerHeight
      )
        animateMove(composer, oldComposer);
    };
  }

  function collapse(event: MouseEvent<HTMLButtonElement>) {
    const keyboard = event.currentTarget.matches(":focus-visible");
    setCollapsed(!collapsed);
    setSidebarChanged(true);
    localStorage.setItem("fm-sidebar", collapsed ? "expanded" : "collapsed");
    closeMenu();
    if (keyboard)
      requestAnimationFrame(() =>
        shell.current
          ?.querySelector<HTMLButtonElement>(
            collapsed ? ".collapse-button" : ".expand-button",
          )
          ?.focus(),
      );
  }

  async function mutate(key: string, action: () => Promise<void>) {
    if (leaving.current || busy.current.has(key)) return;
    busy.current.add(key);
    try {
      await action();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      busy.current.delete(key);
    }
  }

  function selectWorkspace(id: number) {
    if (busy.current.has("upload")) {
      notify("图片正在上传，请稍候切换");
      return;
    }
    if (busy.current.has("submit")) return;
    void mutate("session", async () => {
      if (active.current && currentDraft.current)
        writeDraft(active.current, currentDraft.current);
      await api(workspaceId.current, `/api/workspaces/${id}/select`, {});
      leaving.current = true;
      location.assign(workspaceURL("/studio", String(id)));
    });
  }

  function openJob(id: number) {
    assetScroll.current = scrollY;
    transition({ job: id });
    scrollAfterRender.current = () => scrollTo(0, 0);
  }

  function closeDetail() {
    transition(null);
    scrollAfterRender.current = () => scrollTo(0, assetScroll.current);
  }

  function setFilter(filter: LibraryFilter) {
    transition(null);
    library.choose(filter);
  }

  function showResult(id: number, tab: LibraryFilter["tab"], locate = false) {
    transition(null);
    setPage("library");
    setReferencePicking(null);
    library.choose({ tab, scope: "history" }, id);
    scrollAfterRender.current = () => {
      if (locate)
        document
          .getElementById("job-" + id)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      else scrollTo(0, 0);
    };
  }

  function cancel(id: number) {
    void mutate(`cancel-${id}`, async () => {
      await api(workspaceId.current, `/api/jobs/${id}/cancel`, {});
      await refresh(true);
      library.redrawLibrary();
    });
  }

  function editJob(id: number) {
    const space = active.current;
    const previous = currentDraft.current;
    const job = space?.jobs.find((item) => item.id === id);
    if (!space || !previous || !job || busy.current.has("upload")) return;
    if (!detail) assetScroll.current = scrollY;
    setReferencePicking(null);
    updateDraft(loadJob(space, previous, job));
    transition({ job: id });
    setEditing(true);
    scrollAfterRender.current = () => {
      scrollTo(0, 0);
      focusEditor();
    };
  }

  function imageToVideo(id: number) {
    const space = active.current;
    const previous = currentDraft.current;
    const job = space?.jobs.find((item) => item.id === id);
    if (!space || !previous || !job?.result || busy.current.has("upload"))
      return;
    const draft = {
      ...previous.draft,
      kind: "video" as const,
      prompt: "",
      quality: "480",
      seconds: "5",
      seed: "",
    };
    updateDraft({
      ...previous,
      draft: normalizeParams(space, ensureModel(space, draft)),
      refs: [job.result],
      parent: null,
      retainedSeed: null,
      suspendedAudioDraft: suspendAudioDraft(previous),
      suspendedMediaDraft: null,
    });
    openHomeComposer();
  }

  function showDialog(
    content: DialogContent,
    opener = document.activeElement as HTMLElement | null,
    adminOnly = false,
  ) {
    if (opener?.closest("#popover"))
      opener = document.querySelector(".workspace-switch");
    closeMenu();
    setMenuHidden(true);
    setDialog({ content, opener, adminOnly });
  }

  function preview(id: string, button: HTMLButtonElement) {
    showDialog(
      {
        kind: "preview",
        id,
        mediaKind: active.current?.assets.find((asset) => asset.id === id)
          ?.kind,
      },
      button,
    );
  }

  function openHomeComposer() {
    transition(null);
    setPage("home");
    scrollAfterRender.current = () => {
      scrollTo(0, 0);
      focusEditor();
    };
  }

  function useAsset(id: string) {
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session || busy.current.has("upload")) return;
    try {
      const type = referenceType(space, id);
      if (session.draft.kind === "audio")
        throw new Error(
          type === "Picture"
            ? "当前语音生成不支持参考图片，请先切换为视频生成或图片生成"
            : "请先选择 MiniMax H3 全能参考模式",
        );
      let next = session;
      if (type === "Picture") next = addImages(space, session, [id]);
      else if (!isH3(session.draft))
        throw new Error("请先选择 MiniMax H3 全能参考模式");
      else if (frames(session.draft)) next = assignFrame(space, session, id);
      else if (
        packReferences(session).length >=
        (space.model_forms?.[selectedModel(session.draft)]?.references.max ?? 9)
      )
        throw new Error(
          `最多选择 ${space.model_forms?.[selectedModel(session.draft)]?.references.max ?? 9} 个参考素材`,
        );
      else if (!session.refs.includes(id))
        next = { ...session, refs: [...session.refs, id] };
      if (next !== session)
        updateDraft(
          syncDraftReferences(
            space,
            space,
            session,
            next,
            editor.current
              ? (nextRefs) => editor.current!.reindex(nextRefs)
              : undefined,
          ),
        );
      if (!referencePicking) openHomeComposer();
    } catch (error) {
      notify((error as Error).message);
    }
  }

  function startPicking() {
    if (!referencePicking)
      setReferencePicking({ page, filter: library.filter, scroll: scrollY });
    transition(null);
    setPage("library");
    library.choose({ tab: "images", scope: "history" });
    scrollAfterRender.current = () => scrollTo(0, 0);
  }

  function finishPicking() {
    if (!referencePicking) return;
    transition(null);
    setPage(referencePicking.page);
    library.choose(referencePicking.filter);
    setReferencePicking(null);
    scrollAfterRender.current = () => scrollTo(0, referencePicking.scroll);
  }

  async function changePacks(
    action: (space: StudioState, session: DraftSession) => DraftSession,
    reload = true,
    close = true,
  ) {
    const before = active.current;
    if (!before || busy.current.has("upload"))
      throw new Error("图片正在上传，请稍候切换");
    if (reload) await refresh();
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session || !sameSpace(before, space) || leaving.current)
      return;
    const next = action(space, session);
    if (next !== session)
      updateDraft(
        syncDraftReferences(
          space,
          space,
          session,
          next,
          editor.current
            ? (nextRefs) => editor.current!.reindex(nextRefs)
            : undefined,
        ),
      );
    if (close) setDialog(null);
  }

  function removePack(id: string) {
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session || leaving.current) return;
    const next = removeDraftPack(space, session, id, {
      reindexActive: editor.current
        ? (nextRefs) => editor.current!.reindex(nextRefs)
        : undefined,
    });
    if (next !== session) updateDraft(next);
  }

  function openPacks() {
    showDialog({
      kind: "packs",
      importImages: (ids) =>
        changePacks((space, session) => addImages(space, session, ids)),
      importPack: (pack: Pack) =>
        changePacks((space, session) => {
          if (frames(session.draft))
            throw new Error("首尾帧模式请从素材包中选择图片");
          const packs = [
            ...(session.draft.packs || []).filter(({ id }) => id !== pack.id),
            pack,
          ];
          checkImages(
            space,
            session,
            packs.flatMap(({ media }) => media),
            session.refs,
          );
          return { ...session, draft: { ...session.draft, packs } };
        }),
      removePack: (id) =>
        changePacks(
          (_, session) => ({
            ...session,
            draft: {
              ...session.draft,
              packs: session.draft.packs?.filter((pack) => pack.id !== id),
            },
          }),
          false,
        ),
      deletePack: async (id) => {
        const space = active.current;
        const session = currentDraft.current;
        if (!space || !session || leaving.current) return;
        const next = removeDraftPack(space, session, id, {
          allSnapshots: true,
          reindexActive: editor.current
            ? (nextRefs) => editor.current!.reindex(nextRefs)
            : undefined,
        });
        if (next !== session) updateDraft(next);
      },
    });
  }

  function assetAction(
    activity: "favorite" | "download",
    action: () => Promise<void>,
  ) {
    void mutate("library", async () => {
      library.setActivity(activity);
      try {
        await action();
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status))
          void refresh();
        throw error;
      } finally {
        library.setActivity(null);
      }
    });
  }

  function saveFavorites(keys: string[], favorite: boolean) {
    assetAction("favorite", async () => {
      const before = active.current;
      const result = await api<{ favorites: string[] }>(
        workspaceId.current,
        "/api/favorites",
        { keys, favorite },
        "PUT",
      );
      const current = active.current;
      if (
        leaving.current ||
        !current ||
        current.me.id !== before?.me.id ||
        current.workspace_id !== before.workspace_id
      )
        return;
      ++stateRead.current;
      active.current = { ...current, favorites: result.favorites };
      setState(active.current);
      if (
        page === "library" &&
        !detail &&
        library.filter.scope === "favorites"
      ) {
        if (!favorite) library.removeSelected(keys);
        library.redrawLibrary();
      }
      notify(favorite ? "已收藏" : "已取消收藏");
    });
  }

  function downloadSelected() {
    const keys = library.keys;
    if (!keys.length) return;
    assetAction("download", async () => {
      const { url, filename } = await api<{ url: string; filename: string }>(
        workspaceId.current,
        "/api/assets/batch-download",
        { keys },
      );
      if (leaving.current || !active.current) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify("已开始下载");
    });
  }

  function confirmDelete(
    title: string,
    summary: string,
    remove: () => Promise<void>,
  ) {
    showDialog({
      kind: "confirm",
      title,
      summary,
      run: async () => {
        try {
          await remove();
        } catch (error) {
          if (error instanceof ApiError && [401, 403].includes(error.status))
            void refresh();
          throw error;
        }
        await refresh(true);
        library.redrawLibrary();
      },
    });
  }

  function deleteSelected() {
    const keys = library.keys;
    if (!keys.length || library.activity) return;
    confirmDelete(
      `删除所选 ${keys.length} 项内容？`,
      "删除后将从团队资产和收藏夹中移除，无法恢复。",
      async () => {
        const { deleted } = await api<{ deleted: number }>(
          workspaceId.current,
          "/api/assets/batch-delete",
          { keys },
        );
        library.reset();
        notify(`已删除 ${deleted} 项内容`);
      },
    );
  }

  function deleteJob(job: Job) {
    confirmDelete(
      `删除该${kindLabel(job)}？`,
      "删除后将从当前工作区移除。",
      async () => {
        await api(
          workspaceId.current,
          "/api/jobs/" + job.id,
          undefined,
          "DELETE",
        );
        transition(null, false);
        setPage("library");
      },
    );
  }

  function deleteImage(id: string) {
    confirmDelete(
      "删除该图片？",
      "正在被任务或作品引用的图片会保留。",
      async () => {
        await api(
          workspaceId.current,
          "/api/assets/" + id,
          undefined,
          "DELETE",
        );
        transition(null, false);
      },
    );
  }

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const modalOpen = !!document.querySelector("#modal[open]");
      if (anchor.current) {
        if (popover.current?.contains(event.target as Node))
          event.preventDefault();
        closeMenu(true);
      } else if (detail && !modalOpen) closeDetail();
      else if (referencePicking && !modalOpen) finishPicking();
      else if (library.selecting && !modalOpen) library.reset();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });

  function updateDraft(next: DraftSession) {
    const space = active.current;
    if (space && !leaving.current)
      persist(space, { ...next, submitId: crypto.randomUUID() });
  }

  function change(prompt: string) {
    const session = currentDraft.current;
    if (session && prompt !== session.draft.prompt)
      updateDraft({ ...session, draft: { ...session.draft, prompt } });
  }

  function submit(jobId?: number) {
    const space = active.current;
    const session = currentDraft.current;
    if (
      !space ||
      !session ||
      busy.current.has("upload") ||
      busy.current.has("session")
    )
      return;
    const job = space.jobs.find(({ id }) => id === jobId);
    if (jobId !== undefined && !job) return;
    const { draft } = session;
    const model = job
      ? job.model ||
        (job.kind === "image" ? space.images.default_model : "MiniMax H3")
      : selectedModel(draft);
    if (!modelAvailable(space, model)) return;
    const issue =
      referenceIssue(space, session, job) || flowIssue(space, session, job);
    if (issue) {
      notify(issue);
      return;
    }
    if (!job && !draft.prompt.trim()) return;
    if (!job && draft.prompt.length > promptLimit(draft)) {
      notify("最多输入 " + promptLimit(draft) + " 字");
      return;
    }
    if (!job && !quote(space, draft).allowed) return;
    void mutate("submit", async () => {
      setSubmitting(true);
      try {
        let retryId: string | undefined;
        if (job) {
          retryId = retryIds.current.get(job.id) || crypto.randomUUID();
          retryIds.current.set(job.id, retryId);
        }
        const request = generationRequest(space, session, job, retryId);
        writeDraft(space, session);
        const { id } = await api<{ id: number }>(
          String(space.workspace_id),
          request.path,
          request.body,
        );
        if (!Number.isSafeInteger(id) || id < 1)
          throw new Error("提交结果尚未确认，请重试");
        if (job) retryIds.current.delete(job.id);
        if (!sameSpace(space, active.current) || leaving.current) return;
        const latest = currentDraft.current!;
        if (!job && latest.submitId === session.submitId) {
          const { h3ReferenceDraft, ...values } = latest.draft;
          updateDraft({
            ...latest,
            refs: [],
            parent: null,
            retainedSeed: null,
            draft: {
              ...values,
              prompt: "",
              packs: [],
              h3: { ...emptyH3, mode: h3Options(values.h3).mode },
            },
          });
        }
        notify("已加入生成队列");
        await refresh();
        if (sameSpace(space, active.current) && !leaving.current)
          showResult(id, resultTab(request.kind));
      } finally {
        setSubmitting(false);
      }
    });
  }

  function upload(files: FileList, frame?: FrameSlot) {
    const space = active.current;
    const session = currentDraft.current;
    if (
      !space ||
      !session ||
      !files.length ||
      session.draft.kind === "audio" ||
      busy.current.has("submit") ||
      busy.current.has("session")
    )
      return;
    const selected = Array.from(files);
    void mutate("upload", async () => {
      setUploading(true);
      try {
        for (const file of selected) {
          const current = currentDraft.current;
          if (!current || leaving.current || !sameSpace(space, active.current))
            return;
          const h3 = isH3(current.draft);
          const frameMode = frames(current.draft);
          const form = space.model_forms[selectedModel(current.draft)];
          const limit = form?.references.max ?? 0;
          const pictures = form?.references.counts?.image ?? limit;
          const kind = file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : "image";
          if (
            !frameMode &&
            (limit <= 0 || (kind === "image" && pictures <= 0))
          ) {
            notify("当前模型不支持参考图片，请先切换支持参考图的模型");
            break;
          }
          if (!frameMode && packReferences(current).length >= limit) {
            notify(
              h3
                ? `最多选择 ${limit} 个参考素材`
                : `最多上传 ${limit} 张参考图片`,
            );
            break;
          }
          if (kind !== "image" && (!h3 || frameMode))
            throw new Error("这个模式只接收图片");
          const result = await api<
            Asset & { first_frame?: boolean; resized?: boolean }
          >(
            String(space.workspace_id),
            kind === "image"
              ? "/api/assets"
              : "/api/h3/references?kind=" + kind,
            file,
          );
          const latest = currentDraft.current;
          const refreshed = active.current;
          if (
            !latest ||
            !refreshed ||
            leaving.current ||
            !sameSpace(space, refreshed)
          )
            return;
          ++stateRead.current;
          const withAsset = {
            ...refreshed,
            assets: [
              { ...result, owner: space.me.id },
              ...refreshed.assets.filter((asset) => asset.id !== result.id),
            ],
          };
          active.current = withAsset;
          setState(withAsset);
          if (result.first_frame) notify("动态图或多页图片已按首帧导入");
          else if (result.resized)
            notify(`图片已适配为 ${result.w} × ${result.h}`);
          const nextSession = frameMode
            ? assignFrame(withAsset, latest, result.id, frame)
            : { ...latest, refs: [...latest.refs, result.id] };
          updateDraft(
            syncDraftReferences(
              withAsset,
              withAsset,
              latest,
              nextSession,
              editor.current
                ? (nextRefs) => editor.current!.reindex(nextRefs)
                : undefined,
            ),
          );
          frame = undefined;
        }
        await refresh();
      } finally {
        setUploading(false);
      }
    });
  }

  function changeRefs(refs: string[], removed?: string) {
    const space = active.current;
    const session = currentDraft.current;
    if (!space || !session) return;
    const { draft } = session;
    const options = h3Options(draft.h3);
    const nextSession: DraftSession = {
      ...session,
      refs,
      draft: {
        ...draft,
        ...(removed && isH3(draft)
          ? {
              h3: {
                ...options,
                video_audio: options.video_audio.filter((id) => id !== removed),
              },
            }
          : {}),
      },
    };
    updateDraft(
      syncDraftReferences(
        space,
        space,
        session,
        nextSession,
        editor.current
          ? (nextRefs) => editor.current!.reindex(nextRefs)
          : undefined,
      ),
    );
  }

  const composer = state && session && (
    <Composer
      managePlugins={() => {setSettingsTab("plugins");setPage("settings");}}
      state={state}
      session={session}
      estimate={estimate}
      submitting={submitting}
      uploading={uploading}
      change={change}
      update={updateDraft}
      submit={() => submit()}
      upload={upload}
      menu={
        menu && !menuHidden && anchor.current && isComposerMenu(menu)
          ? menu
          : null
      }
      open={openMenu}
      close={closeMenu}
      preview={preview}
      editor={editor}
      seenMenus={seenComposerMenus.current}
      referenceContents={referenceContents}
      flowSourceContents={flowSourceContents}
    />
  );
  const favorite = (key: string, saved: boolean) => saveFavorites([key], saved);

  if (expired) return <Auth loadingLogo={loadingLogo} />;
  return (
    <>
      <div id="app">
        {state && session ? (
          <div
            className={
              collapsed
                ? "shell collapsed"
                : sidebarChanged
                  ? "shell"
                  : "shell "
            }
            ref={shell}
          >
            <Sidebar
              state={state}
              page={page}
              collapsed={collapsed}
              menu={menuShown && menu && !isComposerMenu(menu) ? menu : null}
              accountOpened={accountOpened}
              navigate={navigate}
              collapse={collapse}
              open={openMenu}
            />
            <div className="workspace">
              <header className="topbar" aria-hidden="true"></header>
              <main id="view" ref={view}>
                {job ? (
                  <JobDetail
                    state={state}
                    job={job}
                    delta={delta}
                    close={closeDetail}
                    favorite={favorite}
                    cancel={cancel}
                    pageTo={(id) => transition({ job: id })}
                    locate={(job) => showResult(job.id, resultTab(job.kind), true)}
                    preview={preview}
                    edit={editJob}
                    again={submit}
                    imageToVideo={imageToVideo}
                    openCanvas={followCanvas}
                    composer={editing ? composer : null}
                    more={(button) => openMenu("detail-more", button)}
                    menuOpen={
                      menu === "detail-more" && !menuHidden && !!anchor.current
                    }
                    menuUsed={detailMenuUsed}
                    notify={notify}
                  />
                ) : image ? (
                  <ImageDetail
                    state={state}
                    asset={image}
                    close={closeDetail}
                    favorite={favorite}
                    use={useAsset}
                    remove={deleteImage}
                  />
                ) : page === "home" && !detail ? (
                  <div className="home-view">
                    <h1>
                      你好，今天想要<span>创作</span>什么？
                    </h1>
                    <div id="home-composer" className="home-composer">
                      {composer}
                    </div>
                    <section className="recent-section">
                      <HistoryHeading open={() => navigate("library")} />
                      <div id="recent-grid">
                        <History
                          state={state}
                          delta={delta}
                          favorite={favorite}
                          detail={openJob}
                          edit={editJob}
                        />
                      </div>
                    </section>
                  </div>
                ) : page === "chat" ? (
                  <div id="chat-root">
                    <ChatWorkspace
                      key={`${state.me.id}:${state.workspace_id}:${chatVisit}`}
                      userId={state.me.id}
                      workspace={state.workspace_id}
                      openCanvas={followCanvas}
                    />
                  </div>
                ) : page === "settings" ? (
                  <Settings
                    state={state}
                    tab={settingsTab}
                    visit={settingsVisit}
                    draft={profileDraft}
                    modelPreferences={modelPreferences.current}
                    navigate={(tab) => {
                      transition(null);
                      setSettingsTab(tab);
                      setSettingsVisit((visit) => visit + 1);
                    }}
                    dialogOpen={!!dialog}
                    open={openSettingsDialog}
                    saved={saveProfile}
                    refresh={refreshSettings}
                    notify={notify}
                    viewLibrary={() => navigate("library")}
                    showWorkspace={showWorkspace}
                    selectWorkspace={selectWorkspace}
                    openAdmin={openAdminDialog}
                    confirmAdmin={confirmAdmin}
                    adminRequest={adminRequest}
                  />
                ) : page === "queue" && !detail ? (
                  <Queue
                    state={state}
                    delta={delta}
                    detail={openJob}
                    cancel={cancel}
                  />
                ) : (
                  <Library
                    library={library}
                    state={state}
                    delta={delta}
                    composer={composer}
                    referencePicking={
                      referencePicking && session
                        ? {
                            ids: new Set(
                              packReferences(session).filter(
                                (id) => referenceType(state, id) === "Picture",
                              ),
                            ),
                            finish: finishPicking,
                          }
                        : null
                    }
                    actions={{
                      favorite,
                      edit: editJob,
                      job: openJob,
                      image: (id) => transition({ image: id }),
                      preview,
                      use: useAsset,
                      filter: setFilter,
                      batchFavorite: () =>
                        saveFavorites(library.keys, !library.allSaved),
                      batchDownload: downloadSelected,
                      batchDelete: deleteSelected,
                    }}
                  />
                )}
              </main>
            </div>
          </div>
        ) : (
          <main
            className="loading-screen"
            role="status"
            aria-label="弗淼 AIGC 正在加载"
            aria-busy="true"
          >
            <div className="loading-brand">
              <img src={loadingLogo} width="48" height="48" alt="" />
              <span>
                弗淼 <b>AIGC</b>
              </span>
            </div>
            <div className="loading-track" aria-hidden="true">
              <span />
            </div>
          </main>
        )}
      </div>
      <div
        role="status"
        id="toast"
        className={toastVisible ? "visible" : toast ? "" : undefined}
      >
        {toast}
      </div>
      <AssetDialog
        key={state?.me.id}
        dialog={dialog}
        admin={state?.me.role === "admin"}
        onClose={() => setDialog(null)}
        notify={notify}
        state={state}
        session={session}
      />
      <div
        id="popover"
        ref={popover}
        tabIndex={-1}
        hidden={menuHidden}
        className={
          menu
            ? `popover ${menu === "account" ? "account-menu" : menu}${menuShown ? " open" : ""}`
            : undefined
        }
        role={menu ? "dialog" : undefined}
        aria-label={
          menu && isComposerMenu(menu)
            ? composerMenuAria.current
            : menu === "workspaces"
              ? "选择工作区"
              : menu === "detail-more"
                ? "更多"
                : menu
                  ? "账户"
                  : undefined
        }
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          const options = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              menu === "mention"
                ? ".ref-entry"
                : '[role="option"]:not(:disabled):not([hidden])',
            ),
          );
          if (
            target.getAttribute("role") === "radio" &&
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          ) {
            const radios = Array.from(
              target.parentElement!.querySelectorAll<HTMLButtonElement>(
                '[role="radio"]:not(:disabled)',
              ),
            );
            const direction = ["ArrowLeft", "ArrowUp"].includes(event.key)
              ? -1
              : 1;
            const index = radios.indexOf(target as HTMLButtonElement);
            const next =
              radios[(index + direction + radios.length) % radios.length];
            if (!next) return;
            event.preventDefault();
            const { act, value } = next.dataset;
            next.click();
            requestAnimationFrame(() => {
              popover.current
                ?.querySelector<HTMLElement>(
                  `[data-act="${CSS.escape(act || "")}"][data-value="${CSS.escape(value || "")}"]`,
                )
                ?.focus();
            });
          } else if (
            options.length > 0 &&
            ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) &&
            !target.matches("input, textarea") &&
            (menu !== "mention" || !["Home", "End"].includes(event.key))
          ) {
            event.preventDefault();
            const current = options.indexOf(
              document.activeElement as HTMLElement,
            );
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length;
            options[index]?.focus();
          }
        }}
      >
        {state &&
          menu === "detail-more" &&
          !menuHidden &&
          job &&
          (isOwner(state, job) ? (
            <button
              className="menu-item danger"
              data-act="delete"
              data-id={job.id}
              onClick={() => deleteJob(job)}
            >
              删除
            </button>
          ) : (
            <span className="empty-note">暂无更多操作</span>
          ))}
        {state && session && menu && isComposerMenu(menu) && !menuHidden && (
          <ComposerMenuContents
            key={menu}
            state={state}
            session={session}
            kind={menu}
            uploading={uploading}
            update={updateDraft}
            close={closeMenu}
            preview={(id) => {
              const opener = anchor.current;
              if (opener) preview(id, opener);
            }}
            insert={(id) => {
              closeMenu();
              editor.current?.insert(id);
            }}
            changeRefs={changeRefs}
            removePack={removePack}
            pickAssets={startPicking}
            openPacks={openPacks}
            notify={notify}
            reposition={positionMenu}
          />
        )}
        {state &&
          menu &&
          menu !== "detail-more" &&
          !isComposerMenu(menu) &&
          !menuHidden && (
            <MenuContents
              kind={menu}
              state={state}
              select={selectWorkspace}
              create={showWorkspace}
              settings={() => navigate("settings")}
              logout={() =>
                void mutate("session", async () => {
                  await api(workspaceId.current, "/api/logout", {});
                  leaving.current = true;
                  location.reload();
                })
              }
            />
          )}
      </div>
    </>
  );
}
