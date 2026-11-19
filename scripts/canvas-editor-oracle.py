"""Serve pinned production UI/API with deterministic editor data on loopback."""

import hashlib
import json
import os
import runpy
import shutil
import sys
from pathlib import Path

import uvicorn
from fastapi.testclient import TestClient

runtime, fixtures = map(Path, sys.argv[1:3])
port, site, provider = sys.argv[3:]
pinned, _ = runpy.run_path(str(Path(__file__).with_name("preview-original.py")))["prepare"](runtime)
# Credentials and model workers in this process are fixture-only.
for key in list(os.environ):
    if key.startswith("FUMIAO_") or key in {"DEEPSEEK_API_KEY", "OPENAI_CHAT_API_KEY", "OPENAI_API_KEY"}:
        del os.environ[key]
os.environ.update(
    FUMIAO_DATA=str(runtime / "data"),
    FUMIAO_SITE=site,
    FUMIAO_STATIC_DIR=str(pinned / "static"),
    FUMIAO_MUSE_AUTOSTART="0",
    FUMIAO_FLOW_AUTOSTART="0",
    FUMIAO_PAYMENT_AUTOSTART="0",
    FUMIAO_FLOW_URL=provider,
    FUMIAO_FLOW_PUBLIC_URL=provider,
    FUMIAO_FLOW_KEY="editor-fixture",
    DEEPSEEK_API_KEY="editor-fixture",
    NO_PROXY="127.0.0.1,localhost",
)
sys.path.insert(0, str(pinned))

import core

# The minute displayed in generation history must remain equal across runs.
core.now = lambda: 1794900000

import chat_models
import credits
import flow_provider
from server import app

for spec in chat_models.PROVIDERS.values():
    spec.update(url=provider + "/chat/completions", models_url=provider + "/models")

uploads = []


class ObserveUploads:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path")
        if scope["type"] != "http" or scope["method"] != "POST" or path not in {
            "/api/assets", "/api/h3/references",
        }:
            await self.app(scope, receive, send)
            return

        digest = hashlib.sha256()
        headers = dict(scope["headers"])

        async def observe():
            message = await receive()
            if message["type"] == "http.request":
                digest.update(message.get("body", b""))
                if not message.get("more_body"):
                    uploads.append({
                        "path": path,
                        "query": scope["query_string"].decode(),
                        "sha256": digest.hexdigest(),
                        "headers": {key.decode(): headers[key].decode() for key in (
                            b"content-type", b"x-workspace-id", b"x-file-name",
                            b"x-frame-source", b"x-frame-time",
                        ) if key in headers},
                    })
            return message

        await self.app(scope, observe, send)


app.add_middleware(ObserveUploads)

project = "a" * 32
video = "b" * 32
image = "c" * 32
pack = "d" * 32
voice = "e" * 32

with TestClient(app, base_url=site) as client:
    code = core.token()
    with core.db(True) as con:
        con.execute(
            "INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",
            (code, core.now() + 90),
        )
    registration = client.post("/api/register", json={
        "name": "canvas-fixture",
        "nickname": "画布测试",
        "password": "canvas-editor-fixture-only",
        "code": code,
    })
    assert registration.status_code == 200, registration.text
    state = client.get("/api/state").json()
    owner, workspace = state["me"]["id"], state["workspace_id"]
    with core.db(True) as con:
        credits.adjust(con, workspace, 100, "fixture", "canvas-editor-fixture", owner)
        con.execute("UPDATE credit_prices SET amount=2")
        con.execute(
            "INSERT INTO canvas_projects(id,title,owner,last_editor,workspace,created,updated) VALUES(?,?,?,?,?,?,?)",
            (project, "画布编辑器对照", owner, owner, workspace, core.now(), core.now()),
        )
        for key, filename, kind, mime in [
            (video, "shot.mp4", "video", "video/mp4"),
            (image, "ref.png", "ref", "image/png"),
            (voice, "voice.wav", "audio", "audio/wav"),
        ]:
            source = fixtures / filename
            shutil.copyfile(source, core.store.path(key))
            con.execute(
                "INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)",
                (key, kind, source.stat().st_size, mime, 96, 54, owner, workspace),
            )
        con.execute(
            "INSERT INTO asset_packs(id,workspace,owner,name,purpose,description,updated) VALUES(?,?,?,?,?,?,?)",
            (pack, workspace, owner, "对照素材包", "subject", "固定本机参考图", core.now() - 60),
        )
        con.execute("INSERT INTO asset_pack_media VALUES(?,?,0)", (pack, image))
    saved = client.put(f"/api/canvases/{project}/document", json={
        "title": "画布编辑器对照",
        "expected_revision": 1,
        "document": {
            "nodes": [
                {"id": "text", "type": "text", "title": "原始文案", "text": "原始文案 😀", "x": 100, "y": 135},
                {
                    "id": "video", "type": "video", "title": "封面镜头", "x": 495, "y": 150,
                    "media_id": video, "use_media": True, "prompt": "镜头缓缓推近",
                    "params": {"model": "MiniMax H3", "seed": 42},
                },
            ],
            "edges": [{"id": "text-to-video", "source": "text", "target": "video"}],
            "shots": ["video"],
        },
    })
    assert saved.status_code == 200, saved.text

foreign_code = core.token()
with core.db(True) as con:
    con.execute(
        "INSERT INTO registration_codes(code,role,expires) VALUES(?,'member',?)",
        (foreign_code, core.now() + 90),
    )
with TestClient(app, base_url=site) as outsider:
    foreign_session = outsider.post("/api/register", json={
        "name": "canvas-outsider",
        "nickname": "其他空间成员",
        "password": "canvas-outsider-fixture-only",
        "code": foreign_code,
    })
    assert foreign_session.status_code == 200, foreign_session.text

expired_cookie = core.token()
with core.db(True) as con:
    con.execute(
        "INSERT INTO sessions(key,user,expires) VALUES(?,?,?)",
        (core.hashed(expired_cookie), owner, core.now() - 1),
    )
(runtime / "session.json").write_text(json.dumps({
    "cookie": registration.cookies["fm_session"],
    "workspace": workspace,
    "foreignCookie": foreign_session.cookies["fm_session"],
    "expiredCookie": expired_cookie,
}))

# The browser exercises real submission, charges and polling. Supply fixture media
# in place of a GPU worker so adoption and composition still use private files.
@app.post("/__editor_fixture/finish")
def finish_jobs():
    with core.db(True) as con:
        for job in con.execute("SELECT id,kind FROM jobs WHERE status='queued'").fetchall():
            result = voice if job["kind"] == "audio" else video
            con.execute(
                "UPDATE jobs SET status='done',result=?,output_metadata=? WHERE id=?",
                (result, json.dumps({"duration": 1, "width": 96, "height": 54}), job["id"]),
            )
    return {"ok": True}


@app.post("/__editor_fixture/flow")
def advance_flow():
    return {"worked": flow_provider.tick()}


@app.get("/__editor_fixture/writes")
def saved_writes():
    with core.db() as con:
        return {
            "uploads": list(uploads),
            "provenance": [dict(row) for row in con.execute(
                "SELECT * FROM media_provenance ORDER BY rowid"
            )],
            "charges": [dict(row) for row in con.execute(
                "SELECT job,amount,state FROM credit_charges ORDER BY job"
            )],
            "job_ledger": [dict(row) for row in con.execute(
                "SELECT job,action,amount FROM credit_ledger WHERE job IS NOT NULL ORDER BY id"
            )],
        }


uvicorn.run(app, host="127.0.0.1", port=int(port), log_level="warning")
