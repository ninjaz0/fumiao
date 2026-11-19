import assert from "node:assert/strict";
import test from "node:test";
import {
  countTeamPolicyDiffs,
  filterTeamScopes,
} from "../../apps/web/studio/model-policy-scope.js";
import {
  pluginTab,
  resolvePluginTab,
} from "../../apps/web/studio/settings-tabs.js";
import type { Space, StudioState } from "../../apps/web/studio/state.js";
import type { PluginPageEntry } from "../../packages/plugin-sdk/src/contributions.js";

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

test("countTeamPolicyDiffs and filterTeamScopes scale cleanly for many team workspaces", () => {
  const groups: StudioState["model_groups"] = {
    "minimax-h3": { label: "MiniMax H3", kind: "video", models: ["m1", "m2"] },
    "flow-image": { label: "Flow Image", kind: "image", models: ["i1"] },
    "breeze-tts": { label: "Breeze TTS", kind: "audio", models: ["a1"] },
  };
  const global = {
    revision: 1,
    enabled: { m1: true, m2: false, i1: false, a1: true },
  };
  const customTeam = {
    revision: 2,
    enabled: { m1: false, m2: false, i1: true, a1: true },
  };
  const sameTeam = {
    revision: 1,
    enabled: { m1: true, m2: false, i1: false, a1: true },
  };

  assert.equal(countTeamPolicyDiffs(groups, global, customTeam), 2);
  assert.equal(countTeamPolicyDiffs(groups, global, sameTeam), 0);
  assert.equal(countTeamPolicyDiffs(groups, global, undefined), 0);

  const teams: Space[] = Array.from({ length: 24 }, (_, idx) => ({
    id: idx + 1,
    name: idx === 0 ? "品牌视觉组" : idx === 11 ? "商业广告组" : `创作团队-${idx + 1}`,
    kind: "team",
    member_count: 5,
    revision: 1,
  }));
  const diffs = (id: number) => (id === 1 || id === 12 ? 2 : 0);

  assert.equal(filterTeamScopes(teams, "", false, diffs).length, 24);
  assert.deepEqual(
    filterTeamScopes(teams, "", true, diffs).map((t) => t.id),
    [1, 12],
  );
  assert.deepEqual(
    filterTeamScopes(teams, "商业", false, diffs).map((t) => t.name),
    ["商业广告组"],
  );
  assert.deepEqual(
    filterTeamScopes(teams, "团队-15", true, diffs),
    [],
  );
});
