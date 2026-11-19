import test from "node:test";
import assert from "node:assert/strict";
import {
  identityContracts,
  validateIdentityRequest,
} from "../../packages/original-api/src/contracts.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { one } from "../../packages/platform/src/db.js";
import { hash } from "../../packages/platform/src/security.js";
import { databaseFixture } from "../helpers/database.js";
const password = "safe-test-password";
async function fixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p);
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const token = await identity.login({ name: "ADMIN", password }, "admin");
  return { ...f, identity, token, admin: await identity.actor(token) };
}
test("original identity uses one UUID authority with numeric transport, private workspaces and atomic registration credits", async () => {
  const f = await fixture();
  try {
    const { identity: i, p, db, admin } = f;
    const initial = await i.workspaces(admin);
    assert.deepEqual(
      initial.workspaces.map((w) => [
        w.id,
        w.name,
        w.kind,
        w.owner,
        w.revision,
        w.member_count,
      ]),
      [
        [2, "个人空间", "personal", 1, 1, 0],
        [1, "默认团队", "team", null, 1, 0],
      ],
    );
    const invitation = await i.createInvite(admin, {
      name: "测试",
      grant_credits: true,
      initial_credits: 37,
      team_id: 1,
    });
    assert.ok(invitation);
    const body = {
      name: "Member",
      nickname: "成员",
      password,
      code: " " + invitation.code.toLowerCase() + " ",
    };
    const token = await i.register(body, "member"),
      member = await i.actor(token);
    const spaces = await i.workspaces(member),
      personal = spaces.workspaces.find((w) => w.kind === "personal")!;
    assert.equal(spaces.workspace_id, 1);
    assert.equal(spaces.workspaces.length, 2);
    assert.equal(member.id.length, 36);
    assert.equal(i.profile(member).id, 2);
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT balance FROM wallets w JOIN workspaces s ON s.id=w.workspace_id WHERE s.public_id=$1",
            [personal.id],
          )
        ).balance,
      ),
      37,
    );
    await assert.rejects(i.register(body, "member"), { status: 409 });
    assert.equal((await i.invites(admin)).items[0].uses, 1);
    assert.equal(
      Number(
        (await one(db, "SELECT count(*) FROM registration_redemptions")).count,
      ),
      1,
    );
    assert.equal(
      Number(
        (await one(db, "SELECT count(*) FROM ledger WHERE action='grant'"))
          .count,
      ),
      1,
    );
    // Even a corrupt membership row must never grant access to another user's personal space.
    const adminSpace = await one(
      db,
      "SELECT id FROM workspaces WHERE kind='personal' AND owner_id=$1",
      [admin.id],
    );
    await db.query("INSERT INTO members(workspace_id,user_id) VALUES($1,$2)", [
      adminSpace.id,
      member.id,
    ]);
    await assert.rejects(p.workspace(db, member, adminSpace.id), {
      status: 404,
    });
    await assert.rejects(i.selectWorkspace(member, 2), { status: 403 });
    assert.ok(
      !(await p.workspaces(member)).some((w) => w.id === adminSpace.id),
    );
    await i.updateWorkspace(admin, 1, {
      name: "默认团队",
      members: [],
      expected_revision: 1,
    });
    assert.equal((await i.workspaces(member)).workspace_id, personal.id);
    await assert.rejects(i.selectWorkspace(member, 1), { status: 403 });
    const pair = await Promise.allSettled([
      i.updateWorkspace(admin, 1, {
        name: "A",
        members: [],
        expected_revision: 2,
      }),
      i.updateWorkspace(admin, 1, {
        name: "B",
        members: [],
        expected_revision: 2,
      }),
    ]);
    assert.equal(pair.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (pair.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      409,
    );
    await Promise.all([
      i.selectWorkspace(admin, 1),
      i.selectWorkspace(admin, 2),
    ]);
    const raw = await one(
      db,
      "SELECT code_hash,code_secret FROM invites WHERE public_id=$1",
      [invitation.id],
    );
    assert.equal(raw.code_hash, hash(invitation.code));
    assert.ok(!raw.code_secret.includes(invitation.code));
  } finally {
    await f.cleanup();
  }
});
test("original profile sessions, disabled members, invitation revisions and rate limits survive failed transactions", async () => {
  const f = await fixture();
  try {
    const { identity: i, db, admin } = f;
    const member = await i.createMember(admin, { name: "Member", password });
    const first = await i.login({ name: "member", password }, "a"),
      second = await i.login({ name: "Member", password }, "b"),
      actor = await i.actor(first);
    const profile = await i.editProfile(actor, {
      nickname: "新昵称",
      avatar: "builtin:moon",
    });
    assert.equal(profile.nickname, "新昵称");
    assert.equal(profile.avatar_url, "/avatars/moon.svg");
    await i.changePassword(actor, first, {
      current_password: password,
      password: "changed-test-password",
    });
    await assert.rejects(i.actor(second), { status: 401 });
    await i.actor(first);
    await i.resetPassword(admin, member.id, { password });
    await assert.rejects(i.actor(first), { status: 401 });
    const third = await i.login({ name: "member", password }, "c");
    await i.disable(admin, member.id);
    await i.disable(admin, member.id);
    await i.disable(admin, 1);
    await i.disable(admin, 999999);
    await assert.rejects(i.actor(third), { status: 401 });
    await assert.rejects(i.login({ name: "member", password }, "d"), {
      status: 401,
    });
    await i.actor(f.token);
    const inv = await i.createInvite(admin, {
      name: "expired later",
      expires: Math.floor(Date.now() / 1000) + 3600,
    });
    assert.ok(inv);
    await db.query(
      "UPDATE invites SET expires_at=now()-interval '1 hour' WHERE public_id=$1",
      [inv.id],
    );
    assert.equal(
      (
        await i.updateInvite(admin, inv.id, {
          expected_revision: 1,
          enabled: false,
        })
      )?.enabled,
      false,
    );
    await assert.rejects(
      i.updateInvite(admin, inv.id, { expected_revision: 2, enabled: true }),
      { status: 400, message: "邀请码已过期，请先编辑有效期" },
    );
    const updates = await Promise.allSettled([
      i.updateInvite(admin, inv.id, { expected_revision: 2, expires: null }),
      i.updateInvite(admin, inv.id, { expected_revision: 2, expires: null }),
    ]);
    assert.equal(updates.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (updates.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      409,
    );
    for (let n = 0; n < 35; n++)
      await assert.rejects(i.login({ name: "missing", password }, "limited"), {
        status: 401,
      });
    await assert.rejects(i.login({ name: "missing", password }, "limited"), {
      status: 429,
    });
  } finally {
    await f.cleanup();
  }
});

test("import preserves sparse public IDs, avatars, defaults and revisions; newly allocated IDs cannot collide", async () => {
  const f = await databaseFixture();
  try {
    const { randomBytes, scryptSync } = await import("node:crypto");
    const { importLegacy, legacyId } =
      await import("../../packages/platform/src/importer.js");
    const salt = randomBytes(16).toString("hex"),
      pw = scryptSync(password, Buffer.from(salt, "hex"), 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }).toString("hex");
    const data = {
      version: 1 as const,
      source: "sparse-identity",
      tables: {
        users: [
          {
            id: 7,
            name: "Admin",
            nickname: "管理员",
            salt,
            pw,
            role: "admin",
            active: 1,
            avatar: "builtin:moon",
            default_workspace: 3,
          },
          {
            id: 42,
            name: "Disabled",
            salt,
            pw,
            role: "member",
            active: 0,
            avatar: "builtin:forest",
            default_workspace: 85,
          },
        ],
        workspaces: [
          {
            id: 3,
            kind: "team",
            name: "已有团队",
            owner: null,
            revision: 9,
            created: 1700000000,
          },
          {
            id: 20,
            kind: "personal",
            name: "个人空间",
            owner: 7,
            revision: 1,
            created: 1700000001,
          },
          {
            id: 85,
            kind: "personal",
            name: "个人空间",
            owner: 42,
            revision: 1,
            created: 1700000002,
          },
        ],
        workspace_members: [{ workspace: 3, user: 42 }],
        credit_accounts: [{ workspace: 20, balance: 91, reserved: 0 }],
      },
    };
    await importLegacy(f.p, data, f.directory);
    await importLegacy(f.p, data, f.directory);
    assert.equal(
      Number((await one(f.db, "SELECT count(*) FROM sessions")).count),
      0,
    );
    const i = new OriginalIdentity(f.p),
      actor = await i.actor(
        await i.login({ name: "admin", password }, "import"),
      );
    assert.equal(i.profile(actor).id, 7);
    assert.equal(i.profile(actor).avatar, "builtin:moon");
    const result = await i.workspaces(actor);
    assert.equal(result.workspace_id, 3);
    assert.deepEqual(
      result.workspaces.map((w) => [
        w.id,
        w.revision,
        w.created,
        w.member_count,
      ]),
      [
        [20, 1, 1700000001, 0],
        [3, 9, 1700000000, 0],
      ],
    );
    assert.deepEqual(result.workspaces[1].members, [42]);
    assert.equal(
      Number(
        (await f.p.wallet(actor, legacyId(data.source, "workspace", 20)))
          .balance,
      ),
      91,
    );
    const created = await i.createMember(actor, {
      name: "AfterImport",
      password,
    });
    assert.equal(created.id, 43);
    const personal = await one(
      f.db,
      "SELECT w.public_id FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE u.public_id=$1 AND w.kind='personal'",
      [created.id],
    );
    assert.equal(Number(personal.public_id), 86);
    assert.equal(
      Number((await one(f.db, "SELECT count(*) FROM import_records")).count),
      5,
    );
    await assert.rejects(i.login({ name: "disabled", password }, "import"), {
      status: 401,
    });
  } finally {
    await f.cleanup();
  }
});

test("advanced and original protocols share registration, sessions and workspace revisions", async () => {
  const f = await fixture();
  try {
    const { p, identity: i, admin, db } = f;
    const invitation = await p.createInvite(admin, {
      name: "shared",
      credits: 19,
    });
    const publicInvite = (await i.invites(admin)).items.find(
      (v) => v.code === invitation.code,
    )!;
    assert.ok(publicInvite);
    const created = await p.register({
      name: "Advanced",
      nickname: "同一账户",
      password,
      code: invitation.code.toLowerCase(),
    });
    const actor = await i.actor(
      await p.login({ name: "advanced", password }, "advanced"),
    );
    assert.equal(actor.id, created.id);
    const spaces = await i.workspaces(actor);
    assert.ok(spaces.workspace_id > 0);
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT credits FROM registration_redemptions WHERE user_id=$1",
            [actor.id],
          )
        ).credits,
      ),
      19,
    );
    const otherToken = await i.register(
      { name: "Original", nickname: "原协议", password, code: invitation.code },
      "original",
    );
    assert.ok(await p.actor(otherToken));
    const team = await i.createWorkspace(admin, {
      name: "Shared team",
      members: [],
    });
    assert.ok(team);
    const internal = await one(
      db,
      "SELECT id FROM workspaces WHERE public_id=$1",
      [team.id],
    );
    await p.updateWorkspace(admin, internal.id, {
      name: "Shared update",
      members: [],
    });
    await assert.rejects(
      i.updateWorkspace(admin, team.id, {
        name: "stale",
        members: [],
        expected_revision: 1,
      }),
      { status: 409 },
    );
    await i.logout(otherToken);
    await assert.rejects(p.actor(otherToken), { status: 401 });
  } finally {
    await f.cleanup();
  }
});

test("empty and whitespace-only workspace and invite names return 400 field messages", async () => {
  const f = await fixture();
  try {
    const { identity: i, admin } = f;
    const createWorkspaceContract = identityContracts.find(
      (c) => c.method === "POST" && c.body === "createWorkspace",
    )!;
    const createInviteContract = identityContracts.find(
      (c) => c.method === "POST" && c.body === "createInvite",
    )!;
    const invite = await i.createInvite(admin, { name: "有效邀请码" });
    assert.ok(invite);
    for (const blank of ["", "   "]) {
      assert.doesNotThrow(() =>
        validateIdentityRequest(createWorkspaceContract, "/api/workspaces", {
          name: blank,
          members: [],
        }),
      );
      assert.doesNotThrow(() =>
        validateIdentityRequest(createInviteContract, "/api/invite-codes", {
          name: blank,
        }),
      );
      await assert.rejects(
        i.createWorkspace(admin, { name: blank, members: [] }),
        { status: 400, message: "请输入团队名称" },
      );
      await assert.rejects(
        i.updateWorkspace(admin, 1, {
          name: blank,
          members: [],
          expected_revision: 1,
        }),
        { status: 400, message: "请输入团队名称" },
      );
      await assert.rejects(i.createInvite(admin, { name: blank }), {
        status: 400,
        message: "请填写邀请码名称",
      });
      await assert.rejects(
        i.updateInvite(admin, invite.id, {
          name: blank,
          expected_revision: invite.revision,
        }),
        { status: 400, message: "请填写邀请码名称" },
      );
    }
  } finally {
    await f.cleanup();
  }
});
