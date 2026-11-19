import { randomInt, randomUUID } from "node:crypto";
import { Platform, type Actor } from "../../platform/src/platform.js";
import { one, type Sql } from "../../platform/src/db.js";
import {
  hash,
  passwordRecord,
  requireValue,
  secret,
  verifyPassword,
} from "../../platform/src/security.js";
import { parseBody } from "./validation.js";
import { discardAvatar } from "./avatar-storage.js";
import { identityBodies } from "./contracts.js";

export const avatars = [
  "alpine",
  "sunrise",
  "moon",
  "waves",
  "island",
  "forest",
  "leaf",
  "flower",
  "orange",
  "planet",
  "rainbow",
  "sail",
];
export type OriginalActor = Actor & {
  public_id: string | number;
  avatar: string;
  default_workspace: string | null;
  password: string;
  active: boolean;
  deleted_at: Date | null;
};
const publicId = (value: unknown) => {
  const n = Number(value);
  requireValue(Number.isSafeInteger(n) && n > 0, 500, "公开编号无效");
  return n;
};
const epoch = (value: unknown) =>
  Math.floor(new Date(value as string).getTime() / 1000);
const fold =
  "translate(name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')";
const control = /[\u0000-\u001f]/;
function name(value: string) {
  const result = value.trim();
  requireValue(
    /^[\p{L}\p{N}_.-]{2,32}$/u.test(result),
    400,
    "用户名需 2–32 个中英文、数字或下划线等字符",
  );
  return result;
}
function nickname(value: string) {
  const result = value.trim();
  requireValue(
    result && [...result].length <= 40 && !control.test(result),
    400,
    "昵称需 1–40 个字符",
  );
  return result;
}
export class OriginalIdentity {
  constructor(readonly p: Platform) {}
  profile(user: OriginalActor) {
    const avatar = user.avatar || "builtin:alpine";
    return {
      id: publicId(user.public_id),
      name: user.name,
      nickname: user.nickname || user.name,
      avatar,
      avatar_url: avatar.startsWith("upload:")
        ? "/avatars/uploads/" + avatar.slice(7) + ".webp"
        : "/avatars/" +
          (avatar.startsWith("builtin:") ? avatar.slice(8) : "alpine") +
          ".svg",
      role: user.role,
    };
  }
  async actor(token: string): Promise<OriginalActor> {
    requireValue(token && token.length <= 200, 401, "请先登录");
    const user = await one(
      this.p.db,
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now() AND u.active=true AND u.deleted_at IS NULL",
      [hash(token)],
    );
    requireValue(user, 401, "请先登录");
    return user as OriginalActor;
  }
  private async current(sql: Sql, user: Actor, admin = false) {
    const row = await one(
      sql,
      "SELECT * FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL FOR SHARE",
      [user.id],
    );
    requireValue(row, 401, "请先登录");
    if (admin) this.p.admin(row as Actor);
    return row as OriginalActor;
  }
  private async limit(peer: string, registration = false) {
    const key = hash(
      (registration ? "original-register:" : "original-login:") + peer,
    );
    const row = await one(
      this.p.db,
      `INSERT INTO login_attempts(key,attempts,expires_at) VALUES($1,1,now()+interval '600 seconds')
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.expires_at<=now() THEN 1 ELSE login_attempts.attempts+1 END,
      expires_at=CASE WHEN login_attempts.expires_at<=now() THEN now()+interval '600 seconds' ELSE login_attempts.expires_at END RETURNING attempts`,
      [key],
    );
    requireValue(
      row.attempts <= 35,
      429,
      registration
        ? "尝试过于频繁，请 10 分钟后重试"
        : "尝试过于频繁，请稍后再试",
    );
    return key;
  }
  private async signIn(sql: Sql, uid: string) {
    const token = secret();
    await sql.query("DELETE FROM sessions WHERE expires_at<now()");
    await sql.query(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [hash(token), uid],
    );
    return token;
  }
  private async newUser(
    sql: Sql,
    username: string,
    display: string,
    password: string,
    role = "member",
  ) {
    const user = await this.p.createUser(
      sql,
      username,
      display,
      password,
      role,
    );
    await sql.query("UPDATE workspaces SET name='个人空间' WHERE id=$1", [
      user.workspaceId,
    ]);
    await sql.query(
      "UPDATE users SET default_workspace=$2,avatar=$3 WHERE id=$1",
      [
        user.id,
        user.workspaceId,
        "builtin:" + avatars[randomInt(avatars.length)],
      ],
    );
    return user;
  }
  async bootstrap(value: unknown) {
    const input = parseBody(value, identityBodies.register);
    requireValue([...input.password].length >= 10, 400, "密码需 10–200 个字符");
    return this.p.db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(2489732)");
      requireValue(
        !(await one(sql, "SELECT id FROM users LIMIT 1")),
        409,
        "管理员已初始化",
      );
      const reserved = await one(
        sql,
        "SELECT nextval(pg_get_serial_sequence('workspaces','public_id')) AS id",
      );
      const user = await this.newUser(
        sql,
        name(input.name),
        nickname(input.nickname),
        input.password,
        "admin",
      );
      const team = randomUUID();
      await sql.query(
        "INSERT INTO workspaces(id,public_id,name,owner_id,kind) VALUES($1,$2,'默认团队',$3,'team')",
        [team, reserved.id, user.id],
      );
      await sql.query("INSERT INTO wallets(workspace_id) VALUES($1)", [team]);
      // Older-schema migration fixtures and rolling bootstrap remain supported.
      if (
        (await one(sql, "SELECT to_regclass('original_state_settings') AS id"))
          ?.id
      )
        await sql.query(
          "UPDATE original_state_settings SET legacy_workspace_id=$1",
          [team],
        );
      return this.profile(
        (await one(sql, "SELECT * FROM users WHERE id=$1", [
          user.id,
        ])) as OriginalActor,
      );
    });
  }
  async login(value: unknown, peer: string) {
    const input = parseBody(value, identityBodies.login),
      key = await this.limit(peer);
    const user = await one(
      this.p.db,
      `SELECT * FROM users WHERE ${fold}=translate($1,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') AND active=true AND deleted_at IS NULL`,
      [input.name.trim()],
    );
    requireValue(
      user && (await verifyPassword(input.password, user.password)),
      401,
      "用户名或密码有误",
    );
    const upgraded = user.password.startsWith("legacy-scrypt:")
      ? await passwordRecord(input.password)
      : user.password;
    return this.p.db.transaction(async (sql) => {
      const current = await one(
        sql,
        "SELECT * FROM users WHERE id=$1 FOR UPDATE",
        [user.id],
      );
      requireValue(
        current?.active &&
          !current.deleted_at &&
          current.password === user.password,
        401,
        "用户名或密码有误",
      );
      if (upgraded !== user.password)
        await sql.query("UPDATE users SET password=$2 WHERE id=$1", [
          user.id,
          upgraded,
        ]);
      await sql.query("DELETE FROM login_attempts WHERE key=$1", [key]);
      return this.signIn(sql, user.id);
    });
  }
  async logout(token: string) {
    await this.p.logout(token);
    return { ok: true };
  }
  async register(value: unknown, peer: string) {
    const input = parseBody(value, identityBodies.register);
    await this.limit(peer, true);
    const display = input.nickname.trim();
    requireValue(display && !control.test(display), 400, "请填写昵称");
    const username = input.name.trim();
    requireValue(
      [...input.password].length >= 10 &&
        /^[\p{L}\p{N}_.-]{2,32}$/u.test(username),
      400,
      "用户名需 2–32 个中英文、数字或下划线等字符；密码至少 10 位",
    );
    return this.p.db.transaction(async (sql) => {
      const invitation = await one(
        sql,
        "SELECT * FROM invites WHERE code_hash=ANY($1::text[]) AND enabled=true AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE",
        [[hash(input.code.trim().toUpperCase()), hash(input.code.trim())]],
      );
      requireValue(
        invitation,
        403,
        "邀请码无效、已过期或已停用，请向管理员获取有效邀请码",
      );
      if (invitation.role === "admin") {
        await sql.query("SELECT pg_advisory_xact_lock(2489732)");
        requireValue(
          !invitation.uses &&
            !(await one(
              sql,
              "SELECT id FROM users WHERE role='admin' LIMIT 1",
            )),
          403,
          "管理员初始化邀请码已失效",
        );
      }
      if (invitation.workspace_id)
        await this.team(sql, invitation.workspace_id);
      requireValue(
        !(await one(
          sql,
          `SELECT id FROM users WHERE ${fold}=translate($1,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')`,
          [username],
        )),
        409,
        "用户名已被使用",
      );
      const user = await this.newUser(
        sql,
        username,
        display,
        input.password,
        invitation.role,
      );
      if (invitation.workspace_id) {
        await sql.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [invitation.workspace_id, user.id],
        );
        await sql.query("UPDATE users SET default_workspace=$2 WHERE id=$1", [
          user.id,
          invitation.workspace_id,
        ]);
      }
      const amount = invitation.grant_credits ? Number(invitation.credits) : 0;
      if (amount)
        await this.p.credit(
          sql,
          user.workspaceId,
          amount,
          "registration:" + user.id,
          "grant",
          {
            actorId: invitation.created_by,
            note: "注册赠送 · " + invitation.name,
            uid:
              "registration:" +
              publicId(
                (
                  await one(sql, "SELECT public_id FROM users WHERE id=$1", [
                    user.id,
                  ])
                ).public_id,
              ),
          },
        );
      await sql.query(
        "INSERT INTO registration_redemptions(user_id,invitation_id,credits,workspace_id) VALUES($1,$2,$3,$4)",
        [user.id, invitation.id, amount, invitation.workspace_id],
      );
      await sql.query(
        "UPDATE invites SET uses=uses+1,enabled=CASE WHEN role='admin' THEN false ELSE enabled END WHERE id=$1",
        [invitation.id],
      );
      return this.signIn(sql, user.id);
    });
  }
  async requireWorkspace(
    sql: Sql,
    user: Actor,
    id: number | bigint,
    lock = false,
  ) {
    const row = await one(
      sql,
      `SELECT * FROM workspaces w WHERE public_id=$1 AND
      ((kind='personal' AND owner_id=$2) OR (kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))${lock ? " FOR UPDATE" : ""}`,
      [id, user.id, user.role],
    );
    requireValue(row, 403, "无法访问这个工作区");
    return row;
  }
  async activeWorkspace(sql: Sql, user: Actor, explicit?: string | number) {
    if (explicit !== undefined) {
      const id =
        typeof explicit === "string" && /^\s*[+-]?\d+\s*$/.test(explicit)
          ? Number(explicit)
          : explicit;
      requireValue(
        typeof id === "number" && Number.isSafeInteger(id),
        400,
        "工作区标识无效",
      );
      return this.requireWorkspace(sql, user, id);
    }
    const row = await one(
      sql,
      `SELECT w.* FROM workspaces w JOIN users u ON u.id=$1 WHERE w.id=u.default_workspace AND
      ((w.kind='personal' AND w.owner_id=u.id) OR (w.kind='team' AND (u.role='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=u.id))))`,
      [user.id],
    );
    return (
      row ||
      (await one(
        sql,
        "SELECT * FROM workspaces WHERE kind='personal' AND owner_id=$1",
        [user.id],
      ))
    );
  }
  async spaces(sql: Sql, user: Actor) {
    const rows = (
      await sql.query(
        `SELECT w.*,owner.public_id AS public_owner,
      (SELECT count(*) FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=w.id AND u.active=true AND u.deleted_at IS NULL) AS member_count
      FROM workspaces w JOIN users owner ON owner.id=w.owner_id WHERE (w.kind='personal' AND w.owner_id=$1) OR
      (w.kind='team' AND ($2='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$1))) ORDER BY CASE w.kind WHEN 'personal' THEN 0 ELSE 1 END,w.public_id`,
        [user.id, user.role],
      )
    ).rows;
    return Promise.all(
      rows.map(async (w) => ({
        id: publicId(w.public_id),
        kind: w.kind,
        name: w.name,
        owner: w.kind === "personal" ? publicId(w.public_owner) : null,
        created: epoch(w.created_at),
        revision: w.revision,
        member_count: Number(w.member_count),
        ...(user.role === "admin" && w.kind === "team"
          ? {
              members: (
                await sql.query(
                  "SELECT u.public_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.public_id",
                  [w.id],
                )
              ).rows.map((u) => publicId(u.public_id)),
            }
          : {}),
      })),
    );
  }
  async workspaces(user: Actor) {
    return this.p.db.transaction(async (sql) => ({
      workspaces: await this.spaces(sql, user),
      workspace_id: publicId((await this.activeWorkspace(sql, user)).public_id),
    }));
  }
  private async team(sql: Sql, id: string) {
    const team = await one(
      sql,
      "SELECT id FROM workspaces WHERE id=$1 AND kind='team' FOR SHARE",
      [id],
    );
    requireValue(team, 400, "团队已不存在，请重新选择");
    return team;
  }
  private async teamInput(sql: Sql, input: Record<string, any>) {
    const name = input.name.trim();
    requireValue(name, 400, "请输入团队名称");
    const ids = [...new Set<number>(input.members)].sort((a, b) => a - b);
    const members = ids.length
      ? (
          await sql.query(
            "SELECT id,public_id FROM users WHERE public_id=ANY($1::bigint[]) AND active=true AND deleted_at IS NULL ORDER BY public_id FOR SHARE",
            [ids],
          )
        ).rows
      : [];
    requireValue(
      members.length === ids.length,
      400,
      "部分成员已停用或删除，请刷新后重试",
    );
    return { name, members };
  }
  async createWorkspace(user: Actor, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.createWorkspace);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const { name, members } = await this.teamInput(sql, input),
        id = randomUUID();
      await sql.query(
        "INSERT INTO workspaces(id,name,owner_id,kind) VALUES($1,$2,$3,'team')",
        [id, name, user.id],
      );
      await sql.query("INSERT INTO wallets(workspace_id) VALUES($1)", [id]);
      for (const member of members)
        await sql.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [id, member.id],
        );
      await this.p.audit(sql, user, "workspace.create", id);
      const row = await one(
        sql,
        "SELECT public_id FROM workspaces WHERE id=$1",
        [id],
      );
      return (await this.spaces(sql, user)).find(
        (w) => w.id === publicId(row.public_id),
      );
    });
  }
  async updateWorkspace(user: Actor, id: number, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.updateWorkspace);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const row = await this.requireWorkspace(sql, user, id, true);
      requireValue(row.kind === "team", 400, "个人空间不能分配成员");
      requireValue(
        row.revision === input.expected_revision,
        409,
        "团队信息已更新，请重新打开后修改",
      );
      const { name, members } = await this.teamInput(sql, input);
      await sql.query(
        "UPDATE workspaces SET name=$2,revision=revision+1 WHERE id=$1",
        [row.id, name],
      );
      await sql.query("DELETE FROM members WHERE workspace_id=$1", [row.id]);
      for (const member of members)
        await sql.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [row.id, member.id],
        );
      await this.p.audit(sql, user, "workspace.update", row.id);
      return (await this.spaces(sql, user)).find((w) => w.id === id);
    });
  }
  async selectWorkspace(user: Actor, id: number) {
    return this.p.db.transaction(async (sql) => {
      // Serialize selections for this user without a workspace/user lock inversion.
      // A subsequent membership revocation is handled by activeWorkspace's fallback.
      const current = await one(
        sql,
        "SELECT * FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL FOR UPDATE",
        [user.id],
      );
      requireValue(current, 401, "请先登录");
      const row = await this.requireWorkspace(sql, current as Actor, id);
      await sql.query("UPDATE users SET default_workspace=$2 WHERE id=$1", [
        user.id,
        row.id,
      ]);
      return { workspace_id: id };
    });
  }
  private publicInvite(row: Record<string, any>) {
    return {
      id: publicId(row.public_id),
      code: this.p.vault.open(row.code_secret).code,
      name: row.name,
      expires: row.expires_at ? epoch(row.expires_at) : null,
      enabled: row.enabled,
      grant_credits: row.grant_credits,
      initial_credits: Number(row.credits),
      team_id: row.team_public_id ? publicId(row.team_public_id) : null,
      uses: row.uses,
      created: epoch(row.created_at),
      revision: row.revision,
    };
  }
  async invites(user: Actor, sql: Sql = this.p.db) {
    this.p.admin(user);
    const rows = (
      await sql.query(
        "SELECT i.*,w.public_id AS team_public_id FROM invites i LEFT JOIN workspaces w ON w.id=i.workspace_id WHERE i.code_secret IS NOT NULL AND i.role='member' ORDER BY i.public_id DESC",
      )
    ).rows;
    return { items: rows.map((row) => this.publicInvite(row)) };
  }
  private async inviteOptions(sql: Sql, input: Record<string, any>) {
    const name = input.name.trim();
    requireValue(name && !control.test(name), 400, "请填写邀请码名称");
    requireValue(
      input.expires === null || input.expires > Math.floor(Date.now() / 1000),
      400,
      "到期时间需要晚于当前时间",
    );
    requireValue(
      !input.grant_credits || input.initial_credits >= 1,
      400,
      "赠送积分需为正整数",
    );
    const team =
      input.team_id === null
        ? null
        : await one(
            sql,
            "SELECT id FROM workspaces WHERE public_id=$1 AND kind='team' FOR SHARE",
            [input.team_id],
          );
    requireValue(
      input.team_id === null || team,
      400,
      "团队已不存在，请重新选择",
    );
    return {
      name,
      expires: input.expires === null ? null : new Date(input.expires * 1000),
      credits: input.grant_credits ? input.initial_credits : 0,
      team: team?.id || null,
    };
  }
  async createInvite(user: Actor, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.createInvite, true);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const opt = await this.inviteOptions(sql, input),
        id = randomUUID();
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const code = Array.from({ length: 3 }, () =>
        Array.from(
          { length: 4 },
          () => alphabet[randomInt(alphabet.length)],
        ).join(""),
      ).join("-");
      await sql.query(
        "INSERT INTO invites(id,code_hash,name,workspace_id,credits,expires_at,code_secret,created_by,grant_credits) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          hash(code),
          opt.name,
          opt.team,
          opt.credits,
          opt.expires,
          this.p.vault.seal({ code }),
          user.id,
          input.grant_credits,
        ],
      );
      const row = await one(sql, "SELECT public_id FROM invites WHERE id=$1", [
        id,
      ]);
      return (await this.invites(user, sql)).items.find(
        (i) => i.id === publicId(row.public_id),
      );
    });
  }
  async updateInvite(user: Actor, id: number, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.updateInvite, true);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const row = await one(
        sql,
        "SELECT i.*,w.public_id AS team_public_id FROM invites i LEFT JOIN workspaces w ON w.id=i.workspace_id WHERE i.public_id=$1 AND i.code_secret IS NOT NULL AND i.role='member' FOR UPDATE OF i",
        [id],
      );
      requireValue(row, 404, "邀请码不存在");
      requireValue(
        row.revision === input.expected_revision,
        409,
        "邀请码已被修改，请关闭后重新打开",
      );
      for (const key of ["name", "grant_credits", "initial_credits", "enabled"])
        requireValue(input[key] !== null, 400, "设置值不能为空");
      const previous = this.publicInvite(row),
        merged = { ...previous, ...input };
      const policyChanged = Object.keys(input).some(
        (k) => k !== "enabled" && k !== "expected_revision",
      );
      if (!policyChanged && input.enabled)
        requireValue(
          previous.expires === null ||
            previous.expires > Math.floor(Date.now() / 1000),
          400,
          "邀请码已过期，请先编辑有效期",
        );
      const opt = policyChanged
        ? await this.inviteOptions(sql, merged)
        : {
            name: row.name,
            expires: row.expires_at,
            credits: Number(row.credits),
            team: row.workspace_id,
          };
      await sql.query(
        "UPDATE invites SET name=$2,expires_at=$3,grant_credits=$4,credits=$5,workspace_id=$6,enabled=$7,revision=revision+1 WHERE id=$1",
        [
          row.id,
          opt.name,
          opt.expires,
          merged.grant_credits,
          opt.credits,
          opt.team,
          merged.enabled,
        ],
      );
      return (await this.invites(user, sql)).items.find((i) => i.id === id);
    });
  }
  async createMember(user: Actor, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.createMember);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const username = name(input.name);
      const created = await this.newUser(
        sql,
        username,
        nickname(input.nickname || username),
        input.password,
      );
      return this.profile(
        (await one(sql, "SELECT * FROM users WHERE id=$1", [
          created.id,
        ])) as OriginalActor,
      );
    });
  }
  async editProfile(user: Actor, value: unknown) {
    const input = parseBody(value, identityBodies.editProfile);
    let oldAvatar = "";
    const result = await this.p.db.transaction(async (sql) => {
      const row = await one(
        sql,
        "SELECT * FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL FOR UPDATE",
        [user.id],
      );
      requireValue(row, 401, "请重新登录");
      const display =
        input.nickname === null ? row.nickname : nickname(input.nickname);
      const avatar = input.avatar === null ? row.avatar : input.avatar;
      oldAvatar = row.avatar;
      requireValue(
        avatar === row.avatar || avatars.some((a) => "builtin:" + a === avatar),
        400,
        "请选择头像库中的头像",
      );
      await sql.query("UPDATE users SET nickname=$2,avatar=$3 WHERE id=$1", [
        row.id,
        display,
        avatar,
      ]);
      return this.profile({
        ...row,
        nickname: display,
        avatar,
      } as OriginalActor);
    });
    if (oldAvatar !== result.avatar) await discardAvatar(this.p, oldAvatar);
    return result;
  }
  async changePassword(user: OriginalActor, token: string, value: unknown) {
    const input = parseBody(value, identityBodies.changePassword);
    requireValue(
      await verifyPassword(input.current_password, user.password),
      400,
      "当前密码不正确",
    );
    const record = await passwordRecord(input.password);
    return this.p.db.transaction(async (sql) => {
      const row = await one(sql, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        user.id,
      ]);
      requireValue(
        row?.active && !row.deleted_at && row.password === user.password,
        409,
        "账户信息已变化，请重新登录",
      );
      await sql.query("UPDATE users SET password=$2 WHERE id=$1", [
        user.id,
        record,
      ]);
      await sql.query("DELETE FROM sessions WHERE user_id=$1 AND token!=$2", [
        user.id,
        hash(token),
      ]);
      return { ok: true };
    });
  }
  async resetPassword(user: Actor, id: number, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.resetPassword),
      record = await passwordRecord(input.password);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const row = await one(
        sql,
        "SELECT * FROM users WHERE public_id=$1 AND deleted_at IS NULL FOR UPDATE",
        [id],
      );
      requireValue(row, 404, "成员不存在");
      requireValue(row.role === "member", 403, "管理员账户请在个人资料中修改");
      await sql.query("UPDATE users SET password=$2 WHERE id=$1", [
        row.id,
        record,
      ]);
      await sql.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
      return { ok: true };
    });
  }
  async deleteMember(user: Actor, id: number) {
    this.p.admin(user);
    const oldAvatar = await this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      const member = await one(
        sql,
        "SELECT id,avatar FROM users WHERE public_id=$1 AND role='member' AND deleted_at IS NULL FOR NO KEY UPDATE",
        [id],
      );
      if (!member) {
        const row = await one(
          sql,
          "SELECT role FROM users WHERE public_id=$1 AND deleted_at IS NULL",
          [id],
        );
        requireValue(row, 404, "成员不存在");
        requireValue(false, 403, "管理员账户请在个人资料中修改");
      }
      if(await one(sql,"SELECT id FROM gpu_nodes WHERE owner_id=$1 AND enabled AND NOT archived",[member.id])){
        const {NodeManagement}=await this.p.registry.nodeExtension(sql);
        await new NodeManagement(this.p).removeOwned(sql, member.id);
      }
      await sql.query("UPDATE gpu_pairings SET expires_at=to_timestamp(0) WHERE owner_id=$1",[member.id]);
      await sql.query("DELETE FROM sessions WHERE user_id=$1", [member.id]);
      await sql.query(
        `UPDATE users SET active=false,deleted_at=now(),name=$2,nickname='已删除成员',avatar=$3,password=$4 WHERE id=$1`,
        [
          member.id,
          `deleted-${id}-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
          "builtin:" + avatars[randomInt(avatars.length)],
          hash(secret()),
        ],
      );
      return String(member.avatar);
    });
    await discardAvatar(this.p, oldAvatar);
    return { ok: true };
  }
  async disable(user: Actor, id: number) {
    this.p.admin(user);
    return this.p.db.transaction(async (sql) => {
      await this.current(sql, user, true);
      await sql.query(
        "UPDATE users SET active=false WHERE public_id=$1 AND role='member'",
        [id],
      );
      await sql.query(
        "DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE public_id=$1 AND active=false)",
        [id],
      );
      return { ok: true };
    });
  }
}
