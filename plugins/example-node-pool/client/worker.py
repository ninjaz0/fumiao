"""Run beside an administrator-managed ComfyUI with a trusted API workflow."""
import hashlib
import json
import os
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

site = os.environ["FUMIAO_SITE"].rstrip("/") + "/agent/example-node-pool"
comfy = os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
credential = Path("credential")
if not credential.exists():
    with open(credential, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as out:
        out.write(secrets.token_urlsafe(32))
token = credential.read_text()
workflow = Path("workflow.json").read_text()


def call(url, payload=None, *, ticket="", result=None, prompt_id=""):
    headers = {}
    if url.startswith(site + "/"):
        headers["Authorization"] = "Bearer " + token
    if ticket:
        headers["X-Job-Ticket"] = ticket
    if result is None:
        body = None if payload is None else json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
        method = "GET" if body is None else "POST"
    else:
        body, method = result, "PUT"
        headers.update({"X-Sha256": hashlib.sha256(body).hexdigest(),
                        "X-Job-Timing": json.dumps({"prompt_id": prompt_id})})
    with urlopen(Request(url, data=body, headers=headers, method=method), timeout=45) as response:
        return json.load(response)


def heartbeat(stage, ticket=""):
    return call(site + "/heartbeat", {"stage": stage, "capabilities": {"ready": True},
                                      "ticket": ticket})


def generate(job):
    ticket = job["ticket"]
    graph = json.loads(workflow)
    prompt_input = os.environ["COMFY_PROMPT_NODE"]
    graph[prompt_input]["inputs"]["text"] = job["instruction"]["prompt"]
    # Keep a receipt across poll retries so an upload timeout does not start
    # another expensive ComfyUI generation for the same assignment.
    pending = Path("pending.json")
    saved = json.loads(pending.read_text()) if pending.exists() else {}
    if saved.get("ticket") == ticket:
        prompt_id = saved["prompt_id"]
    else:
        prompt_id = call(comfy + "/prompt", {"prompt": graph})["prompt_id"]
        staged = pending.with_suffix(".tmp")
        staged.write_text(json.dumps({"ticket": ticket, "prompt_id": prompt_id}))
        staged.replace(pending)
    while heartbeat("busy", ticket)["held"]:
        history = call(comfy + "/history/" + prompt_id).get(prompt_id)
        if history:
            if history.get("status", {}).get("status_str") == "error":
                raise RuntimeError("ComfyUI 工作流失败")
            image = next(img for node in history["outputs"].values()
                         for img in node.get("images", []) if img["type"] == "output")
            with urlopen(comfy + "/view?" + urlencode(image), timeout=45) as response:
                data = response.read(32 * 1024 * 1024 + 1)
            if len(data) > 32 * 1024 * 1024:
                raise ValueError("ComfyUI 图像超过大小上限")
            call(site + "/jobs/" + str(job["id"]) + "/result", ticket=ticket,
                 result=data, prompt_id=prompt_id)
            pending.unlink(missing_ok=True)
            return
        time.sleep(3)


def poll():
    heartbeat("ready")
    job = call(site + "/claim", {}).get("job")
    if job:
        try:
            generate(job)
        except HTTPError as error:
            if error.code not in (400, 413, 422):
                raise
            call(site + "/jobs/" + str(job["id"]) + "/error",
                 {"stage": "error", "detail": "工作流或成片未通过校验"}, ticket=job["ticket"])
        except (RuntimeError, StopIteration, KeyError, ValueError):
            call(site + "/jobs/" + str(job["id"]) + "/error",
                 {"stage": "error", "detail": "ComfyUI 生成失败"}, ticket=job["ticket"])


if __name__ == "__main__":
    if len(sys.argv) > 1:
        call(site + "/enroll", {"secret": token, "code": sys.argv[1]})
    # Validate local configuration before advertising readiness.
    json.loads(workflow)[os.environ["COMFY_PROMPT_NODE"]]["inputs"]["text"]
    while True:
        try:
            poll()
        except HTTPError as error:
            if error.code in (401, 403):
                raise
            print("服务返回 HTTP", error.code, flush=True)
        except (URLError, TimeoutError) as error:
            print("连接中断，将重试", type(error).__name__, flush=True)
        time.sleep(3)
