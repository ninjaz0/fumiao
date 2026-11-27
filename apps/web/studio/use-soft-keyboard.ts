import { useEffect, useState } from "react";

const keyboardThreshold = 150;

function editing(element: Element | null) {
  return !!element?.matches("input, textarea, [contenteditable]:not([contenteditable=\"false\"])");
}

/**
 * Reports whether a soft keyboard covers the page: the visual viewport is
 * more than 150px shorter than the layout viewport while an editable element
 * has focus. Also publishes the visual viewport height as
 * `--visual-viewport-height` on the root element.
 */
export function useSoftKeyboard(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
      setOpen(
        innerHeight - viewport.height > keyboardThreshold &&
          editing(document.activeElement),
      );
    };
    update();
    viewport.addEventListener("resize", update);
    // Focus can leave the field without a resize, e.g. when tapping a button.
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.style.removeProperty("--visual-viewport-height");
    };
  }, []);
  return open;
}
