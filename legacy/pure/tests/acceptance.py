"""Run offline integration checks in a disposable database with real image and MP4 data."""

import hashlib
import io
import os
import subprocess
import sys
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

temp = tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=temp.name, FUMIAO_SITE="http://testserver")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from fastapi.testclient import TestClient
import core
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()


def okay(r):
    assert r.is_success, (r.status_code, r.text[:500])
    return r.json()


def auth(code, name):
    c = TestClient(app)
    okay(
        c.post(
            "/api/register",
            json={"nickname": name, "name": name, "password": "sample-strong-test-2026", "code": code},
        )
    )
    return c


def add(jclient, refs=None, ratio="16:9", quality=480):
    return okay(
        jclient.post(
            "/api/jobs",
            json={
                "uid": str(uuid.uuid4()),
                "prompt": "海面，海鸟飞过。",
                "refs": refs or [],
                "ratio": ratio,
                "quality": quality,
            },
        )
    )["id"]


def node(client, owner):
    command = okay(owner.post("/api/pairs", json={"name": "验收节点"}))["command"]
    code = command.split()[-1]
    key = core.token()
    okay(client.post("/agent/enroll", json={"code": code, "secret": key}))
    assert (
        client.post(
            "/agent/enroll", json={"code": code, "secret": core.token()}
        ).status_code
        == 403
    )
    c = TestClient(app, headers={"Authorization": "Bearer " + key})
    okay(c.post("/agent/heartbeat", json={"stage": "ready"}))
    return c


def claim(c):
    return okay(c.post("/agent/claim"))["job"]


def main():
    anonymous = TestClient(app)
    assert anonymous.get("/api/state").status_code == 401
    first = core.token()
    with core.db(True) as db:
        db.execute(
            "INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",
            (first, core.now() + 60),
        )
    a = auth(first, "管理员")
    invite = okay(a.post("/api/invite-codes", json={"name":"测试邀请"}))["code"]
    b = auth(invite, "成员用户")
    from shared_workspace import share_workspace
    share_workspace(a,b)
    assert (
        TestClient(app).post(
            "/api/register",
            json={"nickname": "其他成员", "name": "其他成员", "password": "strong-test-2026", "code": invite},
        ).status_code
        == 200
    )
    assert b.post("/api/invites").status_code == 403
    assert b.post("/api/nodes/1/stop").status_code == 403
    img = io.BytesIO()
    Image.new("RGB", (48, 85)).save(img, "PNG")
    ref = okay(b.post("/api/assets", content=img.getvalue()))["id"]
    assert anonymous.get("/media/" + ref).status_code == 401
    i, j = add(a), add(b, [ref], "auto")
    assert b.delete("/api/assets/" + ref).status_code == 409
    n, m = node(anonymous, a), node(anonymous, b)
    for client in (n, m):
        okay(
            client.post(
                "/agent/heartbeat",
                json={"stage": "preparing", "detail": "下载文本编码器 42%"},
            )
        )
    assert all(
        x["detail"] == "下载文本编码器 42%" for x in okay(a.get("/api/state"))["nodes"]
    )
    member_view = okay(b.get("/api/state"))
    for x in member_view["nodes"]:
        assert ("detail" in x) == (x["owner"] == member_view["me"]["id"])
    for client in (n, m):
        okay(client.post("/agent/heartbeat", json={"stage": "ready"}))
    with ThreadPoolExecutor() as pool:
        first, second = list(pool.map(claim, [n, m]))
    assert {first["id"], second["id"]} == {i, j}
    if first["id"] == j:
        n, m, first, second = m, n, second, first
    assert (second["width"], second["height"]) == (480, 864)
    hdr = {"x-job-ticket": first["ticket"]}
    assert n.get(f"/agent/jobs/{i}/ref/{ref}", headers=hdr).status_code == 403
    assert (
        m.get(
            f"/agent/jobs/{j}/ref/{ref}", headers={"x-job-ticket": second["ticket"]}
        ).content
        == img.getvalue()
    )
    src = Path(temp.name) / "test.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=size=864x480:rate=24",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=32000:cl=stereo",
            "-t",
            "5.166667",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(src),
        ],
        check=True,
    )
    raw = src.read_bytes()
    hdr["x-sha256"] = hashlib.sha256(raw).hexdigest()
    assert (
        n.put(f"/agent/jobs/{i}/result", content=b"bad", headers=hdr).status_code == 422
    )
    result = okay(n.put(f"/agent/jobs/{i}/result", content=raw, headers=hdr))
    assert okay(n.put(f"/agent/jobs/{i}/result", content=raw, headers=hdr)) == result
    assert a.get("/media/" + result["id"]).content == raw
    timed = next(x for x in okay(a.get("/api/state"))["jobs"] if x["id"] == i)
    assert timed["timing"]["source"] == "measured" and timed["timing"]["elapsed"] >= 0
    with core.db() as con:
        assert con.execute("SELECT count(*) FROM job_runs WHERE job=? AND status='done'", (i,)).fetchone()[0] == 1
    assert b.delete(f"/api/jobs/{i}").status_code == 403
    with core.db(True) as db:
        db.execute("UPDATE jobs SET lease=0 WHERE id=?", (j,))
    # If no other node has taken the work, a returning original worker can finish it.
    okay(a.get("/api/state"))
    held = okay(
        m.post("/agent/heartbeat", json={"stage": "busy", "ticket": second["ticket"]})
    )
    assert held["held"]
    okay(
        m.post(
            "/agent/heartbeat",
            json={"stage": "busy", "ticket": second["ticket"], "step": 3, "steps": 20},
        )
    )
    assert (
        next(x for x in okay(a.get("/api/state"))["jobs"] if x["id"] == j)["note"]
        == "采样 3 / 20 步"
    )
    with core.db(True) as db:
        db.execute("UPDATE jobs SET lease=0 WHERE id=?", (j,))
    assert claim(n)["id"] == j
    assert (
        m.get(
            f"/agent/jobs/{j}/ref/{ref}", headers={"x-job-ticket": second["ticket"]}
        ).status_code
        == 409
    )
    assert claim(m) is None
    state = okay(a.get("/api/state"))
    assert state["reserved"] == core.RESERVE
    nodeid = next(x["node"] for x in state["jobs"] if x["id"] == j)
    okay(a.post(f"/api/nodes/{nodeid}/drain"))
    assert claim(n)["id"] == j
    okay(a.post(f"/api/nodes/{nodeid}/stop"))
    assert claim(n) is None
    for ratio in core.RATIOS:
        for q in (480, 768):
            job = add(a, ratio=ratio, quality=q)
            r = next(x for x in okay(a.get("/api/state"))["jobs"] if x["id"] == job)
            assert r["width"] % 32 == r["height"] % 32 == 0
            okay(a.post(f"/api/jobs/{job}/cancel"))
    okay(a.delete(f"/api/jobs/{j}"))
    okay(b.delete("/api/assets/" + ref))
    okay(a.delete(f"/api/jobs/{i}"))
    assert okay(a.get("/api/state"))["used"] == 0
    old, core.QUOTA = core.QUOTA, 1
    assert (
        a.post("/api/jobs", json={"uid": str(uuid.uuid4()), "prompt": "x"}).status_code
        == 507
    )
    core.QUOTA = old
    okay(a.post("/api/users/2/disable"))
    assert b.get("/api/state").status_code == 401
    print(
        "PASS invite, permissions, private media, FIFO concurrent leases, expiry, stale ticket, result replay, MP4 decoding, quota reservation, cleanup, all 12 geometry presets"
    )


if __name__ == "__main__":
    main()
