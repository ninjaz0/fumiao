import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

test("settings-console.css restores ocean-blue palette and warm dark surfaces without emerald overrides", () => {
  const css = readRepoFile("apps/web/studio/settings-console.css");

  assert.doesNotMatch(css, /#047857/i);
  assert.doesNotMatch(css, /#3ecf8e/i);
  assert.doesNotMatch(css, /#e7f7ef/i);
  assert.doesNotMatch(css, /#1a342b/i);

  assert.match(css, /--side:\s*#f3f4f6;/i);
  assert.match(css, /--bg:\s*#f8f9fa;/i);
  assert.match(css, /--surface:\s*#ffffff;/i);
  assert.match(css, /--blue:\s*#3686ad;/i);
  assert.match(css, /--accent-soft:\s*rgba\(54,\s*134,\s*173,\s*0\.12\);/i);

  assert.match(css, /--side:\s*#171717;/i);
  assert.match(css, /--bg:\s*#111111;/i);
  assert.match(css, /--surface:\s*#1e1e1e;/i);
  assert.match(css, /--line:\s*rgba\(255,\s*255,\s*255,\s*0\.09\);/i);
  assert.match(css, /--hover:\s*#242424;/i);
  assert.match(css, /--selected:\s*#2a2a2a;/i);
  assert.match(css, /--blue:\s*#68a8db;/i);
  assert.match(css, /--accent-soft:\s*rgba\(104,\s*168,\s*219,\s*0\.15\);/i);
});

test("settings-console.css locks sans-serif scope across settings and invite modal and provides form/button fallback primitives", () => {
  const css = readRepoFile("apps/web/studio/settings-console.css");

  assert.match(css, /#modal\.ledger-invite-sheet/);
  assert.match(css, /--ledger-serif:\s*inherit;/);
  assert.match(
    css,
    /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"PingFang SC",\s*sans-serif;/,
  );

  assert.match(css, /\[type="checkbox"\][\s\S]*\[type="radio"\][\s\S]*\[type="file"\][\s\S]*\[type="range"\]/);
  assert.match(css, /\.formlabel[\s\S]*\.ledger-search[\s\S]*\.console-search/);
  assert.match(css, /padding:\s*0 10px;/);
  assert.match(css, /background:\s*var\(--bg\);/);
  assert.match(css, /gap:\s*6px;/);

  assert.match(css, /button:is\(\.secondary,\s*\.quiet-button\)/);
  assert.match(css, /min-height:\s*34px;/);
  assert.match(css, /padding:\s*0 12px;/);
});

test("settings-ledger.css and SettingsInvites.tsx remove serif fonts and skeuomorphic ticket/stamp styling while preserving invite actions", () => {
  const ledgerCss = readRepoFile("apps/web/studio/settings-ledger.css");
  const invitesTsx = readRepoFile("apps/web/studio/SettingsInvites.tsx");

  assert.doesNotMatch(ledgerCss, /Songti/i);
  assert.doesNotMatch(ledgerCss, /STSong/i);
  assert.doesNotMatch(ledgerCss, /SimSun/i);
  assert.doesNotMatch(ledgerCss, /rotate\(-12deg\)/i);
  assert.doesNotMatch(ledgerCss, /repeating-linear-gradient/i);
  assert.doesNotMatch(ledgerCss, /\.ledger-ticket-stub::before/);
  assert.doesNotMatch(ledgerCss, /\.ledger-seal/);
  assert.doesNotMatch(ledgerCss, /cjk-decimal|cjk-ideographic/i);

  assert.doesNotMatch(invitesTsx, /ledger-ticket/);
  assert.doesNotMatch(invitesTsx, /ledger-seal/);
  assert.doesNotMatch(invitesTsx, /EmptyTicket/);
  assert.match(invitesTsx, /invite-code-row\s+ledger-card/);
  assert.match(invitesTsx, /data-act="invite"/);
  assert.match(invitesTsx, /data-act="copy-invite"/);
  assert.match(invitesTsx, /data-act="edit-invite"/);
  assert.match(invitesTsx, /data-act="toggle-invite"/);
  assert.match(invitesTsx, /id="invite-form"/);
  assert.match(invitesTsx, /aria-label=\{`复制邀请码 \$\{item\.code\}`\}/);
});

test("PluginImport.module.css replaces bare system Canvas/CanvasText keywords with Studio theme tokens and button borders", () => {
  const css = readRepoFile("apps/web/studio/PluginImport.module.css");

  assert.doesNotMatch(css, /\bCanvas(?:Text)?\b/);
  assert.match(css, /var\(--pop,\s*var\(--surface\)\)/);
  assert.match(css, /var\(--text\)/);
  assert.match(css, /var\(--line\)/);
  assert.match(css, /\.dialog footer button/);
});

test("Settings tabs remove redundant general tab, rename budgets nav, drop ComfySlotMapper, and strip half-baked cards", () => {
  assert.equal(
    existsSync(join(repoRoot, "apps/web/studio/ComfySlotMapper.tsx")),
    false,
    "ComfySlotMapper.tsx should be removed from Studio settings",
  );

  const settingsTabs = readRepoFile("apps/web/studio/settings-tabs.ts");
  const settings = readRepoFile("apps/web/studio/Settings.tsx");
  const studio = readRepoFile("apps/web/studio/Studio.tsx");
  const credits = readRepoFile("apps/web/studio/SettingsCredits.tsx");
  const budgets = readRepoFile("apps/web/studio/SettingsBudgets.tsx");

  assert.doesNotMatch(settingsTabs, /"general"/);
  assert.doesNotMatch(settings, /"general"|function General\b/);
  assert.doesNotMatch(studio, /"general"/);

  assert.doesNotMatch(settings, /预算与风控/);
  assert.match(settings, /\["budgets",\s*"预算控制",\s*"sliders",\s*"account"\]/);
  assert.match(settings, /key === "openai"/);
  assert.match(settings, /key === "chatService"/);

  assert.doesNotMatch(credits, /周期配额包|使用已支付充值单号激活|\/api\/subscriptions/);
  assert.doesNotMatch(budgets, /\/api\/budgets\/moderation|saveModeration/);
  assert.match(budgets, /\{canManage\s*&&\s*\(/);
});

test("Settings*.tsx strip internal ticket codes and raw DB enums while relocating SkillEditorCard cleanly", () => {
  const studioDir = join(repoRoot, "apps/web/studio");
  const settingsFiles = readdirSync(studioDir).filter((name) =>
    /^Settings.*\.tsx$/.test(name),
  );
  assert.ok(settingsFiles.length >= 10);

  for (const file of settingsFiles) {
    const src = readRepoFile(`apps/web/studio/${file}`);
    assert.doesNotMatch(src, /\bF0(?:15|24|34)\b/, `${file} leaked ticket code`);
    assert.doesNotMatch(
      src,
      /ComfySlotMapper|ComfyUI 工作流发布器|周期配额包|使用已支付充值单号激活/,
      `${file} kept removed UI block`,
    );
    assert.doesNotMatch(
      src,
      /\(plan_only|\(propose_and_confirm\)|\(auto_within_budget\)|\(cap\)|moderation_blocked/,
      `${file} leaked raw DB enum in copy`,
    );
  }

  const redeem = readRepoFile("apps/web/studio/SettingsRedeem.tsx");
  assert.match(redeem, /<h2>兑换码管理<\/h2>/);
  assert.match(redeem, /className="secondary"[\s\S]*复制全部/);
  assert.match(redeem, /className="secondary"[\s\S]*停用/);

  const observability = readRepoFile("apps/web/studio/SettingsObservability.tsx");
  assert.doesNotMatch(observability, /<code>uncertain<\/code>|（uncertain|安全改写\s*\/\s*在线 GPU/);
  assert.match(observability, /<small>在线 GPU 节点<\/small>/);
  assert.match(observability, /className="secondary"[\s\S]*人工核对退款/);

  const apiTokens = readRepoFile("apps/web/studio/SettingsApiTokens.tsx");
  assert.match(apiTokens, /<option value="plan_only">/);
  assert.match(apiTokens, /<option value="propose_and_confirm">/);
  assert.match(apiTokens, /<option value="auto_within_budget">/);
  assert.match(apiTokens, /<SkillEditorCard workspace=\{Number\(workspace\)\} \/>/);

  assert.equal(
    existsSync(join(repoRoot, "apps/web/studio/SkillEditorCard.tsx")),
    true,
    "SkillEditorCard.tsx must exist",
  );
  const skillCard = readRepoFile("apps/web/studio/SkillEditorCard.tsx");
  assert.match(skillCard, /ledger-card/);
  assert.match(skillCard, /启用后将自动注入工作区对话与外部 MCP 上下文/);
  assert.doesNotMatch(skillCard, /`SKILL\.md`|`\.zip`|icon-button|\bF0(?:15|24|34)\b/);

  const skillModal = readRepoFile("apps/web/canvas-editor/SkillEditorModal.tsx");
  assert.match(skillModal, /from "\.\.\/studio\/SkillEditorCard"/);
  assert.doesNotMatch(skillModal, /useState\(/);
});
