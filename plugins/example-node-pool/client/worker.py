"""Run beside an administrator-managed ComfyUI with a trusted API workflow or compiled micro-app."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import secrets
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _encode_multipart(field_name: str, filename: str, content: bytes, content_type: str):
    boundary = "----FumiaoBoundary" + uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\n".encode(),
        (
            f'Content-Disposition: form-data; name="{field_name}"; '
            f'filename="{filename}"\r\n'
        ).encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        content,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


class ComfyWorkerController:
    """Pull worker controller with F013 cross-workflow POST /free VRAM unload protection."""

    def __init__(
        self,
        site: str,
        comfy: str,
        token: str,
        *,
        workflow_path: Path | None = None,
        prompt_node: str | None = None,
        pending_path: Path | None = None,
        poll_interval: float = 3.0,
        max_output_bytes: int = 64 * 1024 * 1024,
    ):
        self.site = site.rstrip("/")
        self.comfy = comfy.rstrip("/")
        self.token = token
        self.workflow_path = workflow_path
        self.prompt_node = prompt_node
        self.pending_path = pending_path or Path("pending.json")
        self.poll_interval = poll_interval
        self.max_output_bytes = max_output_bytes
        self.loaded_model_key: str | None = None
        self.unload_count: int = 0

    def call(self, url: str, payload=None, *, ticket="", result=None, prompt_id=""):
        headers = {}
        if url.startswith(self.site + "/"):
            headers["Authorization"] = "Bearer " + self.token
        if ticket:
            headers["X-Job-Ticket"] = ticket
        if result is None:
            body = None if payload is None else json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
            method = "GET" if body is None else "POST"
        else:
            body, method = result, "PUT"
            headers.update(
                {
                    "X-Sha256": hashlib.sha256(body).hexdigest(),
                    "X-Job-Timing": json.dumps({"prompt_id": prompt_id}),
                }
            )
        with urlopen(
            Request(url, data=body, headers=headers, method=method), timeout=45
        ) as response:
            raw = response.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))

    def heartbeat(self, stage: str, ticket: str = ""):
        caps: dict[str, object] = {"ready": True}
        if self.loaded_model_key:
            caps["loaded_model_key"] = self.loaded_model_key
        return self.call(
            self.site + "/heartbeat",
            {"stage": stage, "capabilities": caps, "ticket": ticket},
        )

    def maybe_unload_vram(self, target_model_key: str | None) -> bool:
        """F013: Unload ComfyUI VRAM via POST /free when switching between distinct model workflows."""
        if not target_model_key:
            return False
        if self.loaded_model_key is not None and self.loaded_model_key != target_model_key:
            self.call(
                self.comfy + "/free",
                {"unload_models": True, "free_memory": True},
            )
            self.unload_count += 1
            return True
        return False

    def _upload_media_to_comfy(self, filename: str, data: bytes) -> str:
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        body, ctype = _encode_multipart("image", filename, data, content_type)
        req = Request(
            self.comfy + "/upload/image",
            data=body,
            headers={"Content-Type": ctype},
            method="POST",
        )
        with urlopen(req, timeout=45) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
        return str(parsed.get("name") or filename)

    def _fetch_job_asset(self, job_id: str, ticket: str, asset_key: str) -> bytes:
        url = f"{self.site}/jobs/{job_id}/assets/{asset_key}"
        req = Request(
            url,
            headers={
                "Authorization": "Bearer " + self.token,
                "X-Job-Ticket": ticket,
            },
            method="GET",
        )
        with urlopen(req, timeout=45) as resp:
            return resp.read(self.max_output_bytes + 1)

    def _build_graph(self, job: dict) -> tuple[dict, str | None]:
        instruction = job.get("instruction") or {}
        target_key = instruction.get("modelKey") or job.get("model")
        if isinstance(instruction.get("workflow"), dict):
            graph = json.loads(json.dumps(instruction["workflow"]))
        else:
            if not self.workflow_path or not self.prompt_node:
                raise RuntimeError("未配置静态工作流且任务未携带动态工作流")
            graph = json.loads(self.workflow_path.read_text())
            graph[self.prompt_node]["inputs"]["text"] = instruction.get("prompt", "")

        for upload in instruction.get("mediaUploads") or []:
            asset_key = upload.get("asset")
            node_id = str(upload.get("nodeId") or "")
            input_key = str(upload.get("inputKey") or "")
            if not (asset_key and node_id in graph and input_key):
                continue
            raw_bytes = self._fetch_job_asset(str(job["id"]), job["ticket"], str(asset_key))
            ext = ".mp4" if upload.get("kind") == "video" else ".wav" if upload.get("kind") == "audio" else ".png"
            uploaded_name = self._upload_media_to_comfy(f"{asset_key}{ext}", raw_bytes)
            graph[node_id]["inputs"][input_key] = uploaded_name
        return graph, (str(target_key) if target_key else None)

    def _pick_output_item(self, history: dict) -> dict:
        outputs = history.get("outputs") or {}
        for key in ("videos", "gifs", "audio", "images"):
            for node in outputs.values():
                for item in node.get(key, []):
                    if item.get("type", "output") == "output" and item.get("filename"):
                        return item
        raise StopIteration("ComfyUI 未返回任何输出文件")

    def generate(self, job: dict):
        ticket = job["ticket"]
        graph, target_key = self._build_graph(job)

        # Keep a receipt across poll retries so an upload timeout does not start
        # another expensive ComfyUI generation for the same assignment.
        saved = (
            json.loads(self.pending_path.read_text())
            if self.pending_path.exists()
            else {}
        )
        if saved.get("ticket") == ticket:
            prompt_id = saved["prompt_id"]
        else:
            # F013: Cross-workflow model switch triggers POST /free before /prompt.
            self.maybe_unload_vram(target_key)
            prompt_id = self.call(self.comfy + "/prompt", {"prompt": graph})["prompt_id"]
            if target_key:
                self.loaded_model_key = target_key
            staged = self.pending_path.with_suffix(".tmp")
            staged.write_text(json.dumps({"ticket": ticket, "prompt_id": prompt_id}))
            staged.replace(self.pending_path)

        while self.heartbeat("busy", ticket).get("held"):
            history = self.call(self.comfy + "/history/" + prompt_id).get(prompt_id)
            if history:
                if history.get("status", {}).get("status_str") == "error":
                    raise RuntimeError("ComfyUI 工作流失败")
                output_item = self._pick_output_item(history)
                query = urlencode(
                    {
                        k: v
                        for k, v in output_item.items()
                        if k in ("filename", "subfolder", "type") and v is not None
                    }
                )
                with urlopen(self.comfy + "/view?" + query, timeout=45) as response:
                    data = response.read(self.max_output_bytes + 1)
                if len(data) > self.max_output_bytes:
                    raise ValueError("ComfyUI 输出文件超过大小上限")
                self.call(
                    self.site + "/jobs/" + str(job["id"]) + "/result",
                    ticket=ticket,
                    result=data,
                    prompt_id=prompt_id,
                )
                self.pending_path.unlink(missing_ok=True)
                return
            if self.poll_interval > 0:
                time.sleep(self.poll_interval)

    def poll_once(self) -> bool:
        self.heartbeat("ready")
        job = self.call(self.site + "/claim", {}).get("job")
        if not job:
            return False
        try:
            self.generate(job)
        except HTTPError as error:
            if error.code not in (400, 413, 422):
                raise
            self.call(
                self.site + "/jobs/" + str(job["id"]) + "/error",
                {"stage": "error", "detail": "工作流或成片未通过校验"},
                ticket=job["ticket"],
            )
        except (RuntimeError, StopIteration, KeyError, ValueError):
            self.call(
                self.site + "/jobs/" + str(job["id"]) + "/error",
                {"stage": "error", "detail": "ComfyUI 生成失败"},
                ticket=job["ticket"],
            )
        return True


def _main():
    plugin_id = os.environ.get("FUMIAO_PLUGIN_ID", "example-node-pool")
    site = os.environ["FUMIAO_SITE"].rstrip("/") + "/agent/" + plugin_id
    comfy = os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
    credential = Path("credential")
    if not credential.exists():
        with open(
            credential, "x", opener=lambda path, flags: os.open(path, flags, 0o600)
        ) as out:
            out.write(secrets.token_urlsafe(32))
    token = credential.read_text()
    wf_path = Path("workflow.json") if Path("workflow.json").exists() else None
    prompt_node = os.environ.get("COMFY_PROMPT_NODE")
    controller = ComfyWorkerController(
        site, comfy, token, workflow_path=wf_path, prompt_node=prompt_node
    )
    if len(sys.argv) > 1:
        controller.call(site + "/enroll", {"secret": token, "code": sys.argv[1]})
    if wf_path and prompt_node:
        json.loads(wf_path.read_text())[prompt_node]["inputs"]["text"]
    while True:
        try:
            controller.poll_once()
        except HTTPError as error:
            if error.code in (401, 403):
                raise
            print("服务返回 HTTP", error.code, flush=True)
        except (URLError, TimeoutError) as error:
            print("连接中断，将重试", type(error).__name__, flush=True)
        time.sleep(3)


if __name__ == "__main__":
    _main()
