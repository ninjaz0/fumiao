import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import type { OriginalRecharge } from "@fumiao/original-api/recharge.js";
import { DomainError } from "@fumiao/platform/security.js";
import {
  OriginalRechargeController,
  originalRechargeRequest,
} from "../../apps/api/src/original-recharge.js";
import type { OriginalAuthRequest } from "../../apps/api/src/original-request.js";

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

  assert.equal(
    existsSync(join(repoRoot, "apps/web/canvas-editor/SkillEditorModal.tsx")),
    false,
    "SkillEditorModal.tsx must be deleted now that workspace skills live in Studio settings",
  );
});

test("AssetPacks, asset-packs.css, and AssetDialog remove dead ref-audio slot, replace emoji badges, and unify cross-route pack/field styles", () => {
  const packsTsx = readRepoFile("apps/web/canvas-editor/AssetPacks.tsx");
  const packsCss = readRepoFile("apps/web/studio/asset-packs.css");
  const assetDialogTsx = readRepoFile("apps/web/studio/AssetDialog.tsx");

  assert.match(packsTsx, /import\s+["']\.\.\/studio\/asset-packs\.css["']/);
  assert.doesNotMatch(packsTsx, /参考音频槽/);
  assert.doesNotMatch(packsTsx, /已绑参考音频/);
  assert.doesNotMatch(packsTsx, /audioAssets/);
  assert.doesNotMatch(packsTsx, /🔒|🌐/);
  assert.match(packsTsx, /<legend>角色专属声线（对白自动匹配）<\/legend>/);

  // Preserve Playwright selectors and accessible names
  assert.match(packsTsx, /新建素材包/);
  assert.match(packsTsx, /返回素材包/);
  assert.match(packsTsx, /返回素材包列表/);
  assert.match(packsTsx, /保存素材包/);
  assert.match(packsTsx, /打开素材包 /);
  assert.match(packsTsx, /导入整个素材包/);
  assert.match(packsTsx, /移除整包引用/);
  assert.match(packsTsx, /未保存的素材包修改/);

  assert.match(packsCss, /\.fm-pack-voice\b/);
  assert.match(packsCss, /\.fm-pack-turnaround-bind\b/);
  assert.match(packsCss, /\.fm-pack-turnaround-actions\b/);
  assert.match(packsCss, /\.fm-pack-governance-bar\b/);
  assert.match(packsCss, /\.fm-turnaround-strip\b/);
  assert.match(packsCss, /\.fm-badge-lock\b/);
  assert.match(packsCss, /\.fm-badge-global\b/);
  assert.match(packsCss, /white-space:\s*nowrap/);

  assert.match(
    assetDialogTsx,
    /content\.entry\.fields\?\.map\(\(field\)\s*=>\s*\(\s*<label[^>]*className="formlabel"/,
  );
});

test("ProjectList, SeriesTree, dialog.css, and CanvasList demote empty series tree, expose editable bible, fix 5-item ep-form grid, and style retry button", () => {
  const projectListTsx = readRepoFile("apps/web/canvas/ProjectList.tsx");
  const seriesTreeTsx = readRepoFile("apps/web/canvas/SeriesTree.tsx");
  const dialogCss = readRepoFile("apps/web/canvas/dialog.css");
  const canvasListTsx = readRepoFile("apps/web/canvas/CanvasList.tsx");

  const headingIdx = projectListTsx.indexOf("<h1>画布</h1>");
  const seriesIdx = projectListTsx.indexOf("<SeriesTree");
  assert.ok(headingIdx >= 0, "ProjectList.tsx must render <h1>画布</h1>");
  assert.ok(seriesIdx >= 0, "ProjectList.tsx must render <SeriesTree />");
  assert.ok(
    headingIdx < seriesIdx,
    "<h1>画布</h1> must appear above <SeriesTree /> in ProjectList.tsx",
  );

  assert.match(seriesTreeTsx, /剧集分集管理\s*·\s*0\s*部剧集/);
  assert.match(seriesTreeTsx, /世界观设定/);
  assert.match(seriesTreeTsx, /\/api\/series\/\$\{/);
  assert.match(seriesTreeTsx, /"PUT"/);

  assert.doesNotMatch(
    dialogCss,
    /grid-template-columns:\s*auto\s+auto\s+1fr\s+auto\s*;/,
  );
  assert.match(dialogCss, /\.fm-ep-form\b/);
  assert.match(dialogCss, /\.fm-series-panel[\s\S]*border-radius:\s*8px/);

  assert.match(
    canvasListTsx,
    /<button[\s\S]*?className="[^"]*\bbtn\b[^"]*"[\s\S]*?>\s*重试\s*<\/button>/,
  );
});

test("Canvas editor floats CinematographyPanel, strips neon hexes and raw policy enums, and polishes ShotList, Narration, Composition, and H3Inputs controls", () => {
  const workspaceTsx = readRepoFile("apps/web/canvas-editor/CanvasWorkspace.tsx");
  const cineTsx = readRepoFile("apps/web/canvas-editor/CinematographyPanel.tsx");
  const proposalTsx = readRepoFile("apps/web/canvas-editor/ProposalDiffPreview.tsx");
  const narrationTsx = readRepoFile("apps/web/canvas-editor/Narration.tsx");
  const shotListTsx = readRepoFile("apps/web/canvas-editor/ShotList.tsx");
  const compositionTsx = readRepoFile("apps/web/canvas-editor/Composition.tsx");
  const h3InputsTsx = readRepoFile("apps/web/canvas-editor/H3Inputs.tsx");
  const overridesCss = readRepoFile("apps/web/canvas-editor/canvas-overrides.css");

  assert.equal(
    existsSync(join(repoRoot, "apps/web/canvas-editor/SkillEditorModal.tsx")),
    false,
  );

  // ProposalDiffPreview strips Skills button and raw DB enum suffixes
  assert.doesNotMatch(proposalTsx, /onOpenSkills|BookOpen|\bSkills\b/);
  assert.doesNotMatch(
    proposalTsx,
    /\(plan_only\)|\(propose_and_confirm\)|\(auto_within_budget\)/,
  );

  // CinematographyPanel supports floating popover with close button
  assert.match(cineTsx, /fm-cine-popover/);
  assert.match(cineTsx, /aria-label="关闭导演参数"/);
  assert.match(workspaceTsx, /<CinematographyPanel[\s\S]*?floating/);

  // canvas-overrides.css drops .fm-multi-bar, removes Tailwind neon hexes, floats .fm-cine-popover, offsets .fm-docked-storyboard, and styles <select> & BGM controls
  assert.doesNotMatch(overridesCss, /\.fm-multi-bar\b/);
  assert.doesNotMatch(
    overridesCss,
    /#4f7cff|#22c55e|#eab308|#ef4444|#38bdf8|#16a34a/i,
  );
  assert.match(overridesCss, /#3686ad|#68a8db/i);
  assert.match(overridesCss, /\.fm-cine-popover[\s\S]*?position:\s*absolute/);
  assert.match(overridesCss, /\.fm-cine-popover[\s\S]*?max-width:\s*340px/);
  assert.match(overridesCss, /\.fm-docked-storyboard\.fm-with-agent-dock[\s\S]*?right:\s*400px/);
  assert.match(overridesCss, /appearance:\s*none/);
  assert.match(overridesCss, /\.composition-bgm-gen input\[type="text"\][\s\S]*?border:\s*1px solid var\(--cv-line\)/);
  assert.match(overridesCss, /\.composition-bgm-gen \.secondary[\s\S]*?border:\s*1px solid var\(--cv-line\)/);
  assert.match(overridesCss, /\.cv-h3-preview\s*>\s*button/);

  // Narration hides 音色描述 when edge-tts is active
  assert.match(narrationTsx, /edge-tts[\s\S]*?音色描述|!isEdgeTts\s*&&\s*\(\s*<label>\s*音色描述/);

  // ShotList replaces raw text "定位" in .icon-button with <Crosshair size={16} />
  assert.doesNotMatch(shotListTsx, /className="icon-button"[\s\S]{0,220}>\s*定位\s*<\/button>/);
  assert.match(shotListTsx, /title="定位画布节点"[\s\S]*?<Crosshair size=\{16\} \/>/);

  // Composition and H3Inputs keep accessible labels and styled buttons
  assert.match(compositionTsx, /AI 生成配乐并挂载/);
  assert.match(h3InputsTsx, /className="secondary"[\s\S]*?关闭预览/);
});

test("Not-found page and 503 gateway fallback use Fumiao ocean-blue adaptive theme, Chinese copy, and /studio recovery actions", () => {
  const notFoundPath = join(repoRoot, "apps/web/app/not-found.tsx");
  assert.equal(
    existsSync(notFoundPath),
    true,
    "apps/web/app/not-found.tsx must exist",
  );

  const notFoundTsx = readRepoFile("apps/web/app/not-found.tsx");
  assert.match(notFoundTsx, /\/static\/mark\.svg/);
  assert.match(notFoundTsx, /页面不存在或已被移除/);
  assert.match(notFoundTsx, /href="\/studio"[\s\S]*?返回工作台|返回工作台[\s\S]*?href="\/studio"/);
  assert.match(notFoundTsx, /#f8f9fa/i);
  assert.match(notFoundTsx, /#fff(?:fff)?\b/i);
  assert.match(notFoundTsx, /#3686ad/i);
  assert.match(notFoundTsx, /#111(?:111)?\b/i);
  assert.match(notFoundTsx, /#1e1e1e/i);
  assert.match(notFoundTsx, /#68a8db/i);
  assert.match(notFoundTsx, /\[data-theme="dark"\]/);
  assert.match(notFoundTsx, /prefers-color-scheme:\s*dark/);
  assert.match(notFoundTsx, /PingFang SC[\s\S]*?sans-serif/);
  assert.doesNotMatch(notFoundTsx, /Songti|STSong|SimSun/i);

  const proxyTs = readRepoFile("apps/web/proxy.ts");
  assert.match(proxyTs, /status:\s*503/);
  assert.match(proxyTs, /"retry-after":\s*"5"/);
  assert.match(proxyTs, /http-equiv="refresh"\s+content="5"/);
  assert.match(proxyTs, /服务暂时不可用/);
  assert.match(proxyTs, /刷新重试/);
  assert.match(proxyTs, /prefers-color-scheme:\s*dark/);
  assert.match(proxyTs, /#3686ad/i);
  assert.match(proxyTs, /#68a8db/i);
  assert.match(proxyTs, /style-src\s+'unsafe-inline'/);
});

test("OriginalRechargeController.pay returns status-accurate XSS-escaped HTML error card for Accept: text/html and rethrows for JSON callers", async () => {
  function mockResponse() {
    let statusCode = 200;
    const headers = new Map<string, string>();
    let body = "";
    let ended = false;
    const res = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), String(value));
        return res;
      },
      type(value: string) {
        headers.set("content-type", value);
        return res;
      },
      end(chunk?: string) {
        if (chunk) body += chunk;
        ended = true;
        return res;
      },
    };
    return {
      res: res as unknown as Response,
      get statusCode() {
        return statusCode;
      },
      get body() {
        return body;
      },
      get ended() {
        return ended;
      },
      header(name: string) {
        return headers.get(name.toLowerCase());
      },
    };
  }

  const xssMessage = `订单已过期 <script>alert("xss")</script> & 'retry'`;
  const domainErr = new DomainError(409, xssMessage);

  const controller = new OriginalRechargeController({
    async checkout() {
      throw domainErr;
    },
  } as unknown as OriginalRecharge);

  // 1. Browser navigation (Accept: text/html) receives status-accurate, XSS-escaped themed HTML card
  const htmlRes = mockResponse();
  await controller.pay(
    {
      actor: { id: "u1" },
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    } as unknown as OriginalAuthRequest,
    "FM00000000000000000000000001",
    htmlRes.res,
  );
  assert.equal(htmlRes.ended, true);
  assert.equal(htmlRes.statusCode, 409);
  assert.match(htmlRes.header("content-type") ?? "", /^text\/html;\s*charset=utf-8$/i);
  assert.doesNotMatch(htmlRes.body, /<script>/i);
  assert.match(
    htmlRes.body,
    /订单已过期 &lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt; &amp; &#39;retry&#39;/,
  );
  assert.match(htmlRes.body, /prefers-color-scheme:\s*dark/);
  assert.match(htmlRes.body, /#3686ad/i);
  assert.match(htmlRes.body, /#68a8db/i);
  assert.match(htmlRes.body, /href="\/studio"[\s\S]*?返回工作台|返回工作台[\s\S]*?href="\/studio"/);

  // 2. HttpException-compatible error preserves getStatus() status code and escapes message
  const httpExceptionLike = Object.assign(new Error("Service Unavailable"), {
    getStatus: () => 503,
    getResponse: () => ({ message: "支付通道维护中 <b>请稍候</b>" }),
  });
  const httpErrController = new OriginalRechargeController({
    async checkout() {
      throw httpExceptionLike;
    },
  } as unknown as OriginalRecharge);
  const httpErrRes = mockResponse();
  await httpErrController.pay(
    {
      actor: { id: "u1" },
      headers: { accept: "text/html" },
    } as unknown as OriginalAuthRequest,
    "FM00000000000000000000000002",
    httpErrRes.res,
  );
  assert.equal(httpErrRes.ended, true);
  assert.equal(httpErrRes.statusCode, 503);
  assert.doesNotMatch(httpErrRes.body, /<b>/i);
  assert.match(httpErrRes.body, /支付通道维护中 &lt;b&gt;请稍候&lt;\/b&gt;/);

  // 3. API / JSON callers (Accept: application/json or */*) rethrow unchanged for OriginalExceptionFilter
  for (const accept of ["application/json", "*/*", undefined]) {
    const jsonRes = mockResponse();
    await assert.rejects(
      () =>
        controller.pay(
          {
            actor: { id: "u1" },
            headers: accept ? { accept } : {},
          } as unknown as OriginalAuthRequest,
          "FM00000000000000000000000001",
          jsonRes.res,
        ),
      (thrown) => thrown === domainErr,
    );
    assert.equal(jsonRes.ended, false);
  }

  // 4. Unexpected internal non-DomainError does not leak internal details in HTML
  const internalController = new OriginalRechargeController({
    async checkout() {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    },
  } as unknown as OriginalRecharge);
  const internalRes = mockResponse();
  await internalController.pay(
    {
      actor: { id: "u1" },
      headers: { accept: "text/html" },
    } as unknown as OriginalAuthRequest,
    "FM00000000000000000000000004",
    internalRes.res,
  );
  assert.equal(internalRes.statusCode, 500);
  assert.doesNotMatch(internalRes.body, /ECONNREFUSED|10\.0\.0\.5/);
  assert.match(internalRes.body, /请求处理失败/);

  // 5. Middleware auth failure on /pay returns 401 HTML card for browser tabs and calls failure() for API callers
  let delegatedFailure = 0;
  const middleware = originalRechargeRequest(
    {
      async actor() {
        throw new DomainError(401, "未登录");
      },
    } as never,
    () => {
      delegatedFailure += 1;
    },
  );
  const unauthHtmlRes = mockResponse();
  await middleware(
    {
      method: "GET",
      path: "/api/recharge/orders/FM00000000000000000000000005/pay",
      url: "/api/recharge/orders/FM00000000000000000000000005/pay",
      headers: { accept: "text/html" },
    } as unknown as OriginalAuthRequest,
    Object.assign(unauthHtmlRes.res, { locals: {}, headersSent: false }),
    () => {},
  );
  assert.equal(unauthHtmlRes.statusCode, 401);
  assert.match(unauthHtmlRes.body, /未登录/);
  assert.equal(delegatedFailure, 0);

  const unauthJsonRes = mockResponse();
  await middleware(
    {
      method: "GET",
      path: "/api/recharge/orders/FM00000000000000000000000005/pay",
      url: "/api/recharge/orders/FM00000000000000000000000005/pay",
      headers: { accept: "application/json" },
    } as unknown as OriginalAuthRequest,
    Object.assign(unauthJsonRes.res, { locals: {}, headersSent: false }),
    () => {},
  );
  assert.equal(delegatedFailure, 1);

  // 6. Successful checkout still sends 303 redirect even when Accept: text/html
  const okController = new OriginalRechargeController({
    async checkout() {
      return "https://pay.example/checkout?order=FM00000000000000000000000003";
    },
  } as unknown as OriginalRecharge);
  const okRes = mockResponse();
  await okController.pay(
    {
      actor: { id: "u1" },
      headers: { accept: "text/html" },
    } as unknown as OriginalAuthRequest,
    "FM00000000000000000000000003",
    okRes.res,
  );
  assert.equal(okRes.ended, true);
  assert.equal(okRes.statusCode, 303);
  assert.equal(
    okRes.header("location"),
    "https://pay.example/checkout?order=FM00000000000000000000000003",
  );
});
