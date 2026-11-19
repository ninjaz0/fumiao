import timing
"""Account profiles and team membership operations."""

import hmac
import re
import secrets
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from image_imports import import_avatar, ImageImportError
from pydantic import BaseModel, Field

from avatars import AVATARS, avatar_url, random_avatar
from core import DATA, ROOT, actor, admin, db, fail, hashed, now, password, receive

router = APIRouter()
BUILTINS = {"builtin:" + key for key, _ in AVATARS}
UPLOADS = DATA / "avatars"
UPLOADS.mkdir(exist_ok=True, mode=0o700)


def public_profile(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "nickname": row["nickname"] or row["name"],
        "avatar": row["avatar"],
        "avatar_url": avatar_url(row["avatar"]),
        "role": row["role"],
    }


def check_name(name):
    name = name.strip()
    if not re.fullmatch(r"[\w.\-\u4e00-\u9fff]{2,32}", name):
        fail(400, "用户名需 2–32 个中英文、数字或下划线等字符")
    return name


def check_nickname(value):
    value = value.strip()
    if not value or len(value) > 40 or any(ord(char) < 32 for char in value):
        fail(400, "昵称需 1–40 个字符")
    return value


def new_password(value):
    if not 10 <= len(value) <= 200:
        fail(400, "密码需 10–200 个字符")
    salt = secrets.token_hex(16)
    return salt, password(value, salt)


def member(con, uid):
    row = con.execute(
        "SELECT * FROM users WHERE id=? AND deleted_at IS NULL", (uid,)
    ).fetchone()
    if not row:
        fail(404, "成员不存在")
    if row["role"] != "member":
        fail(403, "管理员账户请在个人资料中修改")
    return row


def discard_avatar(value):
    if not value.startswith("upload:"):
        return
    key = value[7:]
    if re.fullmatch(r"[0-9a-f]{32}", key):
        with db() as con:
            if con.execute("SELECT 1 FROM users WHERE avatar=?", (value,)).fetchone():
                return
        (UPLOADS / (key + ".webp")).unlink(missing_ok=True)


class ProfileEdit(BaseModel):
    nickname: str | None = Field(default=None, max_length=40)
    avatar: str | None = Field(default=None, max_length=80)


@router.patch("/api/me")
def edit_profile(body: ProfileEdit, request: Request):
    user = actor(request)
    old = None
    with db(True) as con:
        row = con.execute(
            "SELECT * FROM users WHERE id=? AND active=1 AND deleted_at IS NULL",
            (user["id"],),
        ).fetchone()
        if not row:
            fail(401, "请重新登录")
        nickname = (
            check_nickname(body.nickname)
            if body.nickname is not None
            else row["nickname"]
        )
        avatar = row["avatar"]
        if body.avatar is not None:
            if body.avatar not in BUILTINS and body.avatar != row["avatar"]:
                fail(400, "请选择头像库中的头像")
            avatar = body.avatar
        old = row["avatar"]
        con.execute(
            "UPDATE users SET nickname=?,avatar=? WHERE id=?",
            (nickname, avatar, user["id"]),
        )
        result = public_profile(
            con.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        )
    if old != avatar:
        discard_avatar(old)
    return result


@router.put("/api/me/avatar")
async def upload_avatar(request: Request):
    user = actor(request)
    staged, _ = await receive(request, 5 << 20)
    key = uuid.uuid4().hex
    output = UPLOADS / (key + ".webp")
    committed = False
    try:
        try:
            await run_in_threadpool(import_avatar, staged, output)
        except ImageImportError as error:
            fail(400, str(error))
        with db(True) as con:
            row = con.execute(
                "SELECT * FROM users WHERE id=? AND active=1 AND deleted_at IS NULL",
                (user["id"],),
            ).fetchone()
            if not row:
                fail(401, "请重新登录")
            old = row["avatar"]
            con.execute(
                "UPDATE users SET avatar=? WHERE id=?", ("upload:" + key, user["id"])
            )
            result = public_profile(
                con.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            )
        committed = True
        discard_avatar(old)
        return result
    finally:
        staged.unlink(missing_ok=True)
        if not committed:
            output.unlink(missing_ok=True)


@router.get("/avatars/{filename}")
def built_in_avatar(filename: str):
    if filename not in {key + ".svg" for key, _ in AVATARS}:
        fail(404, "头像不存在")
    return FileResponse(ROOT / "static/avatars" / filename, media_type="image/svg+xml")


@router.get("/avatars/uploads/{filename}")
def custom_avatar(filename: str, request: Request):
    actor(request)
    if not re.fullmatch(r"[0-9a-f]{32}\.webp", filename):
        fail(404, "头像不存在")
    key = "upload:" + filename[:-5]
    with db() as con:
        if not con.execute(
            "SELECT 1 FROM users WHERE avatar=? AND deleted_at IS NULL", (key,)
        ).fetchone():
            fail(404, "头像不存在")
    return FileResponse(UPLOADS / filename, media_type="image/webp")


class OwnPassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=10, max_length=200)


@router.post("/api/me/password")
def change_password(body: OwnPassword, request: Request):
    user = actor(request)
    if not hmac.compare_digest(
        password(body.current_password, user["salt"]), user["pw"]
    ):
        fail(400, "当前密码不正确")
    salt, pw = new_password(body.password)
    with db(True) as con:
        row = con.execute(
            "SELECT * FROM users WHERE id=? AND active=1 AND deleted_at IS NULL",
            (user["id"],),
        ).fetchone()
        if not row or row["pw"] != user["pw"]:
            fail(409, "账户信息已变化，请重新登录")
        con.execute("UPDATE users SET salt=?,pw=? WHERE id=?", (salt, pw, user["id"]))
        con.execute(
            "DELETE FROM sessions WHERE user=? AND key!=?",
            (user["id"], hashed(request.cookies.get("fm_session", ""))),
        )
    return {"ok": True}


class AddMember(BaseModel):
    name: str = Field(min_length=2, max_length=32)
    nickname: str = Field(default="", max_length=40)
    password: str = Field(min_length=10, max_length=200)


@router.post("/api/users")
def create_member(body: AddMember, request: Request):
    admin(request)
    name = check_name(body.name)
    nickname = check_nickname(body.nickname or name)
    salt, pw = new_password(body.password)
    with db(True) as con:
        if con.execute("SELECT 1 FROM users WHERE name=?", (name,)).fetchone():
            fail(409, "用户名已被使用")
        uid = con.execute(
            "INSERT INTO users(name,nickname,salt,pw,role,avatar) VALUES(?,?,?,?,'member',?)",
            (name, nickname, salt, pw, random_avatar()),
        ).lastrowid
        return public_profile(
            con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        )


class ResetPassword(BaseModel):
    password: str = Field(min_length=10, max_length=200)


@router.post("/api/users/{uid}/password")
def reset_member_password(uid: int, body: ResetPassword, request: Request):
    admin(request)
    salt, pw = new_password(body.password)
    with db(True) as con:
        member(con, uid)
        con.execute("UPDATE users SET salt=?,pw=? WHERE id=?", (salt, pw, uid))
        con.execute("DELETE FROM sessions WHERE user=?", (uid,))
    return {"ok": True}


@router.delete("/api/users/{uid}")
def delete_member(uid: int, request: Request):
    admin(request)
    with db(True) as con:
        row = member(con, uid)
        old = row["avatar"]
        for job in con.execute("SELECT * FROM jobs WHERE status='running' AND node IN (SELECT id FROM nodes WHERE owner=?)", (uid,)).fetchall():
            timing.end_run(con, job, "interrupted")
        con.execute(
            """UPDATE jobs SET status=CASE WHEN attempts<2 THEN 'queued' ELSE 'failed' END,
            note='接入成员已移除，等待其他实例',node=NULL,ticket=NULL,lease=NULL,updated=?
            WHERE status='running' AND node IN (SELECT id FROM nodes WHERE owner=?)""",
            (now(), uid),
        )
        con.execute(
            "UPDATE nodes SET control='removed',stage='offline' WHERE owner=?", (uid,)
        )
        con.execute("DELETE FROM sessions WHERE user=?", (uid,))
        con.execute("UPDATE pairs SET expires=0 WHERE owner=?", (uid,))
        con.execute(
            "UPDATE users SET active=0,deleted_at=?,name=?,nickname='已删除成员',avatar=?,salt=?,pw=? WHERE id=?",
            (
                now(),
                f"deleted-{uid}-{secrets.token_hex(8)}",
                random_avatar(),
                secrets.token_hex(16),
                secrets.token_hex(64),
                uid,
            ),
        )
    discard_avatar(old)
    return {"ok": True}
