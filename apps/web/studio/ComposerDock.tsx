import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

function applyCaret(target: HTMLElement, range: Range) {
  const selection = getSelection();
  if (
    document.activeElement === target &&
    target.contains(range.startContainer) &&
    target.contains(range.endContainer) &&
    selection
  ) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/**
 * Phone wrapper (≤760px) around the one shared Composer: a compact bar above
 * the tab bar that opens into a bottom sheet. Only this wrapper's attributes
 * change between the two forms, so the Composer is never moved or remounted.
 * On wider screens it renders inert wrappers and clears its measurements.
 */
export function ComposerDock({
  narrow,
  expanded,
  setExpanded,
  children,
}: {
  narrow: boolean;
  expanded: boolean;
  setExpanded: (next: boolean) => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const caret = useRef<Range | null>(null);
  const lastOpenCaret = useRef<Range | null>(null);
  const savedScrollTop = useRef<number | null>(null);
  const lastOpenScrollTop = useRef(0);
  const open = narrow && expanded;
  const latest = useRef({ narrow, expanded, setExpanded });
  useLayoutEffect(() => {
    latest.current = { narrow, expanded, setExpanded };
  });

  const snapshotOpenScrollTop = () => {
    const dock = sheet.current?.closest<HTMLElement>(".composer-dock");
    if (dock?.dataset.expanded !== "true") return;
    const promptEl = sheet.current?.querySelector<HTMLElement>("#prompt");
    if (promptEl) lastOpenScrollTop.current = promptEl.scrollTop;
  };

  // Any interaction inside the collapsed bar opens the sheet, except sending.
  // Clicks count too: iOS Safari does not focus buttons it taps.
  useEffect(() => {
    const node = sheet.current!;
    let pending: {
      target: HTMLElement;
      range: Range | null;
      scrollTop: number | null;
      frame: number;
    } | null = null;
    const clearPending = () => {
      if (!pending) return;
      cancelAnimationFrame(pending.frame);
      pending = null;
    };
    const trackSelection = () => {
      const current = latest.current;
      if (!current.narrow || !current.expanded) return;
      snapshotOpenScrollTop();
      const active = document.activeElement;
      const selection = getSelection();
      if (
        active instanceof HTMLElement &&
        active.isContentEditable &&
        node.contains(active) &&
        selection?.rangeCount &&
        active.contains(selection.anchorNode) &&
        active.contains(selection.focusNode)
      ) {
        lastOpenCaret.current = selection.getRangeAt(0).cloneRange();
      }
    };
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.id !== "prompt") return;
      const current = latest.current;
      if (!current.narrow) return;
      if (current.expanded) {
        snapshotOpenScrollTop();
      } else if (!pending && target.scrollTop !== 0) {
        target.scrollTop = 0;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      clearPending();
      if (latest.current.narrow && latest.current.expanded) {
        snapshotOpenScrollTop();
      }
      if (
        latest.current.expanded &&
        event.target instanceof Element &&
        event.target.closest("[contenteditable]")
      ) {
        caret.current = null;
        savedScrollTop.current = null;
      }
    };
    const onKeyDown = () => {
      clearPending();
      if (latest.current.narrow && latest.current.expanded) {
        snapshotOpenScrollTop();
      }
    };
    const onFocusOut = () => {
      clearPending();
      if (latest.current.narrow && latest.current.expanded) {
        snapshotOpenScrollTop();
      }
    };
    const expand = (event: Event) => {
      const current = latest.current;
      if (!current.narrow || current.expanded) return;
      if (event.target instanceof Element && event.target.closest(".generate-button"))
        return;
      current.setExpanded(true);
    };
    // Returning to the prompt puts the caret and scroll offset back where folding
    // left them, not where the one-line preview was tapped; any edit cancels replay.
    const restoreCaret = (event: FocusEvent) => {
      const range = caret.current;
      const scroll = savedScrollTop.current;
      const target = event.target;
      if (
        (!range && scroll === null) ||
        !(target instanceof HTMLElement) ||
        !target.isContentEditable
      )
        return;
      caret.current = null;
      savedScrollTop.current = null;
      clearPending();
      if (range) applyCaret(target, range);
      if (scroll !== null) target.scrollTop = scroll;
      const frame = requestAnimationFrame(() => {
        if (pending?.frame === frame) {
          if (range) applyCaret(target, range);
          if (scroll !== null) {
            target.scrollTop = scroll;
            lastOpenScrollTop.current = target.scrollTop;
          }
          pending = null;
        }
      });
      pending = { target, range, scrollTop: scroll, frame };
    };
    const reapplyPending = () => {
      if (!pending) return;
      if (pending.range) applyCaret(pending.target, pending.range);
      if (pending.scrollTop !== null) pending.target.scrollTop = pending.scrollTop;
    };
    document.addEventListener("selectionchange", trackSelection);
    node.addEventListener("scroll", onScroll, true);
    node.addEventListener("pointerdown", onPointerDown, true);
    node.addEventListener("focusin", restoreCaret);
    node.addEventListener("focusin", expand);
    node.addEventListener("mouseup", reapplyPending);
    node.addEventListener("click", expand, true);
    node.addEventListener("click", reapplyPending);
    node.addEventListener("beforeinput", clearPending, true);
    node.addEventListener("input", clearPending, true);
    node.addEventListener("input", trackSelection);
    node.addEventListener("keydown", onKeyDown, true);
    node.addEventListener("keyup", trackSelection);
    node.addEventListener("focusout", onFocusOut);
    return () => {
      clearPending();
      document.removeEventListener("selectionchange", trackSelection);
      node.removeEventListener("scroll", onScroll, true);
      node.removeEventListener("pointerdown", onPointerDown, true);
      node.removeEventListener("focusin", restoreCaret);
      node.removeEventListener("focusin", expand);
      node.removeEventListener("mouseup", reapplyPending);
      node.removeEventListener("click", expand, true);
      node.removeEventListener("click", reapplyPending);
      node.removeEventListener("beforeinput", clearPending, true);
      node.removeEventListener("input", clearPending, true);
      node.removeEventListener("input", trackSelection);
      node.removeEventListener("keydown", onKeyDown, true);
      node.removeEventListener("keyup", trackSelection);
      node.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Page content clears the bar plus the tab bar; the open sheet covers the
  // page, so it reserves the tab bar only.
  useLayoutEffect(() => {
    const node = sheet.current!;
    const shell = node.closest<HTMLElement>(".shell");
    if (!shell) return;
    if (!narrow) {
      shell.style.removeProperty("--mobile-dock-height");
      return;
    }
    const measure = () => {
      const height = expanded ? 0 : Math.ceil(node.getBoundingClientRect().height);
      shell.style.setProperty(
        "--mobile-dock-height",
        `calc(${height}px + var(--mobile-tabbar-height))`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--mobile-dock-height");
    };
  }, [narrow, expanded]);

  // Folding the sheet dismisses the soft keyboard instead of leaving it over
  // the one-line bar, resets #prompt.scrollTop to 0 so the first line renders
  // cleanly, and remembers caret + scrollTop for the next time it opens.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const promptEl = sheet.current?.querySelector<HTMLElement>("#prompt");
    if (narrow && wasOpen.current && !open) {
      const nextScrollTop = promptEl?.textContent ? lastOpenScrollTop.current : 0;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.isContentEditable &&
        sheet.current!.contains(active)
      ) {
        const selection = getSelection();
        caret.current =
          selection?.rangeCount &&
          active.contains(selection.anchorNode) &&
          active.contains(selection.focusNode)
            ? selection.getRangeAt(0).cloneRange()
            : lastOpenCaret.current;
        active.blur();
      } else {
        caret.current = lastOpenCaret.current;
      }
      savedScrollTop.current = nextScrollTop;
      lastOpenCaret.current = null;
      lastOpenScrollTop.current = 0;
      if (promptEl) promptEl.scrollTop = 0;
    } else if (narrow && !open) {
      if (promptEl) promptEl.scrollTop = 0;
    } else if (narrow && !wasOpen.current && open) {
      if (savedScrollTop.current !== null && promptEl) {
        promptEl.scrollTop = savedScrollTop.current;
        lastOpenScrollTop.current = savedScrollTop.current;
      }
    } else if (!narrow) {
      caret.current = null;
      lastOpenCaret.current = null;
      savedScrollTop.current = null;
      lastOpenScrollTop.current = 0;
    }
    wasOpen.current = open;
  }, [narrow, open]);

  return (
    <div
      className="composer-dock"
      data-narrow={narrow || undefined}
      data-expanded={String(open)}
    >
      {open && (
        <button
          type="button"
          className="composer-dock-backdrop"
          aria-label="收起创作框"
          tabIndex={-1}
          onPointerDown={snapshotOpenScrollTop}
          onClick={() => {
            snapshotOpenScrollTop();
            setExpanded(false);
          }}
        />
      )}
      <div className="composer-dock-sheet" ref={sheet}>
        {open && (
          <button
            type="button"
            className="composer-dock-handle"
            aria-label="收起创作框"
            onClick={() => {
              snapshotOpenScrollTop();
              setExpanded(false);
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
