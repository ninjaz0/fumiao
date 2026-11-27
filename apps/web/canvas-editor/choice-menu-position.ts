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
