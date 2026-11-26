"""Pull and complete sample image jobs using only the Python standard library."""
import hashlib
import json
import os
import secrets
import struct
import sys
import time
import zlib
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class DirectRequests(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def render(prompt):
    """Replace this function with your model runner."""
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind + data
            + struct.pack(">I", zlib.crc32(kind + data))
        )

    color = hashlib.sha256(prompt.encode()).digest()[:3]
    scanline = b"\0" + color * 64
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">2I5B", 64, 64, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanline * 64))
        + chunk(b"IEND", b"")
    )


def main():
    site = os.environ["FUMIAO_SITE"].rstrip("/") + "/agent/starter-node-pool"
    credential = Path("credential")
    if not credential.exists():
        with open(credential, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as out:
            out.write(secrets.token_urlsafe(32))
    token = credential.read_text()
    client = build_opener(DirectRequests())

    def request(path, data, *, artifact=None, ticket=None):
        headers = {"Authorization": "Bearer " + token}
        if ticket:
            headers["X-Job-Ticket"] = ticket
        if artifact is None:
            headers["Content-Type"] = "application/json"
            method, body = "POST", json.dumps(data).encode()
        else:
            headers["Content-Type"] = "image/png"
            headers["X-Sha256"] = hashlib.sha256(artifact).hexdigest()
            headers["X-Job-Timing"] = json.dumps(data)
            method, body = "PUT", artifact
        outgoing = Request(site + path, data=body, headers=headers, method=method)
        with client.open(outgoing, timeout=30) as response:
            return json.load(response)

    if len(sys.argv) > 1:
        request("/enroll", {"secret": token, "code": sys.argv[1]})
    while True:
        try:
            request("/heartbeat", {"stage": "ready", "capabilities": {"ready": True}})
            job = request("/claim", {}).get("job")
            if job:
                artifact = render(job["instruction"]["prompt"])
                request(
                    f"/jobs/{job['id']}/result",
                    {"prompt_id": str(job["id"])},
                    artifact=artifact,
                    ticket=job["ticket"],
                )
        except HTTPError as error:
            if error.code in (401, 403):
                raise
            print("服务返回 HTTP", error.code, flush=True)
        except (URLError, TimeoutError):
            print("连接中断，将重试", flush=True)
        time.sleep(3)


if __name__ == "__main__":
    main()
