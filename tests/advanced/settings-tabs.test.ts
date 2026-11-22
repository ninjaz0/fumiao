import assert from "node:assert/strict";
import test from "node:test";
import {
  pluginTab,
  resolvePluginTab,
} from "../../apps/web/studio/settings-tabs.js";
import type { PluginPageEntry } from "@fumiao/plugin-sdk/contributions.js";

function page(plugin: string, legacy: boolean): PluginPageEntry {
  const page = legacy ? "nodes" : "summary";
  return {
    key: `plugin:${plugin}:${page}`,
    plugin,
    page,
    title: plugin,
    legacy,
    version: "1",
    icon: "sliders",
    group: "services",
    order: 0,
    audience: "admin",
  };
}

test("gpu resolves to the first visible legacy page, even when page IDs repeat across packages", () => {
  const entries = [
    page("extension", false),
    page("first", true),
    page("second", true),
  ];
  assert.equal(resolvePluginTab("gpu", entries, false), "plugin:first:nodes");
  assert.equal(
    resolvePluginTab(pluginTab(entries[2]), entries, false),
    "plugin:second:nodes",
  );
});

test("only a missing page list enables the old GPU panel", () => {
  assert.equal(resolvePluginTab("gpu", undefined, true), "gpu");
  assert.equal(resolvePluginTab("gpu", undefined, false), "general");
  assert.equal(resolvePluginTab("gpu", [], true), "general");
  assert.equal(
    resolvePluginTab("gpu", [page("extension", false)], true),
    "general",
  );
});

test("a removed or hidden page returns to general settings and fixed tabs stay selected", () => {
  assert.equal(resolvePluginTab("plugin:removed:summary", [], true), "general");
  assert.equal(resolvePluginTab("credits", [], false), "credits");
});
