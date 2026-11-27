export function alignChoiceMenuToTrigger(menu: HTMLDivElement | null) {
  const trigger = menu?.previousElementSibling;
  if (!menu || !trigger) return;

  const position = () => {
    const { left } = trigger.getBoundingClientRect();
    const { width } = menu.getBoundingClientRect();
    const safeLeft = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    menu.style.setProperty("--choice-menu-shift", `${safeLeft - left}px`);
  };

  position();
  const observer = new ResizeObserver(position);
  observer.observe(menu);
  observer.observe(trigger);
  window.addEventListener("resize", position);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", position);
  };
}
