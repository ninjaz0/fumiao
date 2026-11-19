"""Outbound-only Fumiao worker. Starts heartbeat before model installation/download.

The Mac can close: the cloud worker owns idle detection and runtime release.
Task delivery is retained locally and retried with the platform's receipt protocol.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
ENGINE_REVISION = "fdad57bd94d3fbac8a72c44920dd0a23b719ebb9"
STEPS = [16, 20, 32, 50]


def save(path, obj):
    temp = Path(path).with_suffix(".new")
    temp.write_text(json.dumps(obj)); temp.chmod(0o600); temp.replace(path)


class LeaseLost(Exception): pass


class Worker:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.config = json.loads((self.root / "config.json").read_text())
        if self.config["site"] != "https://nvmes.com":
            raise ValueError("Unknown Fumiao server")
        self.site = self.config["site"]
        self.credential = self.root / "credential"
        if not self.credential.exists():
            self.credential.write_text(secrets.token_urlsafe(42)); self.credential.chmod(0o600)
        self.secret = self.credential.read_text().strip()
        self.stage, self.detail = "preparing", "正在安装 MiniMax H3 运行环境"
        self.job = None
        self.ready = False
        self.control = "active"
        self.lost = threading.Event()
        self.closed = threading.Event()
        self.last_work = time.monotonic()
        self.last_contact = time.monotonic()
        self.runtime_id = secrets.token_hex(12)
        self.step = None
        self.uploading = False
        self.lock = threading.RLock()
        self.release_pending = False
        self.booted = time.monotonic()

    def api(self, path, data=None, method="POST", raw=None):
        headers = {"Authorization": "Bearer " + self.secret, "User-Agent": "FumiaoColab-Worker/1.0"}
        if self.job:
            headers["X-Job-Ticket"] = self.job["ticket"]
        if raw is not None:
            headers.update({"Content-Type": "video/mp4", "X-SHA256": hashlib.sha256(raw).hexdigest(),
                "X-Job-Timing": json.dumps({"sampling_steps": self.job["sampling_steps"], "fast_mode": False})})
            body = raw
        else:
            headers["Content-Type"] = "application/json"
            body = None if method == "GET" else json.dumps(data or {}).encode()
        req = urllib.request.Request(self.site + path, data=body, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=180 if raw is not None else 35) as response:
            value = response.read()
            self.last_contact = time.monotonic()
            return value if "/ref/" in path else json.loads(value)

    def enroll(self):
        if "code" in self.config:
            result = self.api("/agent/enroll", {"code": self.config["code"], "secret": self.secret})
            if result.get("models") != ["MiniMax H3"]:
                raise ValueError("配对模型与 MiniMax H3 不一致")
            self.config.pop("code")
            save(self.root / "config.json", self.config)
        else:
            self.api("/agent/registration", method="GET")

    def heartbeat(self):
        with self.lock:
            job = self.job
            body = {"stage": self.stage, "detail": self.detail[:300], "ticket": job["ticket"] if job else "",
                "hardware": "Google Colab · MiniMax H3 BF16", "workflow": "fumiao-diffsynth-h3-bf16-v1",
                "runtime_id": self.runtime_id, "ready_models": ["MiniMax H3"] if self.ready else [], "video_steps": STEPS}
            if job:
                body["uploading"] = self.uploading
                if self.step is not None: body.update(step=self.step, steps=job["sampling_steps"])
            result = self.api("/agent/heartbeat", body)
            self.control = result["control"]
            if job and not result.get("held"):
                self.lost.set()
        if self.control == "removed":
            self.release()

    def report(self, detail):
        self.detail = detail
        print(detail, flush=True)

    def ticker(self):
        while not self.closed.wait(12):
            if self.release_pending:
                self.release()
                continue
            try: self.heartbeat()
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    self.lost.set(); self.release()
            except (OSError, ValueError): pass
            # A prolonged server outage cannot leave a forgotten GPU running forever.
            if self.ready and not self.job and time.monotonic() - self.last_contact > 600:
                self.report("无法连接弗淼，正在释放闲置实例")
                self.release()

    def watchdog(self):
        # A stalled installer cannot consume credits indefinitely, even before enrollment.
        while not self.closed.wait(30):
            if self.release_pending or (not self.ready and time.monotonic() - self.booted > 7200):
                self.report("部署未完成，正在释放实例")
                self.release()

    def install(self):
        engine = self.root / "DiffSynth-Studio"
        if not engine.exists():
            subprocess.run(["git", "clone", "--filter=blob:none", "https://github.com/modelscope/DiffSynth-Studio.git", str(engine)], check=True)
        subprocess.run(["git", "-C", str(engine), "checkout", "--detach", ENGINE_REVISION], check=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q",
            "-e", str(engine), "accelerate", "huggingface_hub", "av", "imageio", "imageio-ffmpeg", "scipy", "soundfile", "librosa"], check=True)
        if not shutil.which("ffmpeg"):
            subprocess.run(["apt-get", "update", "-qq"], check=True)
            subprocess.run(["apt-get", "install", "-y", "-qq", "ffmpeg"], check=True)
        if (self.root / "rclone.conf").exists() and not shutil.which("rclone"):
            # Optional Drive cache; package failure does not stop H3 deployment.
            subprocess.run(["apt-get", "update", "-qq"], check=False)
            subprocess.run(["apt-get", "install", "-y", "-qq", "rclone"], check=False)
        # Editable install happened in this process: load the new package path explicitly.
        sys.path.insert(0, str(engine))

    def idle_minutes(self):
        try: value = json.loads((self.root / "idle.json").read_text())["minutes"]
        except (OSError, ValueError, KeyError): value = self.config.get("idle_minutes", 30)
        return value if value in (0, 15, 30, 60) else 30

    def release(self):
        self.release_pending = True
        self.closed.set()
        try:
            from google.colab import runtime
            runtime.unassign()
        except Exception:
            self.closed.clear()
            self.stage = "error"; self.detail = "自动释放未成功，请在 FumiaoColab 手动释放实例"

    def progress(self, step, total):
        if self.lost.is_set() or self.closed.is_set(): raise LeaseLost()
        self.step = step

    def deliver(self, job, output):
        self.uploading = True
        self.detail = "正在回传成片到弗淼 AIGC"
        for _ in range(30):
            if self.lost.is_set(): raise LeaseLost()
            try:
                receipt = self.api(f"/agent/jobs/{job['id']}/receipt", method="GET")
                if receipt.get("delivered"): return
                self.api(f"/agent/jobs/{job['id']}/result", method="PUT", raw=output.read_bytes())
                return
            except urllib.error.HTTPError as exc:
                if exc.code == 409: raise LeaseLost() from exc
                if exc.code < 500 and exc.code != 429: raise
            except OSError: pass
            self.closed.wait(10)
        raise OSError("成片回传超时")

    def run_job(self, engine, job):
        directory = self.root / "jobs" / str(job["id"])
        directory.mkdir(parents=True, exist_ok=True)
        self.job = job; self.stage = "busy"; self.lost.clear(); self.uploading = False; self.step = None
        save(directory / "job.json", job)
        output = directory / "result.mp4"
        try:
            # Resume only a finished, atomic output; partial encoder output is never reused.
            if not output.exists():
                refs = []
                for index, key in enumerate(job["refs"]):
                    path = directory / f"ref-{index}.img"
                    path.write_bytes(self.api(f"/agent/jobs/{job['id']}/ref/{key}", method="GET")); refs.append(path)
                target = directory / "rendering.mp4"
                engine.render(job, refs, target, self.progress)
                target.replace(output)
            self.deliver(job, output)
            shutil.rmtree(directory)
        except LeaseLost:
            shutil.rmtree(directory, ignore_errors=True)
        except Exception as exc:
            self.report("任务未完成：" + type(exc).__name__)
            try:
                self.api(f"/agent/jobs/{job['id']}/error", {"stage": "error", "detail": "MiniMax H3 执行失败：" + type(exc).__name__})
            except OSError: pass
        finally:
            with self.lock:
                self.job = None; self.stage = "ready"; self.detail = "等待弗淼任务"; self.step = None
                self.last_work = time.monotonic(); self.uploading = False

    def run(self):
        threading.Thread(target=self.watchdog, daemon=True).start()
        try:
            self.enroll()
            self.heartbeat()
            threading.Thread(target=self.ticker, daemon=True).start()
            self.install()
            from h3_engine import Engine
            engine = Engine(self.root, self.report)
            engine.load()
            self.ready = True; self.stage = "ready"; self.detail = "等待弗淼任务"; self.last_work = time.monotonic()
            self.heartbeat()
            while not self.closed.is_set():
                if self.control == "active":
                    try: job = self.api("/agent/claim").get("job")
                    except OSError:
                        self.closed.wait(8); continue
                    if job:
                        self.run_job(engine, job)
                        self.heartbeat()
                        continue
                minutes = self.idle_minutes()
                if minutes and time.monotonic() - self.last_work >= minutes * 60:
                    self.report("闲置时间已到，正在释放实例")
                    self.release()
                self.closed.wait(5)
        except Exception as exc:
            self.stage = "error"; self.detail = "部署未完成（" + type(exc).__name__ + "），正在释放实例"
            try: self.heartbeat()
            except Exception: pass
            self.release()
            while not self.closed.wait(30):
                self.release()


if __name__ == "__main__":
    os.umask(0o077)
    Worker().run()
