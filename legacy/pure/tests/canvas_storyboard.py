"""Storyboard templates, ordered export and stable video selection."""
import io
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4
from zipfile import ZipFile

from fastapi.testclient import TestClient

sandbox = TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name, FUMIAO_SITE="http://testserver", FUMIAO_MUSE_AUTOSTART="0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import core
import model_policy
from credit_fixtures import fund_test_accounts
from server import app

fund_test_accounts()


def okay(response):
    assert response.is_success, (response.status_code, response.text[:500])
    return response.json()


def account(name):
    code = core.token()
    with core.db(True) as con:
        con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'member',?)",
                    (code, core.now() + 60))
    client = TestClient(app)
    okay(client.post("/api/register", json={"nickname": name, "name": name,
         "password": "storyboard-isolated-fixture-2026", "code": code}))
    return client


owner, other = account("分镜测试甲"), account("分镜测试乙")
templates = okay(owner.get("/api/canvases"))["templates"]
assert {template["id"] for template in templates} == {"event", "product", "portrait"}
for template in templates:
    project = okay(owner.post("/api/canvases", json={"template": template["id"], "ratio": "9:16"}))
    doc = project["document"]
    videos = [node for node in doc["nodes"] if node["type"] == "video"]
    assert len(videos) == 6 and doc["shots"] == [node["id"] for node in videos]
    assert all(node["params"]["seconds"] == 5 and node["params"]["ratio"] == "9:16" for node in videos)
    assert okay(owner.get(f"/api/canvases/{project['id']}/runs"))["runs"] == []
    assert all(edge["source"] != "reference" for edge in doc["edges"])
    assert all(node["text"] for node in doc["nodes"] if node["type"] == "text")

assert "shots" not in okay(owner.post("/api/canvases", json={}))["document"]
url = f"/api/canvases/{project['id']}"
download = url + "/shots/download"
assert other.post(download, json={"expected_revision": 1}).status_code == 404
assert owner.post(download, json={"expected_revision": 1}).status_code == 409
assert owner.post(download, json={"expected_revision": 2}).status_code == 409


def save(document):
    return owner.put(url + "/document", json={
        "expected_revision": project["revision"], "title": project["title"], "document": document,
    })


for invalid in (["shot-1", "shot-1"], ["script-1"], ["missing"]):
    assert save({**doc, "shots": invalid}).status_code == 400

# Submit via the actual node endpoint, then store deterministic result fixtures.
def submit(shot):
    return okay(owner.post(f"{url}/nodes/{shot}/runs", json={
        "expected_revision": project["revision"], "uid": str(uuid4()),
    }))["id"]


def complete(job, payload):
    key = uuid4().hex
    core.store.path(key).write_bytes(payload)
    with core.db(True) as con:
        con.execute("""INSERT INTO media(id,kind,size,mime,w,h,owner,workspace)
                     SELECT ?,'video',?,'video/mp4',width,height,owner,workspace FROM jobs WHERE id=?""",
                    (key, len(payload), job))
        con.execute("UPDATE jobs SET status='done',result=? WHERE id=?", (key, job))
    return key


first = submit("shot-1")
first_key = complete(first, b"adopted result")
replacement = submit("shot-1")
second = submit("shot-2")
complete(second, b"second shot")
videos[0]["active_job"] = first
doc["shots"] = ["shot-2", "shot-1"]
project["revision"] = okay(save(doc))["revision"]
assert owner.post(download, json={"expected_revision": 1}).status_code == 409
prepared = okay(owner.post(download, json={"expected_revision": project["revision"]}))
complete(replacement, b"newer result")
assert other.get(prepared["url"]).status_code == 403
response = owner.get(prepared["url"])
with ZipFile(io.BytesIO(response.content)) as archive:
    names = archive.namelist()
    assert names == ["镜头-001.mp4", "镜头-002.mp4"]
    assert [archive.read(name) for name in names] == [b"second shot", b"adopted result"]
runs = okay(owner.get(url + "/runs"))["runs"]
assert next(run for run in runs if run["id"] == first)["result"] == first_key
assert next(run for run in runs if run["id"] == first)["seed"] is not None

duplicate = okay(owner.post(url + "/duplicate", json={}))
assert duplicate["document"]["shots"] == doc["shots"]
copied_video = next(node for node in duplicate["document"]["nodes"] if node["id"] == "shot-1")
assert copied_video["media_id"] == first_key and copied_video["active_job"] is None

with core.db(True) as con:
    flags = model_policy.read(con)["enabled"]
    model_policy.save(con, {**flags, "MiniMax H3": False})
muse = okay(owner.post("/api/canvases", json={"template": "event"}))
assert all(node["params"]["model"] == "muse-video" and node["params"]["seconds"] == 5
           for node in muse["document"]["nodes"] if node["type"] == "video")
print("PASS template creation, old documents, shot validation, real task submission, pinned export, revision guards, workspaces and duplication")
