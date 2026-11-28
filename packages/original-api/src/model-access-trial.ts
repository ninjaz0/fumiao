import { isDeepStrictEqual } from "node:util";
import type {
  ModelTrialReceipt,
  ModelTrialQuote,
} from "@fumiao/web-compat/model-access.js";
import { one } from "@fumiao/platform/db.js";
import { canonical } from "@fumiao/platform/plugins.js";
import { resolvePublishedRoute } from "@fumiao/platform/model-access/publication.js";
import { requireValue, hash } from "@fumiao/platform/security.js";
import { OriginalChats } from "./chats.js";
import { prepareNativeChat } from "./chat-billing.js";
import { parseDraft } from "./drafts.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { acceptNativeMedia, prepareNativeMedia } from "./native-media.js";
import { parseBody } from "./validation.js";

export async function modelRouteTrial(
  identity: OriginalIdentity,
  actor: OriginalActor,
  id: string,
  value: unknown,
  confirm: boolean,
): Promise<ModelTrialReceipt | ModelTrialQuote> {
  const p = identity.p;
  p.admin(actor);
  const body = parseBody(
    value,
    {
      uid: { kind: "uuid" },
      workspace: { kind: "integer", gt: 0 },
      route_revision: { kind: "uuid" },
      price_revision: { kind: "uuid" },
      prompt: { kind: "string", min: 1, max: 12000 },
      params: { kind: "dictionary", default: {} },
      refs: { kind: "strings", max: 9, default: [] },
      ...(confirm ? { quote: { kind: "dictionary" as const } } : {}),
    },
    true,
  );
  requireValue(id === body.route_revision, 409, "试用线路已改变，请重新报价");
  return p.db.transaction(async (sql) => {
    const policy = await one(
      sql,
      "SELECT price_revision FROM studio_policy FOR SHARE",
    );
    requireValue(
      await one(
        sql,
        "SELECT id FROM users WHERE id=$1 AND role='admin' AND active AND deleted_at IS NULL FOR SHARE",
        [actor.id],
      ),
      403,
      "需要管理员权限",
    );
    const workspace = await identity.activeWorkspace(
      sql,
      actor,
      body.workspace,
    );
    const fingerprint = hash(canonical(body));
    if (confirm) {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "model-trial:" + body.uid,
      ]);
      const previous = await one(
        sql,
        "SELECT * FROM model_access_trial_receipts WHERE uid=$1",
        [body.uid],
      );
      if (previous) {
        requireValue(
          previous.actor_id === actor.id &&
            previous.workspace_id === workspace.id &&
            previous.request_hash === fingerprint,
          409,
          "试用标识已用于其他请求",
        );
        return previous.result;
      }
    }
    const model = await one(
      sql,
      "SELECT catalog_id FROM model_access_route_revisions WHERE id=$1",
      [id],
    );
    requireValue(model, 404, "试用线路不存在");
    const route = await resolvePublishedRoute(sql, model.catalog_id, id);
    requireValue(
      route && route.priceRevisionId === body.price_revision,
      409,
      "线路版本或模型售价已更新，请重新报价",
    );
    const { uid, prompt, params, refs } = body;
    const common = {
      route_revision: id,
      price_revision: route.priceRevisionId,
    };
    let result: ModelTrialReceipt;
    if (route.purpose === "chat") {
      requireValue(
        !refs.length && !Object.keys(params).length,
        400,
        "对话试用只接受文字输入",
      );
      const wallet = await one(
        sql,
        "SELECT balance,held FROM wallets WHERE workspace_id=$1",
        [workspace.id],
      );
      requireValue(wallet, 404, "积分账户不存在");
      const { quote } = await prepareNativeChat(
        p,
        sql,
        actor,
        workspace.id,
        null,
        { text: prompt, retry: null },
        {},
        route,
        { balance: wallet.balance, held: wallet.held },
        policy.price_revision,
      );
      if (!confirm) return quote;
      requireValue(
        isDeepStrictEqual(body.quote, quote),
        409,
        "报价已更新，请重新确认",
      );
      const chats = new OriginalChats(p);
      const chat = await chats.create(
        actor,
        { model: route.catalogId },
        String(body.workspace),
        sql,
      );
      const cid = chat.conversation.id;
      const turn = await chats.send(
        actor,
        cid,
        {
          model: route.catalogId,
          uid,
          text: prompt,
          expected_revision: chat.conversation.revision,
          ...quote,
        },
        String(body.workspace),
        { transaction: sql, route },
      );
      result = {
        ...common,
        cid,
        turn: turn.accepted_turn,
        max_charge: quote.max_charge,
      };
    } else {
      const draft = parseDraft(
        route.purpose,
        { uid, model: route.catalogId, prompt, params, refs },
        { [route.catalogId]: { kind: route.purpose } },
      );
      const prepared = await prepareNativeMedia(
        p,
        sql,
        actor,
        workspace.id,
        route,
        draft,
      );
      const quote = {
        ...common,
        max_charge: prepared.amount,
        quote_context: hash(
          canonical([
            actor.id,
            workspace.id,
            uid,
            common,
            prompt,
            prepared,
            policy.price_revision,
          ]),
        ),
      };
      if (!confirm) return quote;
      requireValue(
        isDeepStrictEqual(body.quote, quote),
        409,
        "报价已更新，请重新确认",
      );
      // Match ordinary media admission before checking workspace queue capacity.
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "original-submit:" + actor.id,
      ]);
      await sql.query(
        "SELECT workspace_id FROM wallets WHERE workspace_id=$1 FOR UPDATE",
        [workspace.id],
      );
      const job = await acceptNativeMedia(
        p,
        sql,
        actor,
        workspace.id,
        route,
        draft,
        actor.public_id + "-trial-" + uid,
        fingerprint,
        policy.price_revision,
        [],
      );
      result = { ...common, job: job.id, max_charge: quote.max_charge };
    }
    await sql.query(
      "INSERT INTO model_access_trial_receipts(uid,actor_id,workspace_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [uid, actor.id, workspace.id, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
