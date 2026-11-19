/** Self-contained pre-paint initialization, serialized with a per-response CSP nonce. */
export function initializeHomepage({
  homepage = true,
  syncThemeColor = false,
} = {}) {
  const storageKey = "fumiao-appearance";
  const themeColor = syncThemeColor ? document.createElement("meta") : null;
  const apply = (value: string | null) => {
    const dark = value === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    if (themeColor) themeColor.content = dark ? "#171918" : "#f8f9fa";
  };
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {}
  apply(saved);
  // React matches head metadata by its content during hydration.
  if (themeColor) {
    themeColor.name = "theme-color";
    document.head.append(themeColor);
  }
  window.setFumiaoTheme = (value) => {
    apply(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {}
    window.dispatchEvent(new Event("fumiao-theme"));
  };
  window.addEventListener("storage", (e) => {
    if (e.key === storageKey || e.key === null) apply(e.newValue);
  });
  if (!homepage) return;
  const forward = () => {
    const hash = location.hash;
    if (
      hash === "#login" ||
      hash === "#register" ||
      new URLSearchParams(hash.slice(1)).has("invite")
    )
      location.replace("/studio" + location.search + hash);
  };
  forward();
  window.addEventListener("hashchange", forward);
}

declare global {
  interface Window {
    setFumiaoTheme?: (value: "light" | "dark") => void;
  }
}
