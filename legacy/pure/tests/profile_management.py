"""Profile and member-management regressions against an isolated database."""

import io
import json
import os
import sqlite3
import sys
import tempfile
import uuid
from pathlib import Path

tmp = tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=tmp.name, FUMIAO_SITE="http://testserver")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from avatars import AVATARS
from core import db, hashed, now, token, init_db
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()


def ok(response):
    assert response.is_success, (response.status_code, response.text)
    return response.json()


def login(name, pw):
    client = TestClient(app)
    ok(client.post("/api/login", json={"name": name, "password": pw}))
    return client


def main():
    root = TestClient(app)
    code = token()
    with db(True) as con:
        con.execute(
            "INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",
            (code, now() + 600),
        )
    ok(
        root.post(
            "/api/register",
            json={"nickname": "测试管理", "name": "测试管理", "password": "admin-strong-9927", "code": code},
        )
    )
    admin = ok(root.get("/api/state"))["me"]
    assert (
        admin["avatar"].startswith("builtin:")
        and root.get(admin["avatar_url"]).status_code == 200
    )
    init_db()
    assert ok(root.get("/api/state"))["me"]["avatar"] == admin["avatar"]
    user = ok(
        root.post(
            "/api/users",
            json={
                "name": "sampleuser",
                "nickname": "海边",
                "password": "member-strong-003",
            },
        )
    )
    member = login("sampleuser", "member-strong-003")
    other = login("sampleuser", "member-strong-003")
    public = ok(member.get("/api/state"))
    assert (
        not {"used", "reserved", "quota", "disk_free", "users", "invites"}
        & public.keys()
    )
    assert (
        member.post(
            "/api/users", json={"name": "intruder", "password": "some-strong-password"}
        ).status_code
        == 403
    )
    assert member.delete(f"/api/users/{user['id']}").status_code == 403
    assert root.delete(f"/api/users/{admin['id']}").status_code == 403
    assert member.patch("/api/me", json={"nickname": "  "}).status_code == 400
    assert (
        member.patch("/api/me", json={"avatar": "upload:" + ("a" * 32)}).status_code
        == 400
    )
    chosen = "builtin:" + AVATARS[-1][0]
    edit = ok(member.patch("/api/me", json={"nickname": "海风", "avatar": chosen}))
    assert (
        edit["name"] == "sampleuser"
        and edit["nickname"] == "海风"
        and edit["avatar"] == chosen
    )
    image = io.BytesIO()
    Image.new("RGB", (100, 80), "#c8d4cf").save(image, "PNG")
    uploaded = ok(member.put("/api/me/avatar", content=image.getvalue()))
    assert uploaded["avatar"].startswith("upload:")
    pic = member.get(uploaded["avatar_url"])
    assert Image.open(io.BytesIO(pic.content)).size == (256, 256)
    assert TestClient(app).get(uploaded["avatar_url"]).status_code == 401
    assert member.put("/api/me/avatar", content=b"not an image").status_code == 400
    assert (
        member.post(
            "/api/me/password",
            json={"current_password": "wrong", "password": "updated-strong-004"},
        ).status_code
        == 400
    )
    ok(
        member.post(
            "/api/me/password",
            json={
                "current_password": "member-strong-003",
                "password": "updated-strong-004",
            },
        )
    )
    assert (
        other.get("/api/state").status_code == 401
        and member.get("/api/state").status_code == 200
    )
    ok(
        root.post(
            f"/api/users/{user['id']}/password", json={"password": "reset-strong-005"}
        )
    )
    assert member.get("/api/state").status_code == 401
    assert (
        TestClient(app)
        .post(
            "/api/login", json={"name": "sampleuser", "password": "updated-strong-004"}
        )
        .status_code
        == 401
    )
    member = login("sampleuser", "reset-strong-005")
    from shared_workspace import share_workspace
    share_workspace(root,member)
    job = ok(
        member.post("/api/jobs", json={"uid": str(uuid.uuid4()), "prompt": "画面描述"})
    )["id"]
    with db(True) as con:
        con.execute("UPDATE jobs SET status='done' WHERE id=?", (job,))
    code = ok(member.post("/api/pairs", json={"name": "member-node"}))[
        "command"
    ].split()[-1]
    secret = token() + "more"
    node = TestClient(app, headers={"Authorization": "Bearer " + secret})
    ok(node.post("/agent/enroll", json={"code": code, "secret": secret}))
    ok(root.delete(f"/api/users/{user['id']}"))
    assert member.get("/api/state").status_code == 401
    assert node.post("/agent/claim").status_code == 403
    assert not any(u["id"] == user["id"] for u in ok(root.get("/api/state"))["users"])
    assert any(
        j["id"] == job and j["author"] == "已删除成员"
        for j in ok(root.get("/api/state"))["jobs"]
    )
    assert root.get(uploaded["avatar_url"]).status_code == 404
    recreated = ok(
        root.post(
            "/api/users", json={"name": "sampleuser", "password": "new-member-006"}
        )
    )
    assert recreated["id"] != user["id"]
    invite = ok(root.post("/api/invite-codes", json={"name":"测试邀请"}))["code"]
    client = TestClient(app)
    ok(
        client.post(
            "/api/register",
            json={"nickname": "受邀成员", "name": "受邀成员", "password": "invited-pass-007", "code": invite},
        )
    )
    assert ok(client.get("/api/state"))["me"]["avatar"].startswith("builtin:")
    print(
        "PASS migrated stable avatars, random registration avatars, profile edits, uploaded images, admin-only global information, password revocation, member removal and retained works"
    )


if __name__ == "__main__":
    main()
