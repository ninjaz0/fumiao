import { MAX_ASSET_SELECTION } from "./asset-limits.js";
import {
  inviteFields,
  loginFields,
  parseBody,
  pathId,
  queryId,
  queryBoolean,
  queryChoice,
  teamFields,
  ValidationError,
  type Fields,
} from "./validation.js";
import { estimateFields } from "./estimate-draft.js";
import {
  batchQuoteFields,
  canvasBatchPrecheckFields,
  canvasBatchRunFields,
  canvasBgmRunFields,
  canvasCandidatesFields,
  canvasDialogueRunFields,
  canvasExactRevisionFields,
  canvasGridCropFields,
  canvasPluginRunFields,
  canvasNewFields,
  canvasRunFields,
  canvasSaveFields,
  storyboardExportFields,
} from "./canvas-draft.js";
import {
  agentPolicyFields,
  proposalApplyFields,
  proposalCreateFields,
  skillCreateFields,
  skillUpdateFields,
  tokenCreateFields,
} from "./wave4-fields.js";
import {
  budgetUpsertFields,
  moderationSettingsFields,
  reconcileJobFields,
  redeemApplyFields,
  redeemBatchCreateFields,
  subscriptionPlanCreateFields,
  subscriptionSubscribeFields,
} from "./wave6-fields.js";
import {
  scriptCreateFields,
  scriptReplaceFields,
  scriptSearchFields,
  scriptSuiteFields,
  scriptUpdateFields,
} from "./script-fields.js";
export const identityBodies: Record<string, Fields> = {
  canvasNew: canvasNewFields,
  canvasSave: canvasSaveFields,
  canvasRun: canvasRunFields,
  canvasBgmRun: canvasBgmRunFields,
  canvasDialogueRun: canvasDialogueRunFields,
  canvasPluginRun: canvasPluginRunFields,
  canvasCandidates: canvasCandidatesFields,
  canvasBatchPrecheck: canvasBatchPrecheckFields,
  canvasBatchRun: canvasBatchRunFields,
  canvasGridCrop: canvasGridCropFields,
  batchQuote: batchQuoteFields,
  tokenCreate: tokenCreateFields,
  skillCreate: skillCreateFields,
  skillUpdate: skillUpdateFields,
  agentPolicy: agentPolicyFields,
  proposalCreate: proposalCreateFields,
  proposalApply: proposalApplyFields,
  budgetUpsert: budgetUpsertFields,
  moderationSettings: moderationSettingsFields,
  reconcileJob: reconcileJobFields,
  redeemBatchCreate: redeemBatchCreateFields,
  redeemApply: redeemApplyFields,
  subscriptionPlanCreate: subscriptionPlanCreateFields,
  subscriptionSubscribe: subscriptionSubscribeFields,
  scriptCreate: scriptCreateFields,
  scriptSuite: scriptSuiteFields,
  scriptSearch: scriptSearchFields,
  scriptReplace: scriptReplaceFields,
  scriptUpdate: scriptUpdateFields,
  canvasShotsDownload: canvasExactRevisionFields,
  storyboardExport: storyboardExportFields,
  estimate: estimateFields,
  packDraft: {
    name: { kind: "string", min: 1, max: 60 },
    purpose: {
      kind: "literal",
      values: ["subject", "outfit", "scene", "style", "product"],
    },
    description: { kind: "string", default: "", max: 2000 },
    media: { kind: "strings", min: 1, max: 9 },
    expected_revision: {
      kind: "integer",
      nullable: true,
      default: null,
      min: 1,
    },
    voice_profile: {
      kind: "dictionary",
      nullable: true,
      optional: true,
    },
    turnaround_views: {
      kind: "dictionary",
      nullable: true,
      optional: true,
    },
    scope: {
      kind: "literal",
      values: ["workspace", "global"],
      optional: true,
    },
  },
  packScope: {
    scope: {
      kind: "literal",
      values: ["workspace", "global"],
    },
  },
  packTurnaround: {
    views: { kind: "dictionary", nullable: true, optional: true },
    view: {
      kind: "literal",
      values: ["sheet", "front", "side", "back"],
      optional: true,
    },
    model: { kind: "string", max: 180, optional: true },
    ratio: {
      kind: "literal",
      values: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      optional: true,
    },
    resolution: {
      kind: "literal",
      values: ["1K", "2K", "4K"],
      optional: true,
    },
    image_quality: {
      kind: "literal",
      values: ["low", "medium", "high"],
      optional: true,
    },
    style_note: { kind: "string", max: 1000, optional: true },
    uid: { kind: "uuid", nullable: true, optional: true },
    price_revision: {
      kind: "integer",
      nullable: true,
      min: 1,
      optional: true,
    },
  },
  assetKeys: { keys: { kind: "strings", min: 1, max: MAX_ASSET_SELECTION } },
  favorites: {
    keys: { kind: "strings", min: 1, max: MAX_ASSET_SELECTION },
    favorite: { kind: "boolean", strict: false },
  },
  login: loginFields,
  modelPolicy: {
    model: { kind: "string" },
    enabled: { kind: "boolean", strict: false },
    group: { kind: "boolean", strict: false, default: false },
    expected_revision: { kind: "integer", min: 0 },
    workspace: { kind: "integer", nullable: true, default: null },
  },
  modelPrices: {
    values: { kind: "prices" },
    expected_revision: { kind: "integer", min: 1 },
  },
  register: { ...loginFields, nickname: { kind: "string", min: 1, max: 40 } },
  createWorkspace: teamFields,
  updateWorkspace: {
    ...teamFields,
    expected_revision: { kind: "integer", min: 1 },
  },
  createInvite: inviteFields,
  updateInvite: {
    ...Object.fromEntries(
      Object.entries(inviteFields).map(([k, { default: _, ...v }]) => [
        k,
        { ...v, optional: true, nullable: true },
      ]),
    ),
    enabled: { kind: "boolean", optional: true, nullable: true },
    expected_revision: { kind: "integer", min: 1, strict: true },
  },
  createMember: {
    name: { kind: "string", min: 2, max: 32 },
    nickname: { kind: "string", max: 40, default: "" },
    password: { kind: "string", min: 10, max: 200 },
  },
  editProfile: {
    nickname: { kind: "string", max: 40, nullable: true, default: null },
    avatar: { kind: "string", max: 80, nullable: true, default: null },
  },
  changePassword: {
    current_password: { kind: "string", min: 1, max: 200 },
    password: { kind: "string", min: 10, max: 200 },
  },
  resetPassword: { password: { kind: "string", min: 10, max: 200 } },
  adjustCredits: {
    workspace: { kind: "integer" },
    amount: { kind: "integer", strict: true },
    note: { kind: "string", min: 1, max: 200 },
    uid: { kind: "uuid" },
  },
};
type Contract = {
  method: string;
  path: RegExp;
  body?: string;
  id?: string;
  public?: boolean;
  query?: string[];
  booleanQuery?: string[];
  literalQuery?: Record<string, { choices: string[]; default?: string }>;
  exactIntegers?: boolean;
  generation?: "video" | "image" | "audio";
  imageSettings?: string;
};
export const canvasContracts: Contract[] = [
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/execute$/, body:"canvasPluginRun", exactIntegers:true },
  { method: "GET", path: /^\/api\/canvases$/ },
  { method: "POST", path: /^\/api\/canvases$/, body: "canvasNew" },
  { method: "GET", path: /^\/api\/canvases\/[^/]+$/ },
  { method: "PUT", path: /^\/api\/canvases\/[^/]+\/archive$/ },
  { method: "DELETE", path: /^\/api\/canvases\/[^/]+\/archive$/ },
  {
    method: "PUT",
    path: /^\/api\/canvases\/[^/]+\/document$/,
    body: "canvasSave",
  },
  { method: "DELETE", path: /^\/api\/canvases\/[^/]+$/ },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/duplicate$/ },
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/exports$/ },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/exports$/,
    body: "storyboardExport",
    exactIntegers: true,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/shots\/download$/,
    body: "canvasShotsDownload",
    exactIntegers: true,
  },
  {
    method: "GET",
    path: /^\/api\/storyboard-exports\/[^/]+\/subtitles$/,
    literalQuery: { format: { choices: ["srt", "vtt"], default: "srt" } },
  },
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/runs$/ },
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/director-inputs$/ },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/bgm$/,
    body: "canvasBgmRun",
    exactIntegers: true,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/(?:runs|narration)$/,
    body: "canvasRun",
    exactIntegers: true,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/candidates$/,
    body: "canvasCandidates",
    exactIntegers: true,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/dialogue$/,
    body: "canvasDialogueRun",
    exactIntegers: true,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/tail-frame$/,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/grid-crop$/,
    body: "canvasGridCrop",
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/batch-precheck$/,
    body: "canvasBatchPrecheck",
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/batch-runs$/,
    body: "canvasBatchRun",
    exactIntegers: true,
  },
  {
    method: "GET",
    path: /^\/api\/canvases\/[^/]+\/proposals$/,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/proposals$/,
    body: "proposalCreate",
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/proposals\/[^/]+\/apply$/,
    body: "proposalApply",
    exactIntegers: true,
  },
  {
    method: "POST",
    path: /^\/api\/canvases\/[^/]+\/proposals\/[^/]+\/reject$/,
  },
];
export const identityContracts: Contract[] = [
  { method: "GET", path: /^\/api\/v1\/openapi\.json$/, public: true },
  { method: "GET", path: /^\/api\/tokens$/ },
  { method: "POST", path: /^\/api\/tokens$/, body: "tokenCreate" },
  { method: "DELETE", path: /^\/api\/tokens\/([^/]+)$/ },
  { method: "GET", path: /^\/api\/skills$/ },
  { method: "POST", path: /^\/api\/skills$/, body: "skillCreate" },
  { method: "POST", path: /^\/api\/skills\/import-zip$/ },
  { method: "PUT", path: /^\/api\/skills\/([^/]+)$/, body: "skillUpdate" },
  { method: "DELETE", path: /^\/api\/skills\/([^/]+)$/ },
  { method: "GET", path: /^\/api\/workspace\/agent-policy$/ },
  {
    method: "PUT",
    path: /^\/api\/workspace\/agent-policy$/,
    body: "agentPolicy",
  },
  { method: "GET", path: /^\/api\/chat\/config$/ },
  { method: "GET", path: /^\/api\/admin\/chat$/ },
  { method: "PUT", path: /^\/api\/admin\/chat\/([^/]+)$/ },
  { method: "POST", path: /^\/api\/admin\/chat\/([^/]+)\/test$/ },
  { method: "GET", path: /^\/api\/state$/ },
  { method: "POST", path: /^\/api\/estimate$/, body: "estimate" },
  { method: "POST", path: /^\/api\/quotes\/batch$/, body: "batchQuote" },
  { method: "POST", path: /^\/api\/jobs$/, generation: "video" },
  { method: "POST", path: /^\/api\/image-jobs$/, generation: "image" },
  { method: "POST", path: /^\/api\/audio-jobs$/, generation: "audio" },
  { method: "POST", path: /^\/api\/jobs\/([^/]+)\/cancel$/, id: "i" },
  { method: "DELETE", path: /^\/api\/jobs\/([^/]+)$/, id: "i" },
  {
    method: "POST",
    path: /^\/api\/h3\/references$/,
    literalQuery: { kind: { choices: ["video", "audio"] } },
  },
  { method: "GET", path: /^\/api\/asset-packs$/ },
  { method: "POST", path: /^\/api\/asset-packs$/, body: "packDraft" },
  { method: "PUT", path: /^\/api\/asset-packs\/([^/]+)$/, body: "packDraft" },
  { method: "DELETE", path: /^\/api\/asset-packs\/([^/]+)$/ },
  { method: "POST", path: /^\/api\/asset-packs\/([^/]+)\/lock$/ },
  { method: "POST", path: /^\/api\/asset-packs\/([^/]+)\/unlock$/ },
  {
    method: "PUT",
    path: /^\/api\/asset-packs\/([^/]+)\/scope$/,
    body: "packScope",
  },
  {
    method: "POST",
    path: /^\/api\/asset-packs\/([^/]+)\/turnaround$/,
    body: "packTurnaround",
  },
  { method: "GET", path: /^\/api\/workspace\/scripts$/ },
  {
    method: "POST",
    path: /^\/api\/workspace\/scripts$/,
    body: "scriptCreate",
  },
  {
    method: "POST",
    path: /^\/api\/workspace\/scripts\/suite$/,
    body: "scriptSuite",
  },
  {
    method: "POST",
    path: /^\/api\/workspace\/scripts\/search$/,
    body: "scriptSearch",
  },
  {
    method: "POST",
    path: /^\/api\/workspace\/scripts\/replace$/,
    body: "scriptReplace",
    exactIntegers: true,
  },
  { method: "GET", path: /^\/api\/workspace\/scripts\/([^/]+)$/ },
  {
    method: "PUT",
    path: /^\/api\/workspace\/scripts\/([^/]+)$/,
    body: "scriptUpdate",
    exactIntegers: true,
  },
  {
    method: "DELETE",
    path: /^\/api\/workspace\/scripts\/([^/]+)$/,
    booleanQuery: ["recursive"],
  },
  { method: "POST", path: /^\/api\/assets$/ },
  { method: "PUT", path: /^\/api\/me\/avatar$/ },
  { method: "PUT", path: /^\/api\/favorites$/, body: "favorites" },
  { method: "POST", path: /^\/api\/assets\/batch-delete$/, body: "assetKeys" },
  {
    method: "POST",
    path: /^\/api\/assets\/batch-download$/,
    body: "assetKeys",
  },
  { method: "GET", path: /^\/api\/downloads\/([^/]+)$/ },
  { method: "GET", path: /^\/media\/([^/]+)$/, booleanQuery: ["download"] },
  { method: "GET", path: /^\/avatars\/([^/]+)$/, public: true },
  { method: "GET", path: /^\/avatars\/uploads\/([^/]+)$/ },
  { method: "DELETE", path: /^\/api\/assets\/([^/]+)$/ },

  { method: "PATCH", path: /^\/api\/settings\/models$/, body: "modelPolicy" },
  { method: "PUT", path: /^\/api\/settings\/prices$/, body: "modelPrices" },
  { method: "PUT", path: /^\/api\/settings\/openai$/, imageSettings: "openai" },
  { method: "POST", path: /^\/api\/settings\/openai\/check$/ },
  { method: "GET", path: /^\/health$/, public: true },
  { method: "HEAD", path: /^\/health$/, public: true },
  { method: "POST", path: /^\/api\/login$/, body: "login", public: true },
  { method: "POST", path: /^\/api\/register$/, body: "register", public: true },
  { method: "POST", path: /^\/api\/logout$/, public: true },
  { method: "GET", path: /^\/api\/workspaces$/ },
  { method: "POST", path: /^\/api\/workspaces$/, body: "createWorkspace" },
  {
    method: "PATCH",
    path: /^\/api\/workspaces\/([^/]+)$/,
    id: "wid",
    body: "updateWorkspace",
  },
  { method: "POST", path: /^\/api\/workspaces\/([^/]+)\/select$/, id: "wid" },
  { method: "GET", path: /^\/api\/invite-codes$/ },
  { method: "POST", path: /^\/api\/invite-codes$/, body: "createInvite" },
  {
    method: "PATCH",
    path: /^\/api\/invite-codes\/([^/]+)$/,
    id: "i",
    body: "updateInvite",
  },
  { method: "POST", path: /^\/api\/invites$/ },
  { method: "POST", path: /^\/api\/invites\/([^/]+)\/revoke$/, id: "i" },
  { method: "POST", path: /^\/api\/users$/, body: "createMember" },
  { method: "DELETE", path: /^\/api\/users\/([^/]+)$/, id: "uid" },
  {
    method: "POST",
    path: /^\/api\/users\/([^/]+)\/password$/,
    id: "uid",
    body: "resetPassword",
  },
  { method: "POST", path: /^\/api\/users\/([^/]+)\/disable$/, id: "i" },
  { method: "PATCH", path: /^\/api\/me$/, body: "editProfile" },
  { method: "POST", path: /^\/api\/me\/password$/, body: "changePassword" },
  { method: "GET", path: /^\/api\/credits$/, query: ["before"] },
  {
    method: "GET",
    path: /^\/api\/admin\/credits$/,
    query: ["workspace", "before"],
  },
  {
    method: "POST",
    path: /^\/api\/admin\/credits\/adjust$/,
    body: "adjustCredits",
  },
  {
    method: "GET",
    path: /^\/api\/admin\/observability\/summary$/,
    query: ["days"],
  },
  {
    method: "GET",
    path: /^\/api\/admin\/observability\/uncertain$/,
  },
  {
    method: "POST",
    path: /^\/api\/admin\/observability\/jobs\/([^/]+)\/reconcile$/,
    body: "reconcileJob",
  },
  { method: "GET", path: /^\/api\/budgets$/ },
  { method: "PUT", path: /^\/api\/budgets$/, body: "budgetUpsert" },
  {
    method: "PUT",
    path: /^\/api\/budgets\/moderation$/,
    body: "moderationSettings",
  },
  { method: "GET", path: /^\/api\/admin\/redeem-codes$/ },
  {
    method: "POST",
    path: /^\/api\/admin\/redeem-codes\/batch$/,
    body: "redeemBatchCreate",
  },
  { method: "POST", path: /^\/api\/admin\/redeem-codes\/([^/]+)\/disable$/ },
  { method: "POST", path: /^\/api\/redeem$/, body: "redeemApply" },
  { method: "GET", path: /^\/api\/invites\/rewards$/ },
  { method: "POST", path: /^\/api\/invites\/rewards\/claim$/ },
  { method: "GET", path: /^\/api\/subscriptions\/plans$/ },
  {
    method: "POST",
    path: /^\/api\/admin\/subscriptions\/plans$/,
    body: "subscriptionPlanCreate",
  },
  {
    method: "POST",
    path: /^\/api\/subscriptions\/subscribe$/,
    body: "subscriptionSubscribe",
  },
  {
    method: "GET",
    path: /^\/api\/credits\/statement$/,
    literalQuery: { format: { choices: ["csv", "pdf"], default: "csv" } },
  },
];
/** FastAPI validates the request before running endpoint authentication. */
export function validateIdentityRequest(
  contract: Contract,
  path: string,
  body: unknown,
  query: URLSearchParams = new URLSearchParams(),
) {
  const issues: ValidationError["detail"] = [];
  const attempt = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof ValidationError) issues.push(...e.detail);
      else throw e;
    }
  };
  if (contract.id)
    attempt(() =>
      pathId(decodeURIComponent(path.match(contract.path)![1]), contract.id!),
    );
  if (contract.body)
    attempt(() =>
      parseBody(
        body,
        identityBodies[contract.body!],
        [
          "createInvite",
          "updateInvite",
          "packDraft",
          "packScope",
          "packTurnaround",
          "canvasNew",
          "canvasSave",
          "canvasRun",
          "canvasDialogueRun",
          "canvasBatchPrecheck",
          "canvasBatchRun",
          "canvasGridCrop",
          "batchQuote",
          "tokenCreate",
          "skillCreate",
          "skillUpdate",
          "agentPolicy",
          "proposalCreate",
          "proposalApply",
          "budgetUpsert",
          "moderationSettings",
          "reconcileJob",
          "redeemBatchCreate",
          "redeemApply",
          "subscriptionPlanCreate",
          "subscriptionSubscribe",
          "canvasCandidates",
          "canvasShotsDownload",
        ].includes(contract.body!),
      ),
    );
  for (const key of contract.query || [])
    attempt(() => queryId(query.getAll(key).at(-1), key));
  for (const key of contract.booleanQuery || [])
    attempt(() => queryBoolean(query.getAll(key).at(-1), key));
  for (const [key, field] of Object.entries(contract.literalQuery || {}))
    attempt(() =>
      queryChoice(
        query.getAll(key).at(-1) ?? field.default,
        key,
        field.choices,
      ),
    );
  if (issues.length) throw new ValidationError(issues);
}
