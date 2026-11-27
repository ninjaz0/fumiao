import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { chatContext } from "@fumiao/platform/chat-context.js";
import { OriginalApiTokens } from "@fumiao/original-api/tokens.js";
import { buildOpenApiSpec } from "@fumiao/original-api/openapi.js";
import {
  extractSkillFromZip,
  loadActiveWorkspaceSkills,
  OriginalSkills,
  parseSkillMarkdown,
} from "@fumiao/original-api/skills.js";
import {
  OriginalAgentPolicies,
  OriginalCanvasProposals,
} from "@fumiao/original-api/proposals.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

/** Builds a minimal valid single-file ZIP archive in memory (supports stored or deflated). */
function makeZip(entries: { name: string; content: Buffer; deflate?: boolean }[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const method = e.deflate ? 8 : 0;
    const comp = e.deflate ? deflateRawSync(e.content) : e.content;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(e.content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);

    localParts.push(local, comp);
    cdParts.push(cd);
    offset += local.length + comp.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test("F035 Workspace Scoped API Tokens enforce workspace isolation (403), RPM rate limits (429), revocation, and OpenAPI 3.1", async () => {
  const f = await canvasRunsFixture();
  try {
    const tokens = new OriginalApiTokens(f.p);
    const created = await tokens.create(
      f.admin,
      {
        name: "CI Pipeline Token",
        scopes: ["canvas:read", "mcp:use"],
        rate_limit_rpm: 2,
      },
      String(f.team.public_id),
    );
    assert.ok(created.token.startsWith("fmk_"));

    // Listing never reveals plaintext secret
    const listed = await tokens.list(f.admin, String(f.team.public_id));
    assert.equal(listed.tokens.length, 1);
    assert.equal(listed.tokens[0].prefix, created.prefix);
    assert.equal("token" in listed.tokens[0], false);

    // Valid auth on bound workspace succeeds
    const auth1 = await tokens.authenticateBearer(
      created.token,
      String(f.team.public_id),
    );
    assert.equal(auth1.workspaceId, f.team.id);

    // Cross-workspace X-Workspace-Id MUST be rejected with 403!
    await assert.rejects(
      () =>
        tokens.authenticateBearer(
          created.token,
          String(f.workspace.public_id),
        ),
      { status: 403 },
    );

    // 2nd valid call succeeds; 3rd exceeds RPM=2 -> 429!
    await tokens.authenticateBearer(created.token);
    await assert.rejects(() => tokens.authenticateBearer(created.token), {
      status: 429,
    });

    // Revoke token -> 401
    await tokens.revoke(f.admin, created.id, String(f.team.public_id));
    await assert.rejects(() => tokens.authenticateBearer(created.token), {
      status: 401,
    });

    // OpenAPI 3.1.0 spec
    const spec = buildOpenApiSpec("https://studio.example.test");
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/api/mcp"]);
    assert.ok(spec.paths["/api/canvases/{key}/proposals"]);
  } finally {
    await f.cleanup();
  }
});

test("F017 Workspace SKILL.md parsing, ZIP path-traversal rejection, and chatContext skill injection", async () => {
  const f = await canvasRunsFixture();
  try {
    const skills = new OriginalSkills(f.p);

    const parsed = parseSkillMarkdown(
      `---\nname: 赛博短剧风格\nslug: cyber-director\ndescription: 霓虹夜景镜头规范\ntags: [cyber, noir]\n---\n\n每个分镜必须包含景别与雨夜霓虹反光细节。`,
    );
    assert.equal(parsed.slug, "cyber-director");
    assert.equal(parsed.name, "赛博短剧风格");

    // Path traversal inside ZIP MUST be rejected!
    const maliciousZip = makeZip([
      {
        name: "../../etc/passwd",
        content: Buffer.from("root:x:0:0"),
      },
      {
        name: "SKILL.md",
        content: Buffer.from("---\nname: evil\n---\nbody"),
      },
    ]);
    assert.throws(() => extractSkillFromZip(maliciousZip), { status: 400 });

    // Valid deflated ZIP package imports cleanly
    const validZip = makeZip([
      {
        name: "my-skill/SKILL.md",
        content: Buffer.from(
          "---\nname: 分镜节奏器\ndescription: 黄金三秒法则\n---\n\n首镜必须在 2 秒内抛出戏剧悬念。",
          "utf8",
        ),
        deflate: true,
      },
    ]);
    const imported = await skills.importZip(
      f.admin,
      validZip,
      String(f.team.public_id),
    );
    assert.equal(imported.name, "分镜节奏器");
    assert.equal(imported.enabled, true);

    // Active skills inject into chatContext system prompt cleanly!
    const active = await loadActiveWorkspaceSkills(f.db, f.team.id);
    assert.equal(active.length, 1);
    const messages = chatContext(
      [
        {
          role: "user",
          content: "帮我写第1集分镜",
          state: "complete",
          context: "{}",
        },
      ],
      active,
    );
    assert.equal(messages[0].role, "system");
    assert.match(messages[0].content, /<workspace_skills>/);
    assert.match(messages[0].content, /分镜节奏器/);
    assert.match(messages[0].content, /黄金三秒|首镜必须/);
  } finally {
    await f.cleanup();
  }
});

test("F018 + F031 + F012 Proposal-based Canvas Agent, plan_only safety guardrail, and live Streamable HTTP MCP Server", async () => {
  const f = await canvasRunsFixture();
  const app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  try {
    const addr = app.getHttpServer().address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    const tokens = new OriginalApiTokens(f.p);
    const policies = new OriginalAgentPolicies(f.p);
    const proposals = new OriginalCanvasProposals(f.p);

    const project = await f.canvases.create(
      f.admin,
      { title: "MCP 提案测试画布" },
      String(f.team.public_id),
    );

    // Issue scoped token for team workspace
    const tok = await tokens.create(
      f.admin,
      {
        name: "MCP Client",
        scopes: [
          "mcp:use",
          "canvas:read",
          "canvas:propose",
          "pack:read",
          "job:submit",
          "job:read",
        ],
        rate_limit_rpm: 120,
      },
      String(f.team.public_id),
    );

    const mcpCall = async (
      method: string,
      params: Record<string, unknown> = {},
      extraHeaders: Record<string, string> = {},
    ) => {
      const res = await fetch(`${base}/api/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tok.token}`,
          ...extraHeaders,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return {
        status: res.status,
        headers: res.headers,
        body: await res.json(),
      };
    };

    // 1. Cross-workspace header via Bearer token is rejected with 403!
    const crossWs = await mcpCall(
      "tools/list",
      {},
      { "X-Workspace-Id": String(f.workspace.public_id) },
    );
    assert.equal(crossWs.status, 403);

    // 2. MCP initialize returns session id & X-Accel-Buffering: no
    const init = await mcpCall("initialize");
    assert.equal(init.status, 200);
    const sessionId = init.headers.get("mcp-session-id");
    assert.ok(sessionId);
    assert.equal(init.headers.get("x-accel-buffering"), "no");
    assert.equal(init.body.result.serverInfo.name, "fumiao-mcp");

    // 3. tools/list returns all 8 tools
    const toolsList = await mcpCall("tools/list", {}, { "mcp-session-id": sessionId! });
    assert.equal(toolsList.body.result.tools.length, 8);

    // 4. propose_canvas_patch via MCP creates a pending proposal (0 wallet charge, canvas untouched!)
    const proposeRes = await mcpCall(
      "tools/call",
      {
        name: "propose_canvas_patch",
        arguments: {
          project_id: project.id,
          title: "新增两镜开场",
          summary: "添加一个文案节点和一个视频镜头并连线",
          operations: [
            {
              op: "add_node",
              temp_id: "txt-1",
              type: "text",
              title: "开场文案",
              x: 40,
              y: 40,
              text: "霓虹雨夜，侦探走入巷口",
            },
            {
              op: "add_node",
              temp_id: "vid-1",
              type: "video",
              title: "镜头 01",
              x: 440,
              y: 40,
              prompt: "低角度仰拍缓慢推进",
            },
            { op: "add_edge", source: "txt-1", target: "vid-1" },
            { op: "set_shots", shots: ["vid-1"] },
          ],
        },
      },
      { "mcp-session-id": sessionId! },
    );
    assert.equal(proposeRes.body.result.isError, false);
    const createdProp = proposeRes.body.result.structuredContent;
    assert.equal(createdProp.status, "pending");
    assert.ok(createdProp.estimated_credits >= 0);

    // Canvas is still untouched at revision 1 until human approves!
    const beforeApprove = await f.canvases.get(f.admin, project.id);
    assert.equal(beforeApprove.revision, 1);
    assert.equal(beforeApprove.document.nodes.length, 0);

    // 5. Approve proposal -> atomically writes nodes, edge, and shots to canvas!
    const applied = await proposals.apply(f.admin, project.id, createdProp.id, {
      expected_revision: 1,
    });
    assert.equal(applied.proposal.status, "applied");
    assert.equal(applied.canvas.revision, 2);
    assert.equal(applied.canvas.document.nodes.length, 2);
    assert.equal(applied.canvas.document.edges.length, 1);
    assert.equal(applied.canvas.document.shots?.length, 1);

    // 6. F031 HARD GUARDRAIL: default workspace policy is `plan_only`, so MCP `submit_generation_job` MUST FAIL!
    const blockedSubmit = await mcpCall(
      "tools/call",
      {
        name: "submit_generation_job",
        arguments: {
          project_id: project.id,
          node_id: applied.temp_id_map["vid-1"],
          expected_revision: 2,
        },
      },
      { "mcp-session-id": sessionId! },
    );
    assert.equal(blockedSubmit.body.result.isError, true);
    assert.match(blockedSubmit.body.result.content[0].text, /plan_only/);

    // 7. After explicitly enabling `propose_and_confirm`, MCP `submit_generation_job` requires the server-verified approved proposal ID!
    await policies.set(
      f.admin,
      { execution_policy: "propose_and_confirm" },
      String(f.team.public_id),
    );
    const allowedSubmit = await mcpCall(
      "tools/call",
      {
        name: "submit_generation_job",
        arguments: {
          project_id: project.id,
          node_id: applied.temp_id_map["vid-1"],
          expected_revision: 2,
          approved_proposal_id: createdProp.id,
        },
      },
      { "mcp-session-id": sessionId! },
    );
    assert.equal(allowedSubmit.body.result.isError, false);
    const jobId = allowedSubmit.body.result.structuredContent.id;
    assert.ok(Number.isSafeInteger(jobId) && jobId > 0);

    // 8. Query job status via MCP `get_job_status`
    const statusRes = await mcpCall(
      "tools/call",
      { name: "get_job_status", arguments: { job_id: jobId } },
      { "mcp-session-id": sessionId! },
    );
    assert.equal(statusRes.body.result.isError, false);
    assert.equal(statusRes.body.result.structuredContent.id, jobId);

    // 9. Public OpenAPI 3.1 endpoint reachable over HTTP without auth
    const oaRes = await fetch(`${base}/api/v1/openapi.json`);
    assert.equal(oaRes.status, 200);
    const oaJson = (await oaRes.json()) as any;
    assert.equal(oaJson.openapi, "3.1.0");
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("PR #223 Item 9: SkillEditorCard states 64 KiB SKILL.md and 256 KiB ZIP limits and round-trips extra YAML frontmatter fields losslessly", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const skillCardSrc = readFileSync(
    join(process.cwd(), "apps/web/studio/SkillEditorCard.tsx"),
    "utf8",
  );
  assert.match(skillCardSrc, /64\s*KiB/);
  assert.match(skillCardSrc, /256\s*KiB/);

  const { serializeSkillMarkdown } = await import(
    "../../apps/web/studio/skill-markdown.js"
  );

  const f = await canvasRunsFixture();
  try {
    const skills = new OriginalSkills(f.p);
    const ws = String(f.team.public_id);
    const created = await skills.create(
      f.admin,
      {
        enabled: true,
        raw_md: [
          "---",
          "name: 高阶导演手册",
          "slug: pro-director-guide",
          "description: 包含扩展元数据字段的技能包",
          "version: 2.1.0",
          "author: Studio Lead",
          "strict: true",
          "tags:",
          "  - cyberpunk",
          '  - "noir, rain"',
          "allowed-tools: [read_canvas, propose_patch]",
          "---",
          "",
          "保持高反差边缘光与紧凑叙事剪辑。",
        ].join("\n"),
      },
      ws,
    );

    assert.equal(created.frontmatter.version, "2.1.0");
    assert.equal(created.frontmatter.author, "Studio Lead");
    assert.equal(created.frontmatter.strict, true);
    assert.deepEqual(created.frontmatter.tags, ["cyberpunk", "noir, rain"]);
    assert.deepEqual(created.frontmatter["allowed-tools"], [
      "read_canvas",
      "propose_patch",
    ]);

    // Simulate opening skill in SkillEditorCard edit mode, editing body text, and saving back via raw_md
    const editorMd = serializeSkillMarkdown(created);
    const editedMd = editorMd.replace(
      "保持高反差边缘光与紧凑叙事剪辑。",
      "保持高反差边缘光、雨夜反光与紧凑叙事剪辑。",
    );
    const saved = await skills.update(f.admin, created.id, {
      expected_revision: created.revision,
      raw_md: editedMd,
    });

    assert.equal(saved.name, "高阶导演手册");
    assert.equal(saved.slug, "pro-director-guide");
    assert.equal(saved.description, "包含扩展元数据字段的技能包");
    assert.equal(saved.frontmatter.version, "2.1.0");
    assert.equal(saved.frontmatter.author, "Studio Lead");
    assert.equal(saved.frontmatter.strict, true);
    assert.deepEqual(saved.frontmatter.tags, ["cyberpunk", "noir, rain"]);
    assert.deepEqual(saved.frontmatter["allowed-tools"], [
      "read_canvas",
      "propose_patch",
    ]);
    assert.match(saved.body_md, /雨夜反光/);
  } finally {
    await f.cleanup();
  }
});
