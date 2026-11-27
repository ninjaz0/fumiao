import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalCredits } from "@fumiao/original-api/credits.js";
import { one } from "@fumiao/platform/db.js";
import { acceptTask } from "@fumiao/platform/accept.js";
import {
  creditUnits,
  formatCredits,
  tokenCost,
} from "@fumiao/platform/credit-amount.js";
import { OriginalBillingExtras } from "@fumiao/original-api/billing-extras.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { checkAndRecordBudget, computeScopeSpend } from "@fumiao/platform/budgets.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";
import { databaseFixture } from "../helpers/database.js";
const password = "safe-test-password";
async function fixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p);
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const admin = await identity.actor(
    await identity.login({ name: "admin", password }, "credits"),
  );
  return { ...f, identity, admin, credits: new OriginalCredits(f.p, identity) };
}
test("credit retries are global, atomic and preserve the original balance snapshots", async () => {
  const f = await fixture();
  try {
    const { credits: c, admin, db } = f,
      body = { workspace: 2, amount: 100, note: " 原因 ", uid: randomUUID() };
    const duplicates = await Promise.all(
      Array.from({ length: 12 }, () => c.adjust(admin, body)),
    );
    assert.ok(duplicates.every((w) => w.balance === 100));
    let history = (await c.list(admin)).history;
    assert.equal(history.length, 1);
    assert.equal(history[0].note, "原因");
    assert.equal(history[0].actor, 1);
    assert.equal(history[0].balance, 100);
    assert.equal(history[0].uid, body.uid);
    await assert.rejects(c.adjust(admin, { ...body, note: "改变原因" }), {
      status: 409,
      message: "该操作编号已使用",
    });
    const reused = { ...body, uid: randomUUID() },
      competing = await Promise.allSettled([
        c.adjust(admin, reused),
        c.adjust(admin, { ...reused, workspace: 1 }),
      ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (competing.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      409,
    );
    const personal = await one(
      db,
      "SELECT id FROM workspaces WHERE public_id=2",
    );
    const current = await c.wallet(db, 2);
    await db.query("UPDATE wallets SET held=$2 WHERE workspace_id=$1", [
      personal.id,
      current.balance - 10,
    ]);
    const deductions = await Promise.allSettled([
      c.adjust(admin, { ...body, uid: randomUUID(), amount: -10 }),
      c.adjust(admin, { ...body, uid: randomUUID(), amount: -10 }),
    ]);
    assert.equal(deductions.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (deductions.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      409,
    );
    const wallet = await c.wallet(db, 2);
    assert.equal(wallet.available, 0);
    history = (await c.list(admin)).history;
    assert.equal(history[0].reserved, wallet.reserved);
    assert.equal(history[0].balance, wallet.balance);
    assert.equal(history.at(-1)!.balance, 100);
    await assert.rejects(
      c.adjust(admin, { ...body, uid: randomUUID(), workspace: 99999 }),
      { status: 404, message: "积分账户不存在" },
    );
  } finally {
    await f.cleanup();
  }
});
test("credit reads preserve privacy, pagination, account labels and missing snapshot detection", async () => {
  const f = await fixture();
  try {
    const { credits: c, identity: i, admin, db } = f;
    const invite = await i.createInvite(admin, {
      name: "注册来源",
      grant_credits: true,
      initial_credits: 37,
    });
    assert.ok(invite);
    const member = await i.actor(
      await i.register(
        { name: "Member", nickname: "成员", password, code: invite.code },
        "member",
      ),
    );
    const personal = (await i.workspaces(member)).workspace_id;
    const ledger = (await c.list(member)).history;
    assert.equal(ledger[0].note, "注册赠送 · 注册来源");
    assert.equal(ledger[0].actor, 1);
    assert.equal(ledger[0].uid, "registration:2");
    await i.updateInvite(admin, invite.id, {
      expected_revision: 1,
      name: "新名称",
    });
    assert.equal((await c.list(member)).history[0].note, "注册赠送 · 注册来源");
    await assert.rejects(c.list(member, "2"), { status: 403 });
    await assert.rejects(c.accounts(member), { status: 403 });
    for (let n = 0; n < 52; n++)
      await c.adjust(admin, {
        workspace: personal,
        amount: 1,
        note: "分页" + n,
        uid: randomUUID(),
      });
    const page = (await c.list(member)).history;
    assert.equal(page.length, 50);
    const more = (await c.list(member, undefined, page.at(-1)!.id)).history;
    assert.equal(more.length, 3);
    assert.equal(new Set([...page, ...more].map((r) => r.id)).size, 53);
    await i.editProfile(member, { nickname: "更新昵称" });
    let accounts = (await c.accounts(admin)).accounts;
    assert.equal(
      accounts.find((a) => a.workspace === personal)?.name,
      "更新昵称",
    );
    assert.equal(accounts.find((a) => a.workspace === 1)?.username, null);
    await db.query(
      "UPDATE users SET deleted_at=now(),active=false WHERE id=$1",
      [member.id],
    );
    accounts = (await c.accounts(admin)).accounts;
    assert.ok(!accounts.some((a) => a.workspace === personal));
    await db.query(
      "UPDATE ledger SET balance_snapshot=NULL WHERE public_id=$1",
      [ledger[0].id],
    );
    await assert.rejects(c.history(db, personal, ledger[0].id + 1), {
      status: 503,
      message: "积分历史尚未完成迁移",
    });
  } finally {
    await f.cleanup();
  }
});

test(
  "wallet and history are a consistent snapshot during concurrent credit writes",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await fixture();
    try {
      const { credits: c, admin } = f;
      await c.adjust(admin, {
        workspace: 2,
        amount: 100,
        note: "before",
        uid: randomUUID(),
      });
      const originalWallet = c.wallet.bind(c);
      let inject = true;
      c.wallet = async (sql, id) => {
        const value = await originalWallet(sql, id);
        if (inject) {
          inject = false;
          await c.adjust(admin, {
            workspace: 2,
            amount: 10,
            note: "concurrent",
            uid: randomUUID(),
          });
        }
        return value;
      };
      const snapshot = await c.list(admin);
      assert.equal(snapshot.wallet.balance, 100);
      assert.equal(snapshot.history[0].balance, 100);
      assert.equal(snapshot.history.length, 1);
      const after = await c.list(admin);
      assert.equal(after.wallet.balance, 110);
      assert.equal(after.history[0].balance, 110);
    } finally {
      await f.cleanup();
    }
  },
);

test("pre-snapshot Advanced retries retain their receipt without inventing financial history", async () => {
  const f = await fixture();
  try {
    const { p, db, admin, credits: c } = f;
    const space = await one(db, "SELECT id FROM workspaces WHERE public_id=2"),
      key = randomUUID();
    await p.adjustCredits(admin, space.id, { amount: 10, key });
    await db.query(
      "UPDATE ledger SET balance_snapshot=NULL,held_snapshot=NULL,actor_id=NULL,original_uid=NULL,note=''",
    );
    await p.adjustCredits(admin, space.id, { amount: 10, key });
    assert.equal((await c.wallet(db, 2)).balance, 10);
    assert.equal(
      Number((await one(db, "SELECT count(*) FROM ledger")).count),
      1,
    );
    await assert.rejects(
      p.adjustCredits(admin, space.id, { amount: 11, key }),
      { status: 409 },
    );
    await assert.rejects(c.list(admin), { status: 503 });
  } finally {
    await f.cleanup();
  }
});

test("minimum token price survives a recharge, a refund and statement export", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const { db, p, admin, workspace } = f;
  const credits = new OriginalCredits(p);
  const wallet = () => credits.wallet(db, Number(workspace.public_id));
  await db.query(
    "UPDATE wallets SET balance=100000000000 WHERE workspace_id=$1",
    [workspace.id],
  );
  const tiny = formatCredits(tokenCost(1n, "0.000001"));
  const firstJob = await f.runs.generate(
    admin,
    await f.project(),
    "v",
    f.body(),
  );
  const accepted = await one(
    db,
    "SELECT id, model_id FROM jobs WHERE public_id=$1",
    [firstJob.id],
  );
  await p.cancel(admin, accepted.id);
  const model = await one(
    db,
    `SELECT m.*, c.plugin_id, c.plugin_version, c.config
    FROM models m JOIN connections c ON c.id=m.connection_id WHERE m.id=$1`,
    [accepted.model_id],
  );
  const reserve = () =>
    db.transaction((sql) =>
      acceptTask(
        p,
        sql,
        admin,
        workspace.id,
        model,
        { key: randomUUID(), prompt: "测试", references: [], params: {} },
        randomUUID(),
        { amount: tiny, key: null, revision: null },
      ),
    );
  const settle = (id: string, state: "completed" | "failed") =>
    db.transaction(async (sql) => {
      const job = await one(sql, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      await p.settle(sql, job, state, undefined, undefined, undefined, {
        preserveTiming: true,
      });
    });

  await settle((await reserve()).id, "completed");
  await db.transaction((sql) =>
    p.credit(sql, workspace.id, 1, "payment", "recharge"),
  );
  const afterRecharge = await wallet();
  assert.equal(afterRecharge.exact.balance, "100000000000.999999999999");
  assert.equal(typeof afterRecharge.balance, "number");
  const retry = await reserve();
  assert.equal((await wallet()).exact.available, "100000000000.999999999998");
  await settle(retry.id, "failed");
  assert.deepEqual((await wallet()).exact, afterRecharge.exact);
  const history = await credits.history(db, Number(workspace.public_id));
  assert.equal(history[0].action, "refund");
  assert.equal(history[0].exact.amount, tiny);
  assert.equal(
    history.find((row) => row.action === "spend")?.exact.amount,
    tiny,
  );
  const billing = new OriginalBillingExtras(p);
  assert.ok(
    (await billing.exportStatement(admin, "csv")).bytes
      .toString()
      .includes("100000000000.999999999999"),
  );
  const pdf = (await billing.exportStatement(admin, "pdf")).bytes.toString(
    "ascii",
  );
  assert.ok(
    pdf.includes(
      Buffer.from("100000000000.999999999999", "utf16le")
        .swap16()
        .toString("hex")
        .toUpperCase(),
    ),
  );
});

test("token price is exact to one trillionth of a credit and rejects excess scale", () => {
  assert.equal(tokenCost(1n, "0.000001"), 1n);
  assert.equal(
    formatCredits(creditUnits("100000000000") - 1n),
    "99999999999.999999999999",
  );
  assert.equal(
    formatCredits(creditUnits("-0.000000000001")),
    "-0.000000000001",
  );
  assert.throws(() => tokenCost(1n, "-1"));
  assert.throws(() => tokenCost(1n, "0.0000001"));
  assert.throws(() => creditUnits("0.0000000000001"));
});

test("a budget cap rejects a one-trillionth overage on a large committed spend", async (t) => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const ws = await one(f.db, "SELECT id FROM workspaces WHERE public_id=2");
  await f.db.query(
    `INSERT INTO budget_policies(scope_type,scope_id,period,warn_limit,cap_limit,mode)
    VALUES('workspace',$1,'total',0,100000000000,'cap')`,
    [ws.id],
  );
  await f.db.query(
    `INSERT INTO ledger(id,workspace_id,key,action,amount)
    VALUES(gen_random_uuid(),$1,'past-spend','spend',100000000000)`,
    [ws.id],
  );
  await assert.rejects(
    checkAndRecordBudget(f.db, {
      workspaceId: ws.id,
      amount: "0.000000000001",
    }),
    /100000000000\.000000000001 \/ 上限/,
  );
});

test("studio budget limits round-trip decimal inputs alongside legacy integer fields", async (t) => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const budgets = new OriginalBudgets(f.p);
  const body = {
    period: "total",
    mode: "cap",
    warn_limit: 0,
    cap_limit: "1.000000000001",
  };
  await budgets.upsertPolicy(f.admin, body);
  const policy = (await budgets.list(f.admin)).policies[0];
  assert.equal(policy.exact.cap_limit, "1.000000000001");
  assert.equal(typeof policy.cap_limit, "number");
  await assert.rejects(
    budgets.upsertPolicy(f.admin, { ...body, warn_limit: "1.000000000002" }),
    { status: 400 },
  );
  await assert.rejects(
    budgets.upsertPolicy(f.admin, { ...body, cap_limit: "1.0000000000001" }),
    { status: 422 },
  );
});


test("historical signed spend and current spend count toward both project and workspace budgets", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const project = await f.project();
  const accepted = await f.runs.generate(f.admin, project, "v", f.body());
  await f.db.query(`INSERT INTO ledger(id,workspace_id,job_id,key,action,amount,balance_snapshot,held_snapshot)
    SELECT gen_random_uuid(),workspace_id,id,'import-ledger:signed','spend',-5,995,0
      FROM jobs WHERE public_id=$1`, [accepted.id]);
  await f.db.query(`INSERT INTO ledger(id,workspace_id,job_id,key,action,amount,balance_snapshot,held_snapshot)
    SELECT gen_random_uuid(),workspace_id,id,'current-debit','spend',0.25,994.75,0
      FROM jobs WHERE public_id=$1`, [accepted.id]);

  for (const [type, id] of [["workspace", f.workspace.id], ["project", project]] as const) {
    assert.equal((await computeScopeSpend(f.db, type, String(id), "total")).exact.spent, "5.25");
  }
  const history = await new OriginalCredits(f.p).history(f.db, Number(f.workspace.public_id));
  assert.ok(history.some((row) => row.action === "spend" && row.exact.amount === "-5"));
});
