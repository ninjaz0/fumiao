"use client";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import type {} from "./bootstrap";

function subscribeTheme(change: () => void) {
  window.addEventListener("storage", change);
  window.addEventListener("fumiao-theme", change);
  return () => {
    window.removeEventListener("storage", change);
    window.removeEventListener("fumiao-theme", change);
  };
}
export function useAppearance() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "dark",
    () => false,
  );
  useEffect(() => {
    // Next owns this metadata node: mutate after hydration so React does not
    // create a second meta tag when the saved appearance differs from SSR.
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta) meta.content = dark ? "#171918" : "#f8f9fa";
  }, [dark]);
  return dark;
}
export function ThemeButton(props: ComponentProps<"button">) {
  const dark = useAppearance();
  return (
    <button
      {...props}
      aria-pressed={dark}
      title={dark ? "切换到浅色" : "切换到深色"}
      onClick={() => window.setFumiaoTheme?.(dark ? "light" : "dark")}
    />
  );
}
export function Header(props: ComponentProps<"header">) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", update, { passive: true });
    update();
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <header {...props} className={"top" + (scrolled ? " scrolled" : "")} />
  );
}
