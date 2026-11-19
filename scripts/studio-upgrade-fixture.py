"""Build a quiescent Pure snapshot from the pinned app using only synthetic data."""

from io import BytesIO
import json
import os
from pathlib import Path
import runpy
import shutil
import sqlite3
import sys
import uuid

from fastapi.testclient import TestClient
from PIL import Image


root = Path(sys.argv[1])
prepare = runpy.run_path(str(Path(__file__).with_name("preview-original.py")))["prepare"]
app_root, _ = prepare(root / "pure")
os.environ.update(
    FUMIAO_DATA=str(root / "pure" / "data"),
    FUMIAO_SITE="http://testserver",
    FUMIAO_MUSE_AUTOSTART="0",
    FUMIAO_FLOW_AUTOSTART="0",
    FUMIAO_PAYMENT_AUTOSTART="0",
    OPENAI_API_KEY="sk-synthetic-never-export",
)
sys.path.insert(0, str(app_root))
import chat_runtime
import chat_storage
import core
import credits
from server import app


def uid():
    return str(uuid.uuid4())


def request(client, method, path, body=None, workspace=None, **kwargs):
    headers = kwargs.pop("headers", {})
    if workspace is not None:
        headers["X-Workspace-Id"] = str(workspace)
    result = client.request(method, path, json=body, headers=headers, **kwargs)
    assert result.status_code == 200, (method, path, result.status_code, result.text)
    return result.json()


admin, member = TestClient(app), TestClient(app)
for client, role, name in [(admin, "admin", "upgrade-admin"), (member, "member", "upgrade-member")]:
    with core.db(True) as con:
        code = core.token()
        con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)", (code, role, core.now() + 86400))
    request(client, "POST", "/api/register", dict(name=name, nickname=name, password=sys.argv[2], code=code))

admin_state = request(admin, "GET", "/api/state")
member_state = request(member, "GET", "/api/state")
private_id, member_id = admin_state["workspace_id"], member_state["workspace_id"]
team_id = next(workspace["id"] for workspace in request(admin, "GET", "/api/workspaces")["workspaces"] if workspace["kind"] == "team")
with core.db(True) as con:
    con.execute("INSERT INTO workspace_members(workspace,user) VALUES(?,?)", (team_id, member_state["me"]["id"]))
    con.execute("INSERT INTO settings(key,value) VALUES('fixture_provider_credentials','sk-synthetic-never-export')")
    pricing = credits.prices(con)
model_policy = request(admin, "PATCH", "/api/settings/models", dict(model="muse-video", enabled=False, expected_revision=admin_state["model_policy"]["revision"]))["policy"]
price_key = "gpt-image-2.6-sunburst|1K|medium"
prices = {item["key"]: item["amount"] for item in pricing["items"]} | {price_key: 17}
pricing = request(admin, "PUT", "/api/settings/prices", dict(values=prices, expected_revision=pricing["revision"]))
for workspace, amount in [(private_id, 240), (member_id, 120), (team_id, 80)]:
    request(admin, "POST", "/api/admin/credits/adjust", dict(workspace=workspace, amount=amount, note="历史积分", uid=uid()))

image = Image.new("RGB", (32, 32), "orange")
file = BytesIO()
image.save(file, "PNG")
avatar = request(admin, "PUT", "/api/me/avatar", content=file.getvalue(), headers={"content-type": "image/png"})["avatar_url"]
media = request(admin, "POST", "/api/assets", content=file.getvalue(), headers={"content-type": "image/png"})["id"]
draft = dict(uid=uid(), model="gpt-image-2.6-sunburst", prompt="历史作品与私有参考", refs=[media], ratio="1:1", price_revision=pricing["revision"])
job = request(admin, "POST", "/api/image-jobs", draft)["id"]
with core.db(True) as con:
    con.execute("UPDATE jobs SET status='done',result=?,updated=? WHERE id=?", (media, core.now(), job))

canvas = request(admin, "POST", "/api/canvases", {"title": "历史分镜画布"})
canvas["document"]["nodes"] = [dict(id="image", type="image", x=30, y=42, media_id=media)]
request(admin, "PUT", "/api/canvases/" + canvas["id"] + "/document", dict(title=canvas["title"], document=canvas["document"], expected_revision=canvas["revision"]))
request(member, "POST", "/api/canvases", {"title": "旧团队协作画布"}, workspace=team_id)

chat_runtime.start = lambda _: None
chat_runtime.key = lambda _: "sk-synthetic-never-export"
chat = request(admin, "POST", "/api/chats", {})["conversation"]
turn = request(admin, "POST", f"/api/chats/{chat['id']}/messages", dict(uid=uid(), model="deepseek-flash", text="历史问题", expected_revision=chat["revision"], price_revision=pricing["revision"]))
with core.db(True) as con:
    assert chat_storage.finish(con, turn["conversation"]["active_turn"], "complete", "历史分镜回复", "", {"total_tokens": 18}, "stop")

# Use SQLite's backup API to materialize one consistent, standalone source.
backup = root / "backup"
backup.mkdir(mode=0o700)
with core.db() as source, sqlite3.connect(backup / "studio.sqlite") as target:
    source.backup(target)
    target.execute("PRAGMA journal_mode=DELETE")
shutil.copytree(core.DATA / "objects", backup / "objects", copy_function=shutil.copy2)
shutil.copytree(core.DATA / "avatars", backup / "avatars", copy_function=shutil.copy2)
expected = dict(
    legacy_cookie="fm_session=" + admin.cookies["fm_session"],
    admin_id=admin_state["me"]["id"],
    private_id=private_id,
    team_id=team_id,
    job=job,
    job_draft=draft,
    media=media,
    avatar=avatar,
    chat=chat["id"],
    canvas=canvas["id"],
    pricing=pricing,
    model_policy=model_policy,
    credits=[request(admin, "GET", "/api/credits", workspace=wid) for wid in (private_id, team_id)]
    + [request(member, "GET", "/api/credits", workspace=member_id)],
    member_workspace=member_id,
)
(root / "expected.json").write_text(json.dumps(expected, ensure_ascii=False))
