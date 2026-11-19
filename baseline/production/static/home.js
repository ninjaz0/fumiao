"use strict";
(() => {
  // Old workbench fragments (/#login, /#register, /#invite=…) are invisible to the server.
  // Forward them to the workbench before the homepage paints so the original flow is kept.
  const hash = location.hash;
  const forwards = (value) => value === "#login" || value === "#register" || new URLSearchParams(value.slice(1)).has("invite");
  if (forwards(hash)) {
    location.replace("/studio" + location.search + hash);
    return;
  }
  window.addEventListener("hashchange", () => {
    if (forwards(location.hash)) location.replace("/studio" + location.search + location.hash);
  });

  const NS = "http://www.w3.org/2000/svg";
  let serial = 0;

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (parent) parent.appendChild(node);
    return node;
  }

  function gradient(defs, id, cls, vertical) {
    const g = el("linearGradient", vertical ? { id, x1: "0", y1: "0", x2: "0", y2: "1" } : { id }, defs);
    el("stop", { offset: "0", class: cls + "-a" }, g);
    el("stop", { offset: ".5", class: cls + "-b" }, g);
    el("stop", { offset: "1", class: cls + "-c" }, g);
    return "url(#" + id + ")";
  }

  // Abstract, data-free stand-ins for media: sky, horizon and the login-page ribbon motif.
  function paintScene(svg) {
    const kind = svg.dataset.scene || "dawn";
    const id = "s" + ++serial;
    svg.classList.add("scene-" + kind);
    const defs = el("defs", {}, svg);
    const sky = gradient(defs, id + "sky", "sky", true);
    const thread = gradient(defs, id + "thread", "thread", false);
    el("rect", { width: "320", height: "200", fill: sky }, svg);
    el("circle", { cx: kind === "dusk" ? "232" : "88", cy: kind === "noon" ? "52" : "86", r: "26", class: "sun" }, svg);
    el("rect", { y: "128", width: "320", height: "72", class: "sea" }, svg);
    const lines = el("g", { stroke: thread, fill: "none", "stroke-width": "1.1" }, svg);
    const shift = kind === "noon" ? 18 : kind === "dusk" ? -14 : 0;
    for (let i = 0; i < 22; i++) {
      el("path", {
        d: `M-30 ${150 + shift / 2 + i * 1.6} C 60 ${110 + i * 2.2}, 110 ${190 - i * 1.4}, 170 ${120 + shift - i * 0.9} S 280 ${70 + i * 1.8}, 360 ${96 + i * 1.5}`,
      }, lines);
    }
  }

  function paintRibbon(svg) {
    const defs = el("defs", {}, svg);
    const thread = gradient(defs, "closing-thread", "thread", false);
    const lines = el("g", { stroke: thread, fill: "none", "stroke-width": "1.2" }, svg);
    for (let i = 0; i < 40; i++) {
      el("path", {
        d: `M-60 ${120 + i * 1.9} C 70 ${60 + i * 2.6}, 140 ${200 - i * 1.8}, 250 ${110 - i * 1.1} S 400 ${30 + i * 2}, 540 ${46 + i * 2.1}`,
      }, lines);
    }
  }

  function syncThemeButtons() {
    const dark = document.documentElement.dataset.theme === "dark";
    for (const button of document.querySelectorAll('[data-act="theme"]')) {
      button.setAttribute("aria-pressed", String(dark));
      button.title = dark ? "切换到浅色" : "切换到深色";
    }
  }

  function ready() {
    for (const svg of document.querySelectorAll("svg.scene[data-scene]")) paintScene(svg);
    for (const svg of document.querySelectorAll("svg[data-ribbon]")) paintRibbon(svg);
    syncThemeButtons();
    for (const button of document.querySelectorAll('[data-act="theme"]')) {
      button.addEventListener("click", () => {
        const dark = document.documentElement.dataset.theme === "dark";
        if (window.setFumiaoTheme) window.setFumiaoTheme(dark ? "light" : "dark");
        syncThemeButtons();
      });
    }
    // Another tab may change the appearance; theme.js applies it, we only refresh labels.
    window.addEventListener("storage", syncThemeButtons);
    const top = document.querySelector(".top");
    const onScroll = () => top.classList.toggle("scrolled", window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
