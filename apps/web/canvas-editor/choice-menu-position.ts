export function matchChoiceMenuRect(
  trigger: { left: number; width: number },
  viewportWidth: number,
) {
  const width = Math.min(trigger.width, viewportWidth);
  const left = Math.max(0, Math.min(trigger.left, viewportWidth - width));
  return { left, width };
}

export function alignChoiceMenuToTrigger(menu: HTMLDivElement | null) {
  const trigger = menu?.previousElementSibling;
  if (!menu || !trigger) return;

  const position = () => {
    const triggerRect = trigger.getBoundingClientRect();
    const { left, width } = matchChoiceMenuRect(triggerRect, window.innerWidth);
    menu.style.setProperty("--choice-menu-shift", `${left - triggerRect.left}px`);
    menu.style.setProperty("--choice-menu-width", `${width}px`);
  };

  position();
  const observer = new ResizeObserver(position);
  observer.observe(trigger);
  window.addEventListener("resize", position);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", position);
  };
}

export function positionStudioPopover(
  trigger: HTMLElement | null,
  element: HTMLElement | null,
  viewportWidth: number,
  viewportHeight: number,
  narrow: boolean,
) {
  if (!trigger?.isConnected || !element) return;
  if (narrow) {
    element.dataset.sheet = "";
    element.style.left = "";
    element.style.top = "";
    element.style.width = "";
    element.style.removeProperty("--motion-popover-x");
    element.style.removeProperty("--motion-popover-y");
    delete trigger.dataset.choiceDirection;
    return;
  }
  delete element.dataset.sheet;
  const box = trigger.getBoundingClientRect();
  const beside = trigger.dataset.menu === "workspaces" && viewportWidth > 760;
  const choice = element.querySelector(".fm-choice-menu")
    ? matchChoiceMenuRect(box, viewportWidth)
    : null;
  element.style.width = choice ? `${choice.width}px` : "";
  const left =
    choice?.left ??
    Math.min(
      Math.max(12, beside ? box.right + 12 : box.left - 16),
      viewportWidth - element.offsetWidth - 12,
    );
  let top = beside ? box.top : box.bottom + 8;
  const above = top + element.offsetHeight > viewportHeight - 14;
  if (choice) trigger.dataset.choiceDirection = above ? "up" : "down";
  else delete trigger.dataset.choiceDirection;
  if (above) top = Math.max(12, box.top - element.offsetHeight - 8);
  Object.assign(element.style, {
    left: left + "px",
    top: top + "px",
  });
  element.style.setProperty("--motion-popover-x", beside ? "-4px" : "0px");
  element.style.setProperty(
    "--motion-popover-y",
    beside ? "0px" : above ? "4px" : "-4px",
  );
}

export function stepChoiceMenuFocus<T>(
  buttons: readonly T[],
  activeIndex: number,
  key: string,
) {
  if (buttons.length === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return buttons.length - 1;
  if (activeIndex < 0) return key === "ArrowDown" ? 0 : buttons.length - 1;
  return (
    (activeIndex + (key === "ArrowDown" ? 1 : -1) + buttons.length) %
    buttons.length
  );
}

export function restoreChoiceMenuTriggerFocus(element: Element | null) {
  const pop = element?.closest(".cv-menu") ?? element;
  if (
    pop?.matches(".fm-choice-menu") &&
    pop.previousElementSibling instanceof HTMLButtonElement
  ) {
    pop.previousElementSibling.focus({ preventScroll: true });
  }
}
