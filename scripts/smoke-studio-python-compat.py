"""Exercise the Python product launcher against a disposable, pinned old SQLite site.

Run with the Python environment from baseline/README.md after pnpm build.
Requires Node 24, ffmpeg and ffprobe on PATH. The only upstream is a loopback stub.
"""

from array import array
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Thread
import time
from uuid import uuid4
import wave

import httpx


ROOT = Path(__file__).resolve().parents[1]
AUDIO = "breeze-tts-2"
FLOW = "flow:veo-3.1-quality"
FLOW_EXTEND = "flow:veo-3.1-quality-extend-8s-landscape"


def port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def await_value(check, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"timed out at {check.__name__}")


@contextmanager
def process(command, logs, **variables):
    # Do not inherit provider credentials, provider endpoints or Studio profiles.
    env = {key: os.environ[key] for key in ("PATH", "TMPDIR", "SystemRoot") if key in os.environ}
    env.update(HOME=str(logs.parent), NEXT_TELEMETRY_DISABLED="1", NO_PROXY="127.0.0.1", **variables)
    with logs.open("wb") as output:
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            yield child
        except BaseException:
            print(logs.read_text(errors="replace")[-12000:], file=sys.stderr)
            raise
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()


def ready(child, client):
    def health():
        assert child.poll() is None, f"server exited with {child.returncode}"
        response = client.get("/health")
        return response.is_success and response.json()["service"] == "fumiao"

    await_value(health, timeout=75)


def check(client, status, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    assert response.status_code == status, (method, path, response.status_code, response.text[:500])
    return response


def ok(client, method, path, **kwargs):
    return check(client, 200, method, path, **kwargs).json()


def auth(secret, ticket=None):
    return {"Authorization": f"Bearer {secret}"} | ({"X-Job-Ticket": ticket} if ticket else {})


def submit(client, model, prompt):
    path = "/api/audio-jobs" if model == AUDIO else "/api/jobs"
    return ok(client, "POST", path, json={"uid": str(uuid4()), "model": model, "prompt": prompt})["id"]


def make_wav():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        output.writeframes(array("h", [1000, -1000] * 12000).tobytes())
    return buffer.getvalue()


WAV = make_wav()


def result_headers(secret, ticket):
    return auth(secret, ticket) | {"X-SHA256": hashlib.sha256(WAV).hexdigest()}


def register_contributor(client, kind, model):
    secret = secrets.token_urlsafe(48)
    node = ok(client, "POST", "/api/fmworker/resources", json={
        "kind": kind, "name": f"legacy {kind}", "secret": secret,
    })["id"]
    ok(client, "PUT", f"/api/fmworker/resources/{node}", json={"enabled": True})
    ok(client, "POST", "/fmworker/heartbeat", headers=auth(secret), json={
        "stage": "ready", "capabilities": {"models": [model]},
    })
    return node, secret


def seed_old_site(directory, video):
    """Use original HTTP to earn a posted reward and create contribution leases."""
    runtime = directory / "oracle"
    database = runtime / "data" / "studio.sqlite"
    listen = port()
    command = [
        sys.executable, "scripts/preview-original.py", "--port", str(listen),
        "--runtime-directory", str(runtime), "--no-reuse-local-credentials",
    ]
    with (
        process(command, directory / "oracle.log") as child,
        httpx.Client(base_url=f"http://127.0.0.1:{listen}", trust_env=False, timeout=15) as admin,
        httpx.Client(base_url=f"http://127.0.0.1:{listen}", trust_env=False, timeout=15) as contributor,
    ):
        ready(child, admin)
        login = json.loads((runtime / "credentials.json").read_text())
        ok(admin, "POST", "/api/login", json=login)
        state = ok(admin, "GET", "/api/state")
        workspace = state["workspace_id"]
        invite = ok(admin, "POST", "/api/invite-codes", json={"name": "synthetic contributor"})
        worker_login = {"name": "legacy-worker", "password": secrets.token_urlsafe(18)}
        ok(contributor, "POST", "/api/register",
           json=worker_login | {"code": invite["code"], "nickname": "Legacy contributor"})

        with sqlite3.connect(database) as con:
            # Model paid-in credits, without calling a payment service.
            con.execute("UPDATE credit_accounts SET balance=20 WHERE workspace=?", (workspace,))
            con.execute(
                "INSERT INTO credit_ledger(workspace,action,amount,balance,reserved,created)"
                " VALUES(?,'recharge',20,20,0,unixepoch())", (workspace,),
            )
            con.execute("UPDATE credit_prices SET amount=3 WHERE key=?", (AUDIO + "|standard",))

        canvas = ok(admin, "POST", "/api/canvases", json={"title": "Existing local canvas"})
        breeze_node, breeze = register_contributor(contributor, "breeze", AUDIO)
        flow_node, flow = register_contributor(contributor, "flow", FLOW)
        ok(contributor, "POST", "/fmworker/usage", headers=auth(breeze),
           json={"uid": "synthetic-usage", "units": 1})

        def claimed(model, secret, prompt):
            job = submit(admin, model, prompt)
            lease = ok(contributor, "POST", "/fmworker/claim", headers=auth(secret))["job"]
            assert lease["id"] == job
            return lease

        posted = claimed(AUDIO, breeze, "Previously rewarded")
        previous_media = ok(
            contributor, "PUT", f"/agent/jobs/{posted['id']}/result",
            content=WAV, headers=result_headers(breeze, posted["ticket"]),
        )["id"]
        previous_credit = ok(contributor, "GET", "/api/credits")
        assert previous_credit["wallet"]["balance"] == 2
        assert previous_credit["history"][0]["action"] == "contribution"

        flow_posted = claimed(FLOW, flow, "Historical Flow result")
        historical_video = ok(contributor, "PUT", f"/fmworker/jobs/{flow_posted['id']}/result",
                              content=video, headers=auth(flow, flow_posted["ticket"]) | {
                                  "X-SHA256": hashlib.sha256(video).hexdigest(),
                                  "X-Flow-Media-Id": "legacy-google-account/video",
                              })["id"]
        previous_credit = ok(contributor, "GET", "/api/credits")
        assert previous_credit["wallet"]["balance"] == 2
        requeued = claimed(AUDIO, breeze, "Requeued before product cutover")
        flow_requeued = claimed(FLOW, flow, "Previously submitted to contribution Flow")
        with sqlite3.connect(database) as con:
            # Preserve the old assignment rows even when a legacy requeue lost node/ticket.
            con.executemany(
                "UPDATE jobs SET node=NULL,ticket=NULL,lease=NULL WHERE id=?",
                [(requeued["id"],), (flow_requeued["id"],)],
            )
        active = claimed(AUDIO, breeze, "Old lease cannot renew or deliver")
        with sqlite3.connect(database) as con:
            con.execute("UPDATE jobs SET status='queued' WHERE id IN (?,?)", (requeued["id"], flow_requeued["id"]))
            con.execute("UPDATE jobs SET lease=0 WHERE id=?", (active["id"],))
            # Keep the Flow resource inside the old readiness window during Next startup.
            con.execute("UPDATE nodes SET lastseen=unixepoch()+3600 WHERE id=?", (flow_node,))
        before = ok(admin, "GET", "/api/credits")["wallet"]
        assert before["balance"] == 16 and before["reserved"] == 7
        assert ok(contributor, "GET", "/agent/registration", headers=auth(breeze))["id"] == breeze_node
        assert ok(contributor, "GET", "/api/fmworker/account")["earned"] == 2.8
        usage_node, usage_secret = register_contributor(contributor, "breeze", AUDIO)
        ok(contributor, "POST", "/fmworker/usage", headers=auth(usage_secret),
           json={"uid": "archived-usage-only", "units": 1})

    # A compacted historical result may retain its reward but no node or ticket.
    # It is still bound to the contributor's Flow account after restart.
    with sqlite3.connect(database) as con:
        job = flow_posted["id"]
        assert con.execute("SELECT 1 FROM fm_rewards WHERE job=?", (job,)).fetchone()
        con.execute("DELETE FROM fm_assignments WHERE job=?", (job,))
        con.execute("UPDATE jobs SET node=NULL,ticket=NULL WHERE id=?", (job,))
        # The device never claimed work and its resource record was pruned.
        con.execute("DELETE FROM fm_resources WHERE node=?", (usage_node,))

    target = directory / "studio" / "original"
    shutil.copytree(runtime, target, symlinks=True)
    return {
        "login": login, "worker_login": worker_login, "canvas": canvas, "previous_media": previous_media,
        "previous_credit": previous_credit, "before": before, "breeze": breeze, "flow": flow,
        "breeze_node": breeze_node, "flow_node": flow_node, "usage_secret": usage_secret,
        "old_jobs": (posted, active, requeued, flow_requeued, flow_posted),
        "historical_video": historical_video,
        "database": target / "data" / "studio.sqlite", "oracle_db": database,
    }


@contextmanager
def mock_flow(video):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, body, media_type="application/json", status=200):
            self.send_response(status)
            self.send_header("Content-Type", media_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.headers.get("Authorization") != "Bearer synthetic-flow":
                return self.reply(b"{}", status=401)
            if self.path == "/v1/models":
                return self.reply(b'{"data":[{"id":"fixture"}]}')
            if self.path == "/health":
                return self.reply(b'{"backend_running":true,"has_active_tokens":true}')
            if self.path == "/tmp/fixture.mp4":
                return self.reply(video, "video/mp4")
            self.reply(b"{}", status=404)

        def do_POST(self):
            if (self.path != "/v1/chat/completions"
                    or self.headers.get("Authorization") != "Bearer synthetic-flow"):
                return self.reply(b"{}", status=401)
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            media_url = f"http://127.0.0.1:{self.server.server_port}/tmp/fixture.mp4"
            event = json.dumps({"choices": [{"delta": {"content": f'<video src="{media_url}">'}}]})
            self.reply(f"data: {event}\n\ndata: [DONE]\n\n".encode(), "text/event-stream")

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}", requests
        finally:
            server.shutdown()
            thread.join()


def archive_snapshot(database, site):
    with sqlite3.connect(database) as con:
        old_ids = [job["id"] for job in site["old_jobs"]]
        placeholders = ",".join("?" for _ in old_ids)
        return {
            table: con.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
            for table in ("fm_resources", "fm_assignments", "fm_rewards", "fm_reward_remainders",
                          "fm_funds", "fm_fund_holds", "fm_usage")
        } | {
            "jobs": con.execute(f"SELECT * FROM jobs WHERE id IN ({placeholders}) ORDER BY id", old_ids).fetchall(),
            "charges": con.execute(f"SELECT * FROM credit_charges WHERE job IN ({placeholders}) ORDER BY job", old_ids).fetchall(),
            "flow": con.execute(f"SELECT * FROM flow_tasks WHERE job IN ({placeholders}) ORDER BY job", old_ids).fetchall(),
            "timing": con.execute(f"SELECT * FROM job_runs WHERE job IN ({placeholders}) ORDER BY id", old_ids).fetchall(),
            "nodes": con.execute("SELECT * FROM nodes WHERE id IN (?,?) ORDER BY id",
                                 (site["breeze_node"], site["flow_node"])).fetchall(),
            "rewards": con.execute("SELECT * FROM credit_ledger WHERE action='contribution' ORDER BY id").fetchall(),
        }


@contextmanager
def product(directory, label, *, production=False):
    web, api = port(), port()
    while api == web:
        api = port()
    web_origin = f"http://127.0.0.1:{web}"
    command = ["node", "--import", "tsx", "scripts/dev-studio.ts"]
    if production:
        command.append("--production")
    with (
        process(
            command, directory / f"{label}.log",
            STUDIO_BACKEND="python", STUDIO_PYTHON=sys.executable,
            STUDIO_RUNTIME_DIRECTORY=str(directory / "studio"), STUDIO_PYTHON_FLOW_AUTOSTART="1",
            STUDIO_PORT=str(web), LEGACY_API_PORT=str(api), STUDIO_PUBLIC_URL=web_origin,
        ) as child,
        httpx.Client(base_url=web_origin, trust_env=False, timeout=30) as browser,
        httpx.Client(base_url=f"http://127.0.0.1:{api}", trust_env=False, timeout=15) as direct,
    ):
        ready(child, direct)
        ready(child, browser)
        yield browser, direct


def reject_contributions(browser, direct, site):
    _, active, queued, flow_queued, flow_posted = site["old_jobs"]
    oracle_routes = json.loads((ROOT / "baseline" / "contracts" / "routes.json").read_text())["routes"]
    retired = [route for route in oracle_routes if route["source"] in {"worker_pool_api.py", "worker_verification.py"}]
    assert len(retired) == 14
    for client, retired_status in ((browser, 410), (direct, 404)):
        for secret in (site["breeze"], site["flow"], site["usage_secret"]):
            check(client, 403, "GET", "/agent/registration", headers=auth(secret))
            check(client, 403, "POST", "/agent/claim", headers=auth(secret))
            check(client, 403, "POST", "/agent/heartbeat", headers=auth(secret),
                  json={"stage": "busy", "ticket": active["ticket"]})
        job = f"/agent/jobs/{active['id']}"
        headers = auth(site["breeze"], active["ticket"])
        check(client, 403, "GET", job + "/receipt", headers=headers)
        check(client, 403, "GET", job + "/ref/synthetic", headers=headers)
        check(client, 403, "POST", job + "/error", headers=headers, json={"stage": "error"})
        check(client, 403, "PUT", job + "/result", content=WAV,
              headers=result_headers(site["breeze"], active["ticket"]))

        for route in retired:
            path = route["path"].format(job_id=flow_queued["id"], request_id=uuid4(), node=site["flow_node"])
            check(client, retired_status, route["method"], path, headers=headers)

    check(browser, 404, "POST", f"/api/nodes/{site['breeze_node']}/resume")
    check(browser, 409, "POST", f"/api/jobs/{queued['id']}/cancel")
    response = check(browser, 400, "POST", "/api/jobs", json={
        "uid": str(uuid4()), "model": FLOW_EXTEND, "prompt": "Must stay isolated",
        "flow_source_job": flow_posted["id"],
    })
    assert response.json()["detail"] == "独立 Flow 无法续写原贡献节点生成的视频"
    state = ok(browser, "GET", "/api/state")
    jobs = {job["id"]: job["status"] for job in state["jobs"]}
    assert [jobs[job["id"]] for job in site["old_jobs"]] == ["done", "running", "queued", "queued", "done"]
    assert {site["breeze_node"], site["flow_node"]}.isdisjoint(node["id"] for node in state["nodes"])


def check_local_work(browser, site):
    canvas = site["canvas"]
    route = f"/api/canvases/{canvas['id']}"
    assert ok(browser, "GET", route)["document"] == canvas["document"]
    save = {"title": "Updated local canvas", "document": canvas["document"], "expected_revision": canvas["revision"]}
    assert ok(browser, "PUT", route + "/document", json=save)["revision"] == canvas["revision"] + 1
    check(browser, 409, "PUT", route + "/document", json=save)
    assert check(browser, 200, "GET", "/media/" + site["previous_media"]).content == WAV
    assert check(browser, 200, "GET", "/connect/install.sh").content

    with httpx.Client(base_url=browser.base_url, trust_env=False, timeout=30) as member:
        ok(member, "POST", "/api/login", json=site["worker_login"])
        assert ok(member, "GET", "/api/credits") == site["previous_credit"]
        check(member, 404, "GET", "/media/" + site["previous_media"])
        pair = ok(member, "POST", "/api/pairs", json={"models": [AUDIO]})
    pair_code = pair["command"].split()[-1]
    check(browser, 403, "POST", "/agent/enroll", json={"code": pair_code, "secret": site["breeze"]})
    secret = secrets.token_urlsafe(48)
    enrollment = {"code": pair_code, "secret": secret}
    assert ok(browser, "POST", "/agent/enroll", json=enrollment)["models"] == [AUDIO]
    assert ok(browser, "POST", "/agent/enroll", json=enrollment)["models"] == [AUDIO]
    assert ok(browser, "GET", "/agent/registration", headers=auth(secret))["paired_code_hash"]
    ok(browser, "POST", "/agent/heartbeat", headers=auth(secret), json={"stage": "ready", "ready_models": [AUDIO]})
    assert ok(browser, "POST", "/agent/claim", headers=auth(secret))["job"] is None

    audio_job = submit(browser, AUDIO, "Ordinary local execution")
    lease = ok(browser, "POST", "/agent/claim", headers=auth(secret))["job"]
    assert lease["id"] == audio_job
    assert ok(browser, "POST", "/agent/heartbeat", headers=auth(secret),
              json={"stage": "busy", "ticket": lease["ticket"]})["held"]
    path = f"/agent/jobs/{audio_job}"
    headers = result_headers(secret, lease["ticket"])
    output = ok(browser, "PUT", path + "/result", headers=headers, content=WAV)
    assert ok(browser, "PUT", path + "/result", headers=headers, content=WAV) == output
    assert ok(browser, "GET", path + "/receipt", headers=headers) == {"delivered": True}
    assert check(browser, 200, "GET", "/media/" + output["id"]).content == WAV
    return audio_job


def main():
    video = subprocess.check_output([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=32x18:d=1",
        "-c:v", "libx264", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
    ])
    with TemporaryDirectory(prefix="fumiao-python-compat-") as temporary, mock_flow(video) as (flow_url, requests):
        directory = Path(temporary)
        site = seed_old_site(directory, video)
        old = archive_snapshot(site["oracle_db"], site)
        (site["database"].parent / "flow.env").write_text(
            f"FUMIAO_FLOW_URL={flow_url}\nFUMIAO_FLOW_PUBLIC_URL={flow_url}\nFUMIAO_FLOW_KEY=synthetic-flow\n"
        )
        with product(directory, "studio") as (browser, direct):
            ok(browser, "POST", "/api/login", json=site["login"])
            reject_contributions(browser, direct, site)
            assert old == archive_snapshot(site["database"], site)
            assert ok(browser, "GET", "/api/credits")["wallet"] == site["before"]
            assert check(browser, 200, "GET", "/media/" + site["historical_video"]).content == video
            audio_job = check_local_work(browser, site)
            flow_job = submit(browser, FLOW, "Standalone Flow HTTP only")
            cancelled_job = submit(browser, AUDIO, "Ordinary cancellation")
            ok(browser, "POST", f"/api/jobs/{cancelled_job}/cancel")

            def flow_completed():
                state = ok(browser, "GET", "/api/state")
                job = next(row for row in state["jobs"] if row["id"] == flow_job)
                assert job["status"] != "failed", job
                return job if job["status"] == "done" else None

            flow = await_value(flow_completed)
            assert flow["node"] is None
            assert check(browser, 200, "GET", "/media/" + flow["result"]).content == video
            assert len(requests) == 1 and requests[0]["stream"] is True
            assert requests[0]["messages"][0]["content"] == [{"type": "text", "text": "Standalone Flow HTTP only"}]
            credit = ok(browser, "GET", "/api/credits")
            assert credit["wallet"]["balance"] == site["before"]["balance"] - 4
            assert credit["wallet"]["reserved"] == site["before"]["reserved"]
            for job_id in (audio_job, flow_job):
                assert sorted(row["action"] for row in credit["history"] if row["job"] == job_id) == ["reserve", "spend"]
            assert sorted(row["action"] for row in credit["history"] if row["job"] == cancelled_job) == ["refund", "reserve"]
            assert old == archive_snapshot(site["database"], site)
            cookies = browser.cookies

        with product(directory, "restart", production=True) as (browser, direct):
            browser.cookies.update(cookies)
            reject_contributions(browser, direct, site)
            assert ok(browser, "GET", f"/api/canvases/{site['canvas']['id']}")["title"] == "Updated local canvas"
            assert ok(browser, "GET", "/api/credits") == credit
        assert len(requests) == 1
        assert old == archive_snapshot(site["database"], site) == archive_snapshot(site["oracle_db"], site)
    print("PASS pinned oracle, retired routes and saved credentials, archived leases and rewards, "
          "paired node and canvas, single-charge local and standalone Flow, restart")


if __name__ == "__main__":
    main()
