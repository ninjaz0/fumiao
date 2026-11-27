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
  const open = narrow && expanded;
  const latest = useRef({ narrow, expanded, setExpanded });
  useLayoutEffect(() => {
    latest.current = { narrow, expanded, setExpanded };
  });

  // Any interaction inside the collapsed bar opens the sheet, except sending.
  // Clicks count too: iOS Safari does not focus buttons it taps.
  useEffect(() => {
    const node = sheet.current!;
    let pending: { target: HTMLElement; range: Range; frame: number } | null = null;
    const clearPending = () => {
      if (!pending) return;
      cancelAnimationFrame(pending.frame);
      pending = null;
    };
    const trackSelection = () => {
      const current = latest.current;
      if (!current.narrow || !current.expanded) return;
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
    const onPointerDown = (event: PointerEvent) => {
      clearPending();
      if (
        latest.current.expanded &&
        event.target instanceof Element &&
        event.target.closest("[contenteditable]")
      ) {
        caret.current = null;
      }
    };
    const expand = (event: Event) => {
      const current = latest.current;
      if (!current.narrow || current.expanded) return;
      if (event.target instanceof Element && event.target.closest(".generate-button"))
        return;
      current.setExpanded(true);
    };
    // Returning to the prompt puts the caret back where folding left it,
    // not where the one-line preview was tapped; any edit cancels the replay.
    const restoreCaret = (event: FocusEvent) => {
      const range = caret.current;
      const target = event.target;
      if (!range || !(target instanceof HTMLElement) || !target.isContentEditable) return;
      caret.current = null;
      clearPending();
      applyCaret(target, range);
      const frame = requestAnimationFrame(() => {
        if (pending?.frame === frame) {
          applyCaret(target, range);
          pending = null;
        }
      });
      pending = { target, range, frame };
    };
    const reapplyPending = () => {
      if (pending) applyCaret(pending.target, pending.range);
    };
    document.addEventListener("selectionchange", trackSelection);
    node.addEventListener("pointerdown", onPointerDown, true);
    node.addEventListener("focusin", restoreCaret);
    node.addEventListener("focusin", expand);
    node.addEventListener("mouseup", reapplyPending);
    node.addEventListener("click", expand, true);
    node.addEventListener("click", reapplyPending);
    node.addEventListener("beforeinput", clearPending, true);
    node.addEventListener("input", clearPending, true);
    node.addEventListener("input", trackSelection);
    node.addEventListener("keydown", clearPending, true);
    node.addEventListener("keyup", trackSelection);
    node.addEventListener("focusout", clearPending);
    return () => {
      clearPending();
      document.removeEventListener("selectionchange", trackSelection);
      node.removeEventListener("pointerdown", onPointerDown, true);
      node.removeEventListener("focusin", restoreCaret);
      node.removeEventListener("focusin", expand);
      node.removeEventListener("mouseup", reapplyPending);
      node.removeEventListener("click", expand, true);
      node.removeEventListener("click", reapplyPending);
      node.removeEventListener("beforeinput", clearPending, true);
      node.removeEventListener("input", clearPending, true);
      node.removeEventListener("input", trackSelection);
      node.removeEventListener("keydown", clearPending, true);
      node.removeEventListener("keyup", trackSelection);
      node.removeEventListener("focusout", clearPending);
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
  // the one-line bar, and remembers the caret for the next time it opens.
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    if (narrow && wasOpen.current && !open) {
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
      lastOpenCaret.current = null;
    } else if (!narrow) {
      caret.current = null;
      lastOpenCaret.current = null;
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
          onClick={() => setExpanded(false)}
        />
      )}
      <div className="composer-dock-sheet" ref={sheet}>
        {open && (
          <button
            type="button"
            className="composer-dock-handle"
            aria-label="收起创作框"
            onClick={() => setExpanded(false)}
          />
        )}
        {children}
      </div>
    </div>
  );
}
