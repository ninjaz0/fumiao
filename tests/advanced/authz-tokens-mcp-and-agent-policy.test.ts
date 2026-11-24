import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  OriginalApiTokens,
  WORKSPACE_TOKEN_SCOPES,
} from "@fumiao/original-api/tokens.js";
import {
  OriginalAgentPolicies,
  OriginalCanvasProposals,
} from "@fumiao/original-api/proposals.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { buildOpenApiSpec } from "@fumiao/original-api/openapi.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

async function startHttp(app: any): Promise<{ url: string; close: () => Promise<void> }> {
  await app.init();
  const server = app.getHttpServer();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>((ok) => server.close(() => ok()));
      await app.close();
    },
  };
}

test("F035 + F012: REST & MCP strictly enforce token scopes, browser-session-only isolation, and object-level workspace boundaries", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const app = await createOriginalApp(f.p);
  const http = await startHttp(app);
  t.after(() => http.close());

  const identity = new OriginalIdentity(f.p);
  const tokens = new OriginalApiTokens(f.p);

  // Create a second team workspace (Workspace B) so admin has access to BOTH Workspace A & B
  const wsA = f.workspace;
  const teamB = (await identity.createWorkspace(f.admin, {
    name: "团队空间B",
    members: [],
  })) as { id: number };
  const wsBPublicId = String(teamB.id);

  // Create one canvas in Workspace A and one canvas in Workspace B (f.project returns string id at revision 2)
  const canvasAId = await f.project(
    [
      {
        id: "imgA",
        type: "image",
        title: "图A",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "sunset over harbor",
        params: { model: "gpt-image-2.6-sunburst", ratio: "16:9", resolution: "1K", image_quality: "medium" },
      },
    ],
    [],
    String(wsA.public_id),
    f.admin,
  );
  const canvasBId = await f.project(
    [
      {
        id: "imgB",
        type: "image",
        title: "图B",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "secret workspace B canvas",
        params: {},
      },
    ],
    [],
    wsBPublicId,
    f.admin,
  );

  // 1. Read-only token bound to Workspace A
  const roMint = await tokens.create(
    f.admin,
    { name: "RO Token", scopes: ["canvas:read"], rate_limit_rpm: 120 },
    String(wsA.public_id),
  );
  const roHeaders = { Authorization: `Bearer ${roMint.token}` };

  // Allowed read inside Workspace A
  const listA = await fetch(`${http.url}/api/canvases`, { headers: roHeaders });
  assert.equal(listA.status, 200);
  const listAJson = (await listA.json()) as { projects: { id: string }[] };
  assert.ok(listAJson.projects.some((p) => p.id === canvasAId));
  assert.ok(!listAJson.projects.some((p) => p.id === canvasBId));

  const getA = await fetch(`${http.url}/api/canvases/${canvasAId}`, { headers: roHeaders });
  assert.equal(getA.status, 200);

  // Forbidden writes with read-only token
  const postCanvasRo = await fetch(`${http.url}/api/canvases`, {
    method: "POST",
    headers: { ...roHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Should Fail" }),
  });
  assert.equal(postCanvasRo.status, 403);

  const proposeRo = await fetch(`${http.url}/api/canvases/${canvasAId}/proposals`, {
    method: "POST",
    headers: { ...roHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Propose without scope",
      operations: [{ op: "add_node", temp_id: "n1", type: "sticky", title: "hi", x: 0, y: 0 }],
    }),
  });
  assert.equal(proposeRo.status, 403);

  // 2. Admin-issued full-scope token bound to Workspace A
  const fullMint = await tokens.create(
    f.admin,
    {
      name: "Admin Full Token",
      scopes: [...WORKSPACE_TOKEN_SCOPES],
      rate_limit_rpm: 120,
    },
    String(wsA.public_id),
  );
  const fullHeaders = {
    Authorization: `Bearer ${fullMint.token}`,
    "Content-Type": "application/json",
  };

  // Browser-session-only admin & governance endpoints MUST return 403 even for admin-issued full token!
  for (const [method, path, body] of [
    ["GET", "/api/admin/credits", undefined],
    ["GET", "/api/admin/observability/summary?days=7", undefined],
    ["GET", "/api/tokens", undefined],
    ["GET", "/api/workspace/agent-policy", undefined],
    ["PUT", "/api/workspace/agent-policy", { execution_policy: "propose_and_confirm" }],
    ["GET", "/api/budgets", undefined],
  ] as const) {
    const resp = await fetch(`${http.url}${path}`, {
      method,
      headers: fullHeaders,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(resp.status, 403, `Expected 403 for bearer token on ${method} ${path}, got ${resp.status}`);
  }

  // 3. Cross-workspace object-level isolation on REST (target canvasBId belongs to Workspace B!)
  const crossGet = await fetch(`${http.url}/api/canvases/${canvasBId}`, {
    headers: fullHeaders,
  });
  assert.equal(crossGet.status, 403);

  const crossPropose = await fetch(`${http.url}/api/canvases/${canvasBId}/proposals`, {
    method: "POST",
    headers: fullHeaders,
    body: JSON.stringify({
      title: "Cross-ws attempt",
      operations: [{ op: "add_node", temp_id: "x1", type: "sticky", title: "x", x: 0, y: 0 }],
    }),
  });
  assert.equal(crossPropose.status, 403);

  // 4. Cross-workspace object-level isolation across ALL MCP project tools!
  const mcpCall = async (toolName: string, args: Record<string, unknown>) => {
    const r = await fetch(`${http.url}/api/mcp`, {
      method: "POST",
      headers: fullHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    assert.equal(r.status, 200);
    return (await r.json()) as { result: { isError: boolean; content: { text: string }[] } };
  };

  for (const [tool, args] of [
    ["get_canvas", { project_id: canvasBId }],
    [
      "propose_canvas_patch",
      {
        project_id: canvasBId,
        operations: [{ op: "add_node", temp_id: "t1", type: "sticky", title: "s", x: 0, y: 0 }],
      },
    ],
    ["precheck_batch", { project_id: canvasBId, node_ids: ["imgB"] }],
    ["submit_generation_job", { project_id: canvasBId, node_id: "imgB", expected_revision: 2 }],
    ["export_storyboard", { project_id: canvasBId, expected_revision: 2 }],
  ] as const) {
    const out = await mcpCall(tool, args as Record<string, unknown>);
    assert.equal(out.result.isError, true, `MCP ${tool} MUST reject cross-workspace target`);
    const parsed = JSON.parse(out.result.content[0].text);
    assert.equal(parsed.status, 403, `MCP ${tool} expected status 403, got ${parsed.status}`);
  }

  // OpenAPI 3.1 contract consistency check
  const spec = buildOpenApiSpec("https://example.com");
  assert.equal((spec.paths["/api/tokens"].post as any)["x-session-only"], true);
  assert.equal((spec.paths["/api/workspace/agent-policy"].put as any)["x-session-only"], true);
  assert.equal((spec.paths["/api/canvases/{key}/proposals/{pid}/apply"].post as any)["x-session-only"], true);
  assert.equal((spec.paths["/api/canvases"].post as any)["x-required-scope"], "canvas:write");
});

test("F031: unified Agent spending policy blocks plan_only across REST/MCP, enforces server-verified approval for propose_and_confirm, and requires active cap budget for auto_within_budget", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const app = await createOriginalApp(f.p);
  const http = await startHttp(app);
  t.after(() => http.close());

  const tokens = new OriginalApiTokens(f.p);
  const policies = new OriginalAgentPolicies(f.p);
  const proposals = new OriginalCanvasProposals(f.p);
  const budgets = new OriginalBudgets(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Give workspace plenty of balance
  await f.p.db.query("UPDATE wallets SET balance = 500 WHERE workspace_id = $1", [f.workspace.id]);

  const canvasId = await f.project(
    [
      {
        id: "img1",
        type: "image",
        title: "测试图",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "a peaceful mountain sunrise",
        params: {
          model: "gpt-image-2.6-sunburst",
          ratio: "16:9",
          resolution: "1K",
          image_quality: "medium",
        },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const canvasRev = 2;

  const mint = await tokens.create(
    f.admin,
    {
      name: "Agent Runner",
      scopes: [...WORKSPACE_TOKEN_SCOPES],
      rate_limit_rpm: 120,
    },
    wsPublicId,
  );
  const bearerHeaders = {
    Authorization: `Bearer ${mint.token}`,
    "Content-Type": "application/json",
  };

  const priceRev = Number(
    (await f.p.db.query("SELECT revision FROM studio_policy")).rows[0]?.revision ?? 1,
  );

  // 1. Default policy is `plan_only`
  // REST token paid job MUST be blocked 403 (zero holds!)
  const restPlanOnly = await fetch(
    `${http.url}/api/canvases/${canvasId}/nodes/img1/runs`,
    {
      method: "POST",
      headers: bearerHeaders,
      body: JSON.stringify({
        expected_revision: canvasRev,
        price_revision: priceRev,
        uid: randomUUID(),
      }),
    },
  );
  assert.equal(restPlanOnly.status, 403);

  // MCP submit_generation_job MUST be blocked 403
  const mcpPlanOnly = await (
    await fetch(`${http.url}/api/mcp`, {
      method: "POST",
      headers: bearerHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "submit_generation_job",
          arguments: { project_id: canvasId, node_id: "img1", expected_revision: canvasRev },
        },
      }),
    })
  ).json();
  assert.equal((mcpPlanOnly as any).result.isError, true);
  assert.equal(JSON.parse((mcpPlanOnly as any).result.content[0].text).status, 403);

  const holdsAfterBlocked = (
    await f.p.db.query("SELECT * FROM ledger WHERE workspace_id=$1 AND action='hold'", [f.workspace.id])
  ).rows;
  assert.equal(holdsAfterBlocked.length, 0);

  // Normal user-initiated action (browser actor without tokenId) STILL WORKS in plan_only mode!
  const userRun = await f.runs.generate(f.admin, canvasId, "img1", {
    expected_revision: canvasRev,
    uid: randomUUID(),
  });
  assert.ok(userRun.id);

  // 2. Switching to `auto_within_budget` WITHOUT an active `cap` budget MUST be rejected 400!
  await assert.rejects(
    policies.set(f.admin, { execution_policy: "auto_within_budget" }, wsPublicId),
    (err: unknown) => (err as { status?: number })?.status === 400,
  );

  // 3. `propose_and_confirm` requires a server-verified user-approved (`applied`) proposal!
  await policies.set(f.admin, { execution_policy: "propose_and_confirm" }, wsPublicId);

  // Create a pending proposal via Bearer token (allowed!)
  const propResp = await fetch(`${http.url}/api/canvases/${canvasId}/proposals`, {
    method: "POST",
    headers: bearerHeaders,
    body: JSON.stringify({
      title: "加一张新分镜图",
      summary: "等待审批",
      base_revision: canvasRev,
      operations: [
        {
          op: "add_node",
          temp_id: "img2",
          type: "image",
          title: "提案新图",
          x: 400,
          y: 0,
          prompt: "cinematic skyline at dusk",
          params: {
            model: "gpt-image-2.6-sunburst",
            ratio: "16:9",
            resolution: "1K",
            image_quality: "medium",
          },
        },
      ],
    }),
  });
  assert.equal(propResp.status, 200);
  const prop = (await propResp.json()) as { id: string };

  // Bearer token CANNOT self-approve its own proposal (403)!
  const selfApply = await fetch(
    `${http.url}/api/canvases/${canvasId}/proposals/${prop.id}/apply`,
    {
      method: "POST",
      headers: bearerHeaders,
      body: JSON.stringify({ expected_revision: canvasRev }),
    },
  );
  assert.equal(selfApply.status, 403);

  // Submitting paid job with unapproved (still pending) proposal MUST fail 403!
  const unapprovedRun = await fetch(
    `${http.url}/api/canvases/${canvasId}/nodes/img1/runs`,
    {
      method: "POST",
      headers: { ...bearerHeaders, "X-Approved-Proposal-Id": prop.id },
      body: JSON.stringify({
        expected_revision: canvasRev,
        price_revision: priceRev,
        uid: randomUUID(),
      }),
    },
  );
  assert.equal(unapprovedRun.status, 403);

  // Human approves the proposal via browser session -> status='applied'
  const applied = await proposals.apply(f.admin, canvasId, prop.id, {
    expected_revision: canvasRev,
  });
  const newNodeId = applied.temp_id_map.img2;
  const newRev = applied.canvas.revision;

  // Now Bearer token WITH server-verified approved proposal ID SUCCEEDS!
  const approvedRun = await fetch(
    `${http.url}/api/canvases/${canvasId}/nodes/${newNodeId}/runs`,
    {
      method: "POST",
      headers: { ...bearerHeaders, "X-Approved-Proposal-Id": prop.id },
      body: JSON.stringify({
        expected_revision: newRev,
        price_revision: priceRev,
        uid: randomUUID(),
      }),
    },
  );
  assert.equal(approvedRun.status, 200);

  // 4. Enabling active workspace `cap` budget unlocks `auto_within_budget`
  await budgets.upsertPolicy(
    f.admin,
    {
      scope_type: "workspace",
      period: "monthly",
      warn_limit: 50,
      cap_limit: 200,
      mode: "cap",
      enabled: true,
    },
    wsPublicId,
  );
  await policies.set(f.admin, { execution_policy: "auto_within_budget" }, wsPublicId);

  // Now agent can submit without approved_proposal_id (still bounded by cap budget!)
  await policies.enforceForAgentAction(f.p.db, f.workspace.id);

  // Disabling the cap budget immediately re-blocks auto_within_budget execution!
  await budgets.upsertPolicy(
    f.admin,
    {
      scope_type: "workspace",
      period: "monthly",
      warn_limit: 50,
      cap_limit: 200,
      mode: "cap",
      enabled: false,
    },
    wsPublicId,
  );
  await assert.rejects(
    policies.enforceForAgentAction(f.p.db, f.workspace.id),
    (err: unknown) => (err as { status?: number })?.status === 403,
  );
});
