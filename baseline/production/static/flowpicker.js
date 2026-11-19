"use strict";
var FlowPicker = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/flowPicker.ts
  var flowPicker_exports = {};
  __export(flowPicker_exports, {
    family: () => family,
    grouped: () => grouped,
    label: () => label,
    modeLabels: () => modeLabels,
    options: () => options,
    resolve: () => resolve,
    sameFamily: () => sameFamily
  });
  var modeLabels = { t2v: "\u6587\u751F\u89C6\u9891", i2v: "\u56FE\u751F\u89C6\u9891", r2v: "\u53C2\u8003\u56FE\u89C6\u9891", extend: "\u89C6\u9891\u7EED\u5199", omni: "\u81EA\u52A8" };
  function family(catalog, model) {
    return catalog[model]?.family || model;
  }
  function label(catalog, model) {
    return catalog[model]?.family_label || catalog[model]?.label || model;
  }
  function sameFamily(catalog, a, b) {
    return family(catalog, a) === family(catalog, b);
  }
  function variants(catalog, model, available) {
    return Object.entries(catalog).filter(([id, spec]) => sameFamily(catalog, id, model) && !spec.hidden && available(id));
  }
  function resolve(catalog, model, available, want = {}) {
    if (!catalog[model]?.family) return available(model) ? model : "";
    let pool = variants(catalog, model, available);
    if (!pool.length) return "";
    const modes = [...new Set(pool.map(([, spec]) => spec.mode))];
    const preferredMode = want.mode || catalog[model]?.mode;
    const mode = modes.includes(preferredMode) ? preferredMode : ["t2v", "omni", "i2v", "r2v", "extend"].find((m) => modes.includes(m));
    pool = pool.filter(([, spec]) => spec.mode === mode);
    const ratios = [...new Set(pool.map(([, spec]) => spec.ratio))];
    const ratio = ratios.includes(want.ratio) ? want.ratio : ratios.includes("16:9") ? "16:9" : ratios[0];
    pool = pool.filter(([, spec]) => spec.ratio === ratio);
    const seconds = Number.isFinite(want.seconds) ? Number(want.seconds) : 8;
    pool.sort(([a, sa], [b, sb]) => Math.abs(Number(sa.seconds) - seconds) - Math.abs(Number(sb.seconds) - seconds) || Number(sa.seconds) - Number(sb.seconds) || Number(a === family(catalog, a)) - Number(b === family(catalog, b)) || a.localeCompare(b));
    return pool[0]?.[0] || "";
  }
  function options(catalog, model, available) {
    const pool = variants(catalog, model, available), current = catalog[model];
    const modes = [...new Set(pool.map(([, spec]) => spec.mode).filter((m) => Boolean(m)))];
    const inMode = pool.filter(([, spec]) => spec.mode === current?.mode);
    const ratios = [...new Set(inMode.map(([, spec]) => spec.ratio).filter((r) => Boolean(r)))];
    const seconds = [...new Set(inMode.filter(([, spec]) => spec.ratio === current?.ratio).map(([, spec]) => Number(spec.seconds)))].sort((a, b) => a - b);
    return { modes, ratios, seconds };
  }
  function grouped(models, catalog, available, current, want = {}) {
    const seen = /* @__PURE__ */ new Set(), result = [];
    for (const [id, title] of Object.entries(models)) {
      if (!available(id) || catalog[id]?.hidden) continue;
      const key = family(catalog, id);
      if (seen.has(key)) continue;
      seen.add(key);
      const model = resolve(catalog, id, available, { ...want, mode: sameFamily(catalog, id, current) ? catalog[current]?.mode : void 0 });
      if (model) result.push([model, catalog[id]?.family ? label(catalog, id) : title]);
    }
    return result;
  }
  return __toCommonJS(flowPicker_exports);
})();
