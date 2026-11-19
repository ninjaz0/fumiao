"""Real platform API, isolated database and synthetic MP4; no Google allocation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid
from fastapi.testclient import TestClient

temp = tempfile.TemporaryDirectory()
root = Path(__file__).resolve().parents[2]
os.environ.update(FUMIAO_DATA=temp.name, FUMIAO_SITE="http://testserver", FUMIAO_MUSE_AUTOSTART="0")
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "FumiaoColab/Resources"))
import core
from server import app
from cloud_worker import Worker

client = TestClient(app)
salt = "ab" * 16
with core.db(True) as con:
    for name in ("colab-owner", "other-owner"):
        con.execute("INSERT INTO users(name,salt,pw,role) VALUES(?,?,?,'member')", (name, salt, core.password("test-password-123", salt)))

def ok(response):
    assert response.is_success, (response.status_code, response.text[:250])
    return response.json()

assert client.post("/api/pairs", json={"models": ["MiniMax H3"]}).status_code == 401
ok(client.post("/api/login", json={"name": "colab-owner", "password": "test-password-123"}))
me = ok(client.get("/api/state"))["me"]
pair = ok(client.post("/api/pairs", json={"name": "", "models": ["MiniMax H3"]}))
code = pair["command"].split()[-1]
worker_root = Path(temp.name) / "worker"
worker_root.mkdir()
(worker_root / "config.json").write_text(json.dumps({"site": "https://nvmes.com", "code": code, "idle_minutes": 30}))
worker = Worker(worker_root)
agent = TestClient(app, headers={"Authorization": "Bearer " + worker.secret})

def api(path, data=None, method="POST", raw=None):
    headers = {}
    if worker.job: headers["X-Job-Ticket"] = worker.job["ticket"]
    if raw is not None:
        headers.update({"Content-Type": "video/mp4", "X-SHA256": hashlib.sha256(raw).hexdigest(),
            "X-Job-Timing": json.dumps({"sampling_steps": worker.job["sampling_steps"], "fast_mode": False})})
        return ok(agent.request(method, path, content=raw, headers=headers))
    return ok(agent.request(method, path, json=data if method != "GET" else None, headers=headers))

worker.api = api
worker.enroll(); worker.heartbeat()
assert "code" not in json.loads((worker_root / "config.json").read_text())
with core.db() as con:
    node = dict(con.execute("SELECT * FROM nodes WHERE key=?", (core.hashed(worker.secret),)).fetchone())
    assert node["owner"] == me["id"] and node["name"] == pair["name"]
other = TestClient(app)
ok(other.post("/api/login", json={"name": "other-owner", "password": "test-password-123"}))
assert not ok(other.get("/api/state"))["nodes"]

with core.db(True) as con:
    con.execute("UPDATE credit_prices SET amount=1")
    con.execute("UPDATE credit_accounts SET balance=100")
worker.ready = True; worker.stage = "ready"; worker.heartbeat()
job_id = ok(client.post("/api/jobs", json={"uid": str(uuid.uuid4()), "model": "MiniMax H3", "prompt": "synthetic fixture", "sampling_steps": 20}))["id"]
job = api("/agent/claim")["job"]
assert job["id"] == job_id
worker.job = job; worker.stage = "busy"; worker.heartbeat()
assert not worker.lost.is_set()
video = worker_root / "fixture.mp4"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=blue:s={job['width']}x{job['height']}:r=24",
    "-f", "lavfi", "-i", "anullsrc=r=32000:cl=stereo", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-frames:v", "124", "-t", str(124/24), str(video)], check=True)
worker.deliver(job, video)
worker.deliver(job, video)  # Receipt prevents duplicate finalization.
with core.db() as con:
    done = con.execute("SELECT status,result FROM jobs WHERE id=?", (job_id,)).fetchone()
    assert done["status"] == "done" and done["result"]
    assert con.execute("SELECT count(*) FROM media WHERE kind='video'").fetchone()[0] == 1

worker.job = None; worker.stage = "ready"; worker.heartbeat()
fast = ok(client.post("/api/jobs", json={"uid": str(uuid.uuid4()), "model": "MiniMax H3", "prompt": "turbo must wait", "sampling_steps": 4}))["id"]
assert api("/agent/claim")["job"] is None
print("PASS Fumiao login, automatic owner assignment, account isolation, cloud heartbeat, task claim, validated MP4 delivery, idempotent receipt and BF16-only dispatch")
