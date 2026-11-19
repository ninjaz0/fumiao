import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Platform } from "./platform.js";
import { one, type Sql } from "./db.js";
import { requireValue, hash } from "./security.js";
import { importModelSettings } from "./import-models.js";
import { modifiedSeconds } from "./storage.js";
import { canonical } from "./plugins.js";
import { packStorage } from "./packs.js";
import {
  canvasCollections,
  validateCanvasImport,
  importCanvasProjects,
  importCanvasRelations,
} from "./import-canvases.js";
import { importTiming } from "./import-timing.js";
import {
  chatCollections,
  validateChatImport,
  importChats,
} from "./import-chats.js";
import {
  validateStateImport,
  validateRetiredFmworkerImport,
  importStateNodes,
  importStateSettings,
} from "./import-state.js";
export type LegacyExport = {
  version: 1;
  source: string;
  stateVersion?: 1;
  chatVersion?: 1;
  canvasVersion?: 1;
  tables: Record<string, Record<string, any>[]>;
};
export function legacyId(source: string, kind: string, id: unknown) {
  const hex = createHash("sha256")
    .update(source + ":" + kind + ":" + String(id))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function importLegacy(
  p: Platform,
  data: LegacyExport,
  objects: string,
  options: { avatars?: string } = {},
) {
  return p.db.transaction(async (sql) => {
    // Serialize the object copies as well as the SQL writes. Bootstrap takes
    // the same initialization lock, so it cannot win halfway through a copy.
    await sql.query("SELECT pg_advisory_xact_lock(2489732)");
    return importLegacyOn(p, sql, data, objects, options);
  });
}

async function importLegacyOn(
  p: Platform,
  sql: Sql,
  data: LegacyExport,
  objects: string,
  options: { avatars?: string },
) {
  requireValue(
    data.version === 1 && /^[a-zA-Z0-9_-]{1,80}$/.test(data.source),
    400,
    "迁移文件版本或来源无效",
  );
  const rows = (name: string) => data.tables[name] || [];
  const id = (kind: string, value: unknown) =>
    legacyId(data.source, kind, value);
  const fingerprint = hash(canonical(data));
  const chats = validateChatImport(data.tables, data.chatVersion);
  const canvases = validateCanvasImport(data.tables, data.canvasVersion);
  const completed = await one(
    sql,
    "SELECT fingerprint FROM legacy_imports WHERE source=$1",
    [data.source],
  );
  if (completed) {
    requireValue(
      completed.fingerprint === fingerprint,
      409,
      "相同迁移来源的内容已变化",
    );
    return { alreadyImported: true };
  }
  requireValue(
    !(await one(sql, "SELECT id FROM users LIMIT 1")),
    409,
    "旧实例迁移必须使用空数据库；请勿先 bootstrap",
  );
  const publicNodes = validateStateImport(data.tables, data.stateVersion);
  const retirement = await one(
    sql,
    "SELECT to_regclass('retired_fmworker_credentials') IS NOT NULL AS applied",
  );
  const { history, retiredNodes } = validateRetiredFmworkerImport(
    data.tables,
    publicNodes,
    retirement.applied,
  );
  requireValue(
    rows("credit_accounts").every((w) => Number(w.reserved) === 0) &&
      rows("credit_charges").every((charge) => charge.state !== "held"),
    409,
    "仍有未结算积分",
  );
  requireValue(
    rows("jobs").every((j) =>
      ["done", "failed", "cancelled"].includes(j.status),
    ),
    409,
    "仍有执行中的旧任务",
  );
  requireValue(
    rows("recharge_orders").every((order) =>
      ["paid", "expired"].includes(order.state),
    ),
    409,
    "仍有未确认充值订单，请先核对或关闭后导出",
  );
  const admin = rows("users").find((u) => u.role === "admin");
  requireValue(admin, 400, "旧实例缺少管理员");
  const adminId = admin.id;
  for (const table of [
    "users",
    "workspaces",
    "registration_codes",
    "credit_ledger",
    "jobs",
    "favorites",
  ])
    requireValue(
      rows(table).every((row) => Number.isSafeInteger(row.id) && row.id > 0),
      400,
      "旧公开编号无效",
    );
  // A deleted task can remain in a batch reply or financial history. Its public
  // number must never be allocated to a different post-import task.
  let lastJobNumber = 0;
  for (const value of [
    ...rows("jobs").map((row) => row.id),
    ...rows("credit_charges").map((row) => row.job),
    ...["fm_rewards", "fm_assignments", "fm_fund_holds", "fm_account_ledger"]
      .flatMap((collection) => history[collection].map((row) => row.job))
      .filter((value) => value != null),
    ...rows("credit_ledger")
      .map((row) => row.job)
      .filter((value) => value != null),
  ]) {
    requireValue(
      Number.isSafeInteger(value) && value > 0,
      400,
      "旧任务公开编号无效",
    );
    lastJobNumber = Math.max(lastJobNumber, value);
  }
  requireValue(
    rows("registration_codes").every(
      (r) => typeof r.code === "string" && r.code.length > 0,
    ),
    400,
    "导出文件缺少邀请码，请使用 --include-registration-codes 重新导出",
  );
  for (const account of rows("credit_accounts")) {
    const last = rows("credit_ledger")
      .filter((l) => l.workspace === account.workspace)
      .sort((a, b) => b.id - a.id)[0];
    requireValue(
      !last ||
        (last.balance === account.balance &&
          last.reserved === account.reserved),
      409,
      "旧账本快照与钱包余额不一致",
    );
  }
  const referenceMedia = new Map(rows("media").map((m) => [m.id, m]));
  const referenceIds = new Set<string>();
  for (const reference of rows("h3_reference_media")) {
    const media = referenceMedia.get(reference.media);
    requireValue(
      media &&
        ["ref_video", "ref_audio"].includes(media.kind) &&
        typeof reference.seconds === "number" &&
        Number.isFinite(reference.seconds) &&
        reference.seconds >= 0 &&
        typeof reference.fps === "number" &&
        Number.isFinite(reference.fps) &&
        reference.fps >= 0 &&
        [0, 1, false, true].includes(reference.has_audio) &&
        typeof reference.name === "string" &&
        [...reference.name].length <= 120 &&
        !referenceIds.has(reference.media),
      400,
      "旧参考素材信息无效",
    );
    referenceIds.add(reference.media);
  }
  const avatarKeys = [
    ...new Set(
      rows("users")
        .map((u) => u.avatar)
        .filter((a) => typeof a === "string" && a.startsWith("upload:"))
        .map((a) => a.slice(7)),
    ),
  ];
  requireValue(
    avatarKeys.every((k) => /^[0-9a-f]{32}$/.test(k)),
    400,
    "旧头像编号无效",
  );
  requireValue(
    !avatarKeys.length ||
      (options.avatars &&
        avatarKeys.every((k) => rows("avatar_files").some((a) => a.key === k))),
    400,
    "导出文件缺少头像清单或头像目录，请重新导出并设置 LEGACY_AVATARS",
  );
  const avatarFiles: {
    key: string;
    objectKey: string;
    size: number;
    sha256: string;
    modified: number;
  }[] = [];
  for (const key of avatarKeys) {
    const entry = rows("avatar_files").find((a) => a.key === key)!;
    const bytes = await readFile(join(options.avatars!, key + ".webp"));
    requireValue(
      entry.size === bytes.length &&
        createHash("sha256").update(bytes).digest("hex") === entry.sha256,
      409,
      "旧头像文件与导出清单不一致",
    );
    requireValue(
      Number.isFinite(entry.modified) && entry.modified >= 0,
      400,
      "旧头像时间无效",
    );
    const objectKey = "avatar-" + id("avatar", key);
    // Keep the import bounded to one file; failed SQL imports can reuse deterministic keys.
    await p.storage.put(objectKey, bytes, "image/webp");
    avatarFiles.push({
      key,
      size: entry.size,
      sha256: entry.sha256,
      modified: entry.modified,
      objectKey,
    });
  }
  const mediaIds = new Map(rows("media").map((m) => [m.id, id("asset", m.id)]));
  const rewrite = (value: any): any => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, rewrite(v)]),
      );
    if (typeof value === "string")
      return (
        mediaIds.get(value) ||
        value.replace(
          /\/media\/([a-f0-9]{32})/g,
          (_, key) => "/media/" + (mediaIds.get(key) || key),
        )
      );
    return value;
  };
  const modified = new Map<string, number>();
  // Copy before writing rows. Unreferenced objects from a failed transaction
  // can be replaced by a retry on the same dedicated target storage.
  for (const media of rows("media")) {
    requireValue(/^[0-9a-f]{32}$/.test(media.id), 400, "旧素材编号无效");
    const path = join(objects, media.id);
    const bytes = await readFile(path);
    const info = await stat(path, { bigint: true });
    requireValue(
      bytes.length === Number(media.size),
      409,
      "旧素材长度不一致：" + media.id,
    );
    if (media.sha256 !== undefined)
      requireValue(
        createHash("sha256").update(bytes).digest("hex") === media.sha256 &&
          info.mtimeNs.toString() === media.modified_ns,
        409,
        "旧素材内容或修改时间与导出清单不一致：" + media.id,
      );
    modified.set(media.id, modifiedSeconds(info.mtimeNs));
    await p.storage.put(id("asset", media.id), bytes, media.mime);
  }
  async function writeRecords() {
    for (const file of avatarFiles)
      await sql.query(
        "INSERT INTO avatar_objects(public_id,object_key,size,modified,sha256) VALUES($1,$2,$3,$4,$5)",
        [file.key, file.objectKey, file.size, file.modified, file.sha256],
      );
    for (const user of rows("users"))
      await sql.query(
        "INSERT INTO users(id,name,nickname,password,role,active,public_id,avatar,deleted_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,now()))",
        [
          id("user", user.id),
          user.name,
          user.nickname || user.name,
          `legacy-scrypt:${user.salt}:${user.pw}`,
          user.role === "admin" ? "admin" : "member",
          !!user.active,
          user.id,
          user.avatar || "builtin:alpine",
          user.deleted_at ? new Date(user.deleted_at * 1000) : null,
          user.created == null ? null : new Date(user.created * 1000),
        ],
      );
    for (const w of rows("workspaces")) {
      await sql.query(
        "INSERT INTO workspaces(id,name,owner_id,kind,public_id,revision,created_at) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,now()))",
        [
          id("workspace", w.id),
          w.name,
          id("user", w.owner ?? adminId),
          w.kind,
          w.id,
          w.revision ?? 1,
          w.created == null ? null : new Date(w.created * 1000),
        ],
      );
      const account = rows("credit_accounts").find((a) => a.workspace === w.id);
      const balance = Number(account?.balance || 0);
      requireValue(
        Number.isSafeInteger(balance) && balance >= 0,
        400,
        "旧余额无效",
      );
      await sql.query(
        "INSERT INTO wallets(workspace_id,balance) VALUES($1,$2)",
        [id("workspace", w.id), balance],
      );
      if (!rows("credit_ledger").some((entry) => entry.workspace === w.id))
        await sql.query(
          "INSERT INTO ledger(id,workspace_id,key,action,amount,public_id,balance_snapshot,held_snapshot) VALUES($1,$2,$3,'migration',$4,NULL,$4,0)",
          [
            randomUUID(),
            id("workspace", w.id),
            "import:" + data.source + ":" + w.id,
            balance,
          ],
        );
    }
    for (const user of rows("users")) {
      const personal = rows("workspaces").find(
        (w) => w.kind === "personal" && w.owner === user.id,
      );
      const selected = rows("workspaces").find(
        (w) => w.id === user.default_workspace,
      );
      await sql.query("UPDATE users SET default_workspace=$2 WHERE id=$1", [
        id("user", user.id),
        selected || personal
          ? id("workspace", (selected || personal)!.id)
          : null,
      ]);
    }
    for (const [table, kind] of [
      ["users", "user"],
      ["workspaces", "workspace"],
    ]) {
      for (const row of rows(table))
        await sql.query(
          "INSERT INTO import_records(source,kind,legacy_id,target_id) VALUES($1,$2,$3,$4)",
          [data.source, kind, String(row.id), id(kind, row.id)],
        );
      // Explicit imports must not leave the identity sequence below the largest legacy ID.
      await sql.query(
        `SELECT setval(pg_get_serial_sequence('${table}','public_id'),GREATEST(COALESCE((SELECT max(public_id) FROM ${table}),0),1),EXISTS(SELECT 1 FROM ${table}))`,
      );
    }
    for (const m of rows("workspace_members"))
      await sql.query(
        "INSERT INTO members(workspace_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id("workspace", m.workspace), id("user", m.user)],
      );
    for (const invite of rows("registration_codes")) {
      await sql.query(
        `INSERT INTO invites(id,public_id,code_hash,code_secret,name,role,workspace_id,credits,enabled,expires_at,uses,created_by,created_at,revision,grant_credits)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,to_timestamp($13),$14,$15)`,
        [
          id("invitation", invite.id),
          invite.id,
          hash(invite.code.trim().toUpperCase()),
          p.vault.seal({ code: invite.code }),
          invite.name,
          invite.role,
          invite.team_id == null ? null : id("workspace", invite.team_id),
          invite.initial_credits,
          !!invite.enabled,
          invite.expires == null ? null : new Date(invite.expires * 1000),
          invite.uses,
          invite.created_by == null ? null : id("user", invite.created_by),
          invite.created,
          invite.revision,
          !!invite.grant_credits,
        ],
      );
    }
    for (const redemption of rows("registration_redemptions"))
      await sql.query(
        "INSERT INTO registration_redemptions(user_id,invitation_id,credits,workspace_id,created_at) VALUES($1,$2,$3,$4,to_timestamp($5))",
        [
          id("user", redemption.user),
          id("invitation", redemption.invitation),
          redemption.credits,
          redemption.team_id == null
            ? null
            : id("workspace", redemption.team_id),
          redemption.created,
        ],
      );
    for (const m of rows("media"))
      await sql.query(
        "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,public_id,original_kind,object_modified,original_order) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8,$9,$10,$11)",
        [
          id("asset", m.id),
          id("workspace", m.workspace),
          id("user", m.owner),
          id("asset", m.id),
          m.mime,
          m.size,
          JSON.stringify({
            width: m.w,
            height: m.h,
            legacyId: m.id,
            original: m,
          }),
          m.id,
          m.kind,
          modified.get(m.id),
          m.original_order ?? null,
        ],
      );
    await sql.query(
      "SELECT setval('assets_original_order_seq',GREATEST(COALESCE((SELECT max(original_order) FROM assets),0),1),EXISTS(SELECT 1 FROM assets WHERE original_order IS NOT NULL))",
    );
    await importStateSettings(
      sql,
      rows("state_settings"),
      id,
      rows("node_pair_names"),
    );
    for (const reference of rows("h3_reference_media")) {
      await sql.query(
        "INSERT INTO asset_reference_media(asset_id,seconds,fps,has_audio,name) VALUES($1,$2,$3,$4,$5)",
        [
          id("asset", reference.media),
          reference.seconds,
          reference.fps,
          !!reference.has_audio,
          reference.name,
        ],
      );
    }
    for (const provenance of rows("media_provenance")) {
      if (!mediaIds.has(provenance.media)) continue;
      await sql.query(
        "INSERT INTO asset_provenance(asset_id,source_id,source_public_id,frame_seconds,created_at) VALUES($1,$2,$3,$4,to_timestamp($5))",
        [
          id("asset", provenance.media),
          mediaIds.get(provenance.source) || null,
          provenance.source,
          provenance.frame_seconds,
          provenance.created,
        ],
      );
    }
    await importCanvasProjects(sql, canvases, id);
    for (const pack of rows("asset_packs")) {
      const did = id("pack", pack.id),
        wid = id("workspace", pack.workspace),
        refs = rows("asset_pack_media")
          .filter((r) => r.pack === pack.id)
          .sort((a, b) => a.position - b.position)
          .map((r) => id("asset", r.media)),
        stored = packStorage(pack.name, pack.description ?? "");
      await sql.query(
        `INSERT INTO documents(id,public_id,workspace_id,owner_id,kind,title,body,revision,updated_at,pack_text)
          VALUES($1,$2,$3,$4,'pack',$5,$6,$7,COALESCE(to_timestamp($8),now()),$9)`,
        [
          did,
          /^[a-f0-9]{32}$/.test(String(pack.id))
            ? String(pack.id)
            : did.replaceAll("-", ""),
          wid,
          id("user", pack.owner),
          stored.title,
          JSON.stringify({
            purpose: pack.purpose,
            description: stored.description,
            assets: refs,
          }),
          pack.revision ?? 1,
          pack.updated ?? null,
          stored.text,
        ],
      );
      for (const aid of new Set(refs)) {
        requireValue(
          await one(
            sql,
            "SELECT id FROM assets WHERE id=$1 AND workspace_id=$2",
            [aid, wid],
          ),
          400,
          "旧文档跨工作区引用素材",
        );
        await sql.query(
          "INSERT INTO document_assets(document_id,asset_id) VALUES($1,$2)",
          [did, aid],
        );
      }
    }
    await importChats(sql, data.source, chats, rows("canvas_projects"), id);
    // Historical jobs use an intentionally disabled archive connection. They can never be dispatched.
    const manifest = {
      id: "legacy-archive",
      version: "1.0.0",
      contractVersion: 1,
      label: "Pure 历史记录",
      mode: "pull",
      models: [],
      configSchema: { type: "object" },
    };
    await sql.query(
      "INSERT INTO plugin_versions(id,version,manifest) VALUES($1,$2,$3)",
      [manifest.id, manifest.version, JSON.stringify(manifest)],
    );
    const connection = id("connection", "legacy");
    await sql.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config) VALUES($1,'Pure 历史记录','legacy-archive','1.0.0',$2)",
      [connection, p.vault.seal({})],
    );
    await importStateNodes(sql, publicNodes, retiredNodes, connection, id);
    if (retirement.applied && retiredNodes.size) {
      await sql.query(
        "UPDATE gpu_nodes SET fmworker_retired=true WHERE id=ANY($1::uuid[])",
        [[...retiredNodes].map((node) => id("node", node))],
      );
      await sql.query(
        "INSERT INTO retired_fmworker_credentials(digest) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING",
        [
          history.fm_retired_node_credentials
            .map((row) => row.digest)
            .filter(Boolean),
        ],
      );
    }
    const known = new Set<string>();
    const contributedJobs = new Set(
      [...history.fm_assignments, ...history.fm_rewards].map((row) => row.job),
    );
    for (const j of rows("jobs")) {
      const modelName = j.model || "MiniMax H3",
        kind = j.kind || "video",
        model = id("model", modelName + kind);
      if (!known.has(model)) {
        known.add(model);
        await sql.query(
          "INSERT INTO models(id,connection_id,provider_model,label,kind,schema) VALUES($1,$2,$3,$3,$4,$5)",
          [model, connection, modelName, kind, "{}"],
        );
      }
      const jid = id("job", j.id),
        result =
          j.result && mediaIds.has(j.result)
            ? { assets: [id("asset", j.result)] }
            : null;
      await sql.query(
        `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,result,error,created_at,updated_at,public_id)
      VALUES($1,$2,$3,$4,$5,'legacy-archive','1.0.0',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,to_timestamp($16),to_timestamp($17),$18)`,
        [
          jid,
          id("workspace", j.workspace),
          id("user", j.owner),
          model,
          connection,
          p.vault.seal({}),
          modelName,
          kind,
          JSON.stringify({
            prompt: j.prompt,
            params: {
              ratio: j.ratio,
              quality: j.quality,
              seconds: j.seconds,
              seed: j.seed,
            },
            references: rewrite(JSON.parse(j.refs || "[]")),
          }),
          id("request", j.id),
          hash(String(j.id)),
          Number(
            rows("credit_charges").find((c) => c.job === j.id)?.amount || 1,
          ),
          j.status === "done" ? "completed" : j.status,
          result ? JSON.stringify(result) : null,
          j.note || null,
          j.created,
          j.updated || j.created,
          j.id,
        ],
      );
      await sql.query("UPDATE jobs SET reference_packs=$2 WHERE id=$1", [
        jid,
        JSON.stringify(JSON.parse(j.reference_packs || "[]")),
      ]);
      const actual = JSON.parse(j.output_metadata || "{}");
      // Account-bound continuation IDs cannot be sent to an ordinary Flow
      // connection. The source value remains in the archived Pure job payload.
      if (actual && (retiredNodes.has(j.node) || contributedJobs.has(j.id)))
        delete actual.flow_media_id;
      await sql.query(
        "UPDATE jobs SET original_uid=$2,original_parent=$3,original_view=$4,submission_forecast=$5,attempts=$6,original_node=$7 WHERE id=$1",
        [
          jid,
          j.uid || null,
          j.parent ?? null,
          JSON.stringify({
            ...Object.fromEntries(
              ["ratio", "quality", "seconds", "seed", "width", "height"].map(
                (key) => [key, j[key]],
              ),
            ),
            sampling_steps: j.sampling_steps ?? 20,
            image_quality: j.image_quality || "standard",
            audio_settings: JSON.parse(j.audio_settings || "{}"),
            h3_inputs: JSON.parse(j.h3_inputs || "{}"),
            actual,
            refs: JSON.parse(j.refs || "[]"),
            created: j.created,
            updated: j.updated,
            note: j.note,
            result: j.result,
          }),
          JSON.stringify(JSON.parse(j.timing_forecast || "{}")),
          j.attempts ?? null,
          j.node ?? null,
        ],
      );
      for (const aid of result?.assets || [])
        await sql.query(
          "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
          [jid, aid],
        );
      for (const aid of JSON.parse(j.refs || "[]"))
        if (mediaIds.has(aid))
          await sql.query(
            "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'input') ON CONFLICT DO NOTHING",
            [jid, id("asset", aid)],
          );
    }
    if (rows("job_runs").length) {
      await p.registry.installBuiltinsOn(sql);
      await importTiming(
        sql,
        data.source,
        rows("job_runs"),
        new Set(rows("jobs").map((j) => j.id)),
        id,
      );
    }
    await importCanvasRelations(sql, data.source, canvases, id);
    for (const entry of rows("credit_ledger")) {
      requireValue(
        ["amount", "balance", "reserved", "created"].every((k) =>
          Number.isSafeInteger(entry[k]),
        ),
        400,
        "旧账本数值无效",
      );
      await sql.query(
        `INSERT INTO ledger(id,public_id,workspace_id,actor_id,job_id,original_job_id,original_chat_turn,key,original_uid,action,amount,balance_snapshot,held_snapshot,note,created_at,chat_turn_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,to_timestamp($15),$16)`,
        [
          id("ledger", entry.id),
          entry.id,
          id("workspace", entry.workspace),
          entry.actor == null ? null : id("user", entry.actor),
          rows("jobs").some((j) => j.id === entry.job)
            ? id("job", entry.job)
            : null,
          entry.job ?? null,
          entry.chat_turn ?? null,
          "import-ledger:" + data.source + ":" + entry.id,
          entry.uid ?? null,
          entry.action,
          entry.amount,
          entry.balance,
          entry.reserved,
          entry.note,
          entry.created,
          entry.chat_turn == null ? null : id("chat-turn", entry.chat_turn),
        ],
      );
    }
    for (const table of ["invites", "ledger"])
      await sql.query(
        `SELECT setval(pg_get_serial_sequence('${table}','public_id'),GREATEST(COALESCE((SELECT max(public_id) FROM ${table}),0),1),EXISTS(SELECT 1 FROM ${table} WHERE public_id IS NOT NULL))`,
      );
    await sql.query(
      "SELECT setval(pg_get_serial_sequence('jobs','public_id'),GREATEST($1::bigint,1),$1::bigint>0)",
      [lastJobNumber],
    );
    if (
      rows("credit_prices").length ||
      rows("model_settings").length ||
      rows("workspace_model_policy").length
    ) {
      await p.registry.installBuiltinsOn(sql);
      await importModelSettings(sql, data.tables, (wid) =>
        id("workspace", wid),
      );
    }
    for (const f of rows("favorites")) {
      const job = rows("jobs").find((j) =>
        f.job ? j.id === f.job : j.result === f.media,
      );
      const aid = f.media;
      if (job || (aid && mediaIds.has(aid)))
        await sql.query(
          "INSERT INTO favorites(id,user_id,asset_id,job_id,created_at) VALUES($1,$2,$3,$4,to_timestamp($5)) ON CONFLICT DO NOTHING",
          [
            f.id,
            id("user", f.user),
            job ? null : id("asset", aid),
            job ? id("job", job.id) : null,
            f.created,
          ],
        );
    }
    await sql.query(
      "SELECT setval(pg_get_serial_sequence('favorites','id'),GREATEST(COALESCE((SELECT max(id) FROM favorites),0),1),EXISTS(SELECT 1 FROM favorites))",
    );
    // Preserve financial/audit and specialist workflow records without importing live credentials.
    const archive: LegacyExport["tables"] = { ...data.tables, ...history };
    for (const [collection, records] of Object.entries(archive))
      if (
        collection !== "users" &&
        collection !== "pairs" &&
        !chatCollections.has(collection) &&
        !canvasCollections.has(collection)
      )
        for (const [index, record] of records.entries())
          await sql.query(
            "INSERT INTO legacy_records(source,collection,legacy_id,workspace_id,payload) VALUES($1,$2,$3,$4,$5)",
            [
              data.source,
              collection,
              String(record.id ?? index),
              record.workspace &&
              rows("workspaces").some((w) => w.id === record.workspace)
                ? id("workspace", record.workspace)
                : null,
              JSON.stringify(
                collection === "nodes"
                  ? publicNodes.find((n) => n.id === record.id)
                  : collection === "registration_codes"
                    ? Object.fromEntries(
                        Object.entries(record).filter(
                          ([key]) => key !== "code",
                        ),
                      )
                    : collection === "jobs"
                      ? Object.fromEntries(
                          Object.entries(record).filter(
                            ([key]) => !["ticket", "lease"].includes(key),
                          ),
                        )
                      : record,
              ),
            ],
          );
    if (rows("recharge_orders").length)
      await sql.query("SELECT restore_original_recharge_orders($1)", [
        data.source,
      ]);
    await sql.query(
      "INSERT INTO legacy_imports(source,fingerprint) VALUES($1,$2)",
      [data.source, fingerprint],
    );
  }
  await writeRecords();
  return {
    users: rows("users").length,
    workspaces: rows("workspaces").length,
    assets: rows("media").length,
    jobs: rows("jobs").length,
  };
}
