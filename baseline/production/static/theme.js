"use strict";
(() => {
  const storageKey = "fumiao-appearance";
  function apply(value) {
    const dark = value === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = dark
      ? "#171918"
      : "#f8f9fa";
    for (const button of document.querySelectorAll('[data-act="theme"]')) {
      button.setAttribute("aria-pressed", String(dark));
      button.title = dark ? "切换到浅色" : "切换到深色";
    }
  }
  let saved;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {}
  apply(saved);
  window.setFumiaoTheme = (value) => {
    apply(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {}
  };
  window.addEventListener("storage", (e) => {
    if (e.key === storageKey || e.key === null) apply(e.newValue);
  });
})();
