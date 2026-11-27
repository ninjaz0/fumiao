import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatSettingsHref,
  chatSettingsPath,
  hasAvailableChatModels,
  resolveChatConfigTarget,
  resolveChatModelScope,
} from "../../apps/web/canvas-editor/chat/guidance.js";

test("hasAvailableChatModels distinguishes loading, empty, and populated model maps", () => {
  assert.equal(hasAvailableChatModels(null), null);
  assert.equal(hasAvailableChatModels(undefined), null);
  assert.equal(hasAvailableChatModels({ models: {} }), false);
  assert.equal(
    hasAvailableChatModels({
      models: { "deepseek-flash": { label: "DeepSeek Flash" } },
    }),
    true,
  );
});

test("resolveChatConfigTarget picks plugins when plugin is not imported or imported-but-disabled", () => {
  assert.equal(resolveChatConfigTarget(null), "plugins");
  assert.equal(resolveChatConfigTarget(undefined), "plugins");
  assert.equal(
    resolveChatConfigTarget({ studio_plugins: true, model_groups: {} }),
    "modelAccess",
  );
  assert.equal(
    resolveChatConfigTarget({
      studio_plugins: true,
      model_groups: {
        chat: { kind: "chat", models: ["deepseek-flash"] },
      },
      model_policy: { revision: 1, enabled: { "deepseek-flash": true } },
    }),
    "plugins",
  );
  assert.equal(
    resolveChatConfigTarget({
      studio_plugins: false,
      model_groups: {
        chat: { kind: "chat", models: ["deepseek-flash"] },
      },
      model_policy: { revision: 1, enabled: { "deepseek-flash": true } },
    }),
    "chatService",
  );
});

test("resolveChatConfigTarget and resolveChatModelScope align personal, global, and team policy scopes", () => {
  const globalDisabledInPersonal = {
    studio_plugins: true,
    workspace_id: 1,
    workspaces: [{ id: 1, kind: "personal" }],
    model_groups: {
      video: { kind: "video", models: ["muse-v1"] },
      chat: { kind: "chat", models: ["deepseek-flash", "gpt-4.1"] },
    },
    model_policy: {
      revision: 2,
      enabled: {
        "muse-v1": true,
        "deepseek-flash": false,
        "gpt-4.1": false,
      },
    },
  };
  assert.equal(resolveChatConfigTarget(globalDisabledInPersonal), "models");
  assert.equal(resolveChatModelScope(globalDisabledInPersonal), "global");
  assert.equal(
    chatSettingsPath(globalDisabledInPersonal),
    "/studio?settings=models",
  );

  const teamDisabledOnly = {
    studio_plugins: true,
    workspace_id: 9,
    workspaces: [
      { id: 1, kind: "personal" },
      { id: 9, kind: "team" },
    ],
    model_groups: {
      chat: { kind: "chat", models: ["deepseek-flash"] },
    },
    model_policy: { revision: 1, enabled: { "deepseek-flash": true } },
    team_model_policies: {
      "9": { revision: 1, enabled: { "deepseek-flash": false } },
    },
  };
  assert.equal(resolveChatConfigTarget(teamDisabledOnly), "models");
  assert.equal(resolveChatModelScope(teamDisabledOnly), "9");
  assert.equal(
    chatSettingsPath(teamDisabledOnly),
    "/studio?settings=models&scope=9",
  );

  const globalDisabledTeamOpen = {
    studio_plugins: true,
    workspace_id: 9,
    workspaces: [
      { id: 1, kind: "personal" },
      { id: 9, kind: "team" },
    ],
    model_groups: {
      chat: { kind: "chat", models: ["deepseek-flash"] },
    },
    model_policy: { revision: 1, enabled: { "deepseek-flash": false } },
    team_model_policies: {
      "9": { revision: 0, enabled: { "deepseek-flash": true } },
    },
  };
  assert.equal(resolveChatConfigTarget(globalDisabledTeamOpen), "models");
  assert.equal(resolveChatModelScope(globalDisabledTeamOpen), "global");
  assert.equal(
    chatSettingsPath(globalDisabledTeamOpen),
    "/studio?settings=models",
  );
});

test("chatSettingsHref and chatSettingsPath build workspace-scoped settings URLs", () => {
  assert.equal(
    chatSettingsPath({ studio_plugins: true, model_groups: {} }),
    "/studio?settings=modelAccess",
  );
  assert.equal(
    chatSettingsPath({ studio_plugins: false, model_groups: {} }),
    "/studio?settings=chatService",
  );
  assert.equal(
    chatSettingsHref(42, "plugins"),
    "/studio?settings=plugins&workspace=42",
  );
  assert.equal(
    chatSettingsHref(7, "chatService"),
    "/studio?settings=chatService&workspace=7",
  );
  assert.equal(
    chatSettingsHref(9, "models"),
    "/studio?settings=models&workspace=9",
  );
  assert.equal(
    chatSettingsHref(9, "models", "9"),
    "/studio?settings=models&workspace=9&scope=9",
  );
});
