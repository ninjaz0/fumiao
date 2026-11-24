import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatSettingsHref,
  hasAvailableChatModels,
  resolveChatConfigTarget,
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
    "plugins",
  );
  // Imported chat plugin whose package switch is still off: model_policy is true,
  // even though effective model_access is false. Admin must go to plugins, not models.
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

test("resolveChatConfigTarget directs admins to model policy when global or team policy disables all chat models", () => {
  assert.equal(
    resolveChatConfigTarget({
      studio_plugins: true,
      workspace_id: 1,
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
    }),
    "models",
  );
  assert.equal(
    resolveChatConfigTarget({
      studio_plugins: true,
      workspace_id: 9,
      model_groups: {
        chat: { kind: "chat", models: ["deepseek-flash"] },
      },
      model_policy: { revision: 1, enabled: { "deepseek-flash": true } },
      team_model_policies: {
        "9": { revision: 1, enabled: { "deepseek-flash": false } },
      },
    }),
    "models",
  );
});

test("chatSettingsHref builds workspace-scoped settings URLs", () => {
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
});
