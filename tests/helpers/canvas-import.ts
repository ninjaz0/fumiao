import type { Sql } from "@fumiao/platform/db.js";
import type { LegacyExport } from "@fumiao/platform/importer.js";
import { canvasText } from "@fumiao/original-api/canvas-values.js";
import { uuid5 } from "@fumiao/platform/uuid.js";
import { chatImportDraft } from "./chat-import.js";

/** Reconstruct original rows solely from native tables, never the audit archive. */
export async function canvasImportTables(sql: Sql) {
  const query = async (text: string, numbers: string[], raw: string[] = []) =>
    (await sql.query(text)).rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          v === null
            ? null
            : numbers.includes(k)
              ? Number(v)
              : raw.includes(k)
                ? canvasText(v)
                : v,
        ]),
      ),
    );
  return {
    canvas_projects: await query(
      `SELECT d.public_id AS id,c.title,u.public_id AS owner,e.public_id AS last_editor,c.created,c.updated,d.revision,c.document,w.public_id AS workspace
      FROM canvas_documents c JOIN documents d ON d.id=c.project_id JOIN users u ON u.id=d.owner_id JOIN users e ON e.id=c.last_editor JOIN workspaces w ON w.id=d.workspace_id`,
      ["owner", "last_editor", "created", "updated", "revision", "workspace"],
      ["title", "document"],
    ),
    canvas_media_refs: await query(
      `SELECT d.public_id AS project,r.node,a.public_id AS media FROM canvas_media_refs r JOIN documents d ON d.id=r.project_id JOIN assets a ON a.id=r.asset_id`,
      [],
    ),
    canvas_job_links: await query(
      `SELECT l.id,d.public_id AS project,l.node,j.public_id AS job,u.public_id AS owner,l.uid,l.inputs,l.created FROM canvas_job_links l JOIN documents d ON d.id=l.project_id LEFT JOIN jobs j ON j.id=l.job_id JOIN users u ON u.id=l.owner_id`,
      ["id", "job", "owner", "created"],
      ["inputs"],
    ),
    canvas_run_batches: await query(
      `SELECT u.public_id AS owner,b.uid,d.public_id AS project,b.node,b.count,b.result FROM canvas_run_batches b JOIN documents d ON d.id=b.project_id JOIN users u ON u.id=b.owner_id`,
      ["owner", "count"],
      ["result"],
    ),
    storyboard_exports: await query(
      `SELECT e.public_id AS id,e.ordinal AS original_order,e.uid,u.public_id AS owner,w.public_id AS workspace,d.public_id AS project,e.revision,e.snapshot,e.state,a.public_id AS result,e.subtitles,e.error,e.created,e.updated FROM storyboard_exports e JOIN users u ON u.id=e.owner_id JOIN workspaces w ON w.id=e.workspace_id LEFT JOIN documents d ON d.id=e.project_id LEFT JOIN assets a ON a.id=e.result_id`,
      [
        "original_order",
        "owner",
        "workspace",
        "revision",
        "created",
        "updated",
      ],
      ["snapshot", "subtitles", "error"],
    ),
    storyboard_export_refs: await query(
      `SELECT e.public_id AS export,a.public_id AS media FROM storyboard_export_refs r JOIN storyboard_exports e ON e.id=r.export_id JOIN assets a ON a.id=r.asset_id`,
      [],
    ),
  };
}
export function canvasImportDraft(): LegacyExport {
  const d = chatImportDraft();
  d.source = "canvas-history-test";
  for (const table of [
    "conversations",
    "chat_messages",
    "chat_turns",
    "credit_chat_charges",
    "canvas_chat_links",
    "chat_applications",
    "credit_ledger",
  ])
    d.tables[table] = [];
  const t = d.tables,
    project = "c".repeat(32),
    teamProject = "d".repeat(32),
    media = "a".repeat(32),
    video = "b".repeat(32),
    pack = "e".repeat(32);
  const uid = "00000000-0000-0000-0000-000000000123";
  t.workspaces.push({ id: 90, kind: "team", owner: 7, name: "团队" });
  // Historical creator 42 is no longer a team member.
  t.workspace_members = [{ workspace: 90, user: 7 }];
  t.credit_accounts.push({ workspace: 90, balance: 100, reserved: 0 });
  t.media = [
    {
      id: media,
      owner: 7,
      workspace: 20,
      kind: "ref",
      mime: "image/png",
      size: 0,
    },
    {
      id: video,
      owner: 7,
      workspace: 20,
      kind: "video",
      mime: "video/mp4",
      size: 0,
    },
  ];
  t.asset_packs = [
    {
      id: pack,
      owner: 42,
      workspace: 90,
      name: "旧成员的包",
      purpose: "subject",
      description: "",
      revision: 4,
      updated: 3,
    },
  ];
  t.asset_pack_media = [];
  t.canvas_projects[0].title = "原画布\0😀";
  t.canvas_projects[0].document = JSON.stringify(
    {
      schemaVersion: 1,
      nodes: [
        {
          id: "v",
          type: "video",
          x: 0,
          y: 0,
          active_job: 11,
          media_id: video,
          prompt: "/media/" + media + "\0😀",
        },
      ],
      edges: [],
      shots: ["v"],
    },
    null,
    2,
  );
  t.canvas_projects.push({
    id: teamProject,
    owner: 42,
    workspace: 90,
    last_editor: 7,
    title: "历史团队",
    created: 1,
    updated: 10,
    revision: 3,
    document: JSON.stringify({
      nodes: [
        {
          id: "n",
          type: "image",
          x: 0,
          y: 0,
          asset_packs: [{ id: pack, revision: 1 }],
        },
      ],
    }),
  });
  t.canvas_media_refs = [{ project, node: "v", media: video }];
  t.jobs = [
    {
      id: 11,
      uid: uuid5(uid, "job"),
      owner: 7,
      workspace: 20,
      kind: "video",
      model: "MiniMax H3",
      prompt: "历史",
      refs: "[]",
      status: "done",
      result: video,
      created: 1,
      updated: 2,
    },
  ];
  t.canvas_job_links = [
    {
      id: 12,
      project,
      node: "removed",
      job: 11,
      owner: 7,
      uid: uuid5(uid, "candidate:0"),
      inputs: '{ "prompt" : "\\u0000 /media/' + media + '" }',
      created: 2,
    },
    {
      id: 30,
      project,
      node: "removed",
      job: null,
      owner: 7,
      uid: uuid5(uid, "candidate:1"),
      inputs: '{"prompt":"已删任务"}',
      created: 2,
    },
    {
      id: 45,
      project,
      node: "v",
      job: 11,
      owner: 7,
      uid: uuid5(uid, "selected"),
      inputs: "{}",
      created: 3,
    },
  ];
  t.canvas_run_batches = [
    {
      owner: 7,
      uid,
      project,
      node: "removed",
      count: 2,
      result: '{ "ids": [11, 19], "count": 2, "credits": 18 }',
    },
  ];
  t.credit_charges = [11, 19].map((job) => ({
    job,
    owner: 7,
    workspace: 20,
    amount: 9,
    state: job === 11 ? "spent" : "refunded",
    price_key: "MiniMax H3|6s",
    price_revision: 1,
    created: 1,
  }));
  t.storyboard_exports = [1, 2, 3].map((n) => ({
    id: n.toString().repeat(32),
    original_order: n * 10,
    uid: uuid5(uid, "export:" + n),
    owner: 7,
    workspace: 20,
    project: n === 3 ? null : project,
    revision: 2,
    snapshot:
      '[ {"node":"old-shot", "video":"' +
      "f".repeat(32) +
      '", "text":"\\u0000"} ]',
    state: n === 2 ? "failed" : "done",
    result: n === 2 ? null : video,
    subtitles: "字幕\0😀\n",
    error: n === 2 ? "旧错误\0" : "",
    created: 4,
    updated: 5,
  }));
  t.storyboard_export_refs = [{ export: "2".repeat(32), media }];
  return d;
}
