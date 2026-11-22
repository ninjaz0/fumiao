"""Package the GPU runtime with the namespaced wire protocol. Keep the published
1.x distribution byte-for-byte available to the old installer and stored jobs."""
import base64
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import Path

distribution = Path(__file__).resolve().parents[1] / "distribution"
buffer = io.BytesIO()
with tarfile.open(distribution / "agent.tgz") as source, tarfile.open(fileobj=buffer, mode="w") as target:
    for entry in source:
        reader = source.extractfile(entry) if entry.isfile() else None
        if entry.name in ("concurrent_node.py", "worker.py"):
            data = reader.read().decode().replace("/agent/", "/agent/gpu/")
            if entry.name == "worker.py":
                heartbeat = '    answer = api("/agent/gpu/heartbeat", body)'
                assert data.count(heartbeat) == 1
                data = data.replace(heartbeat, '    body["capabilities"] = {k: body.get(k) for k in ("ready_models", "lane_model", "profile", "execution_plan")}\n    body["capabilities"]["video_steps"] = body.pop("video_steps")\n' + heartbeat)
                claim = 'j = api("/agent/gpu/claim")["job"]'
                assert data.count(claim) == 1
                data = data.replace(claim, claim + '\n                if j:\n                    j = dict(j["instruction"], id=j["id"], ticket=j["ticket"])')
            compile(data, entry.name, "exec")
            raw = data.encode()
            entry.size = len(raw)
            reader = io.BytesIO(raw)
        target.addfile(entry, reader)
archive_buffer = io.BytesIO()
with gzip.GzipFile(fileobj=archive_buffer, mode="wb", compresslevel=9, mtime=0) as compressor:
    compressor.write(buffer.getvalue())
archive = archive_buffer.getvalue()
files = {
    "agent.tgz": archive,
    "agent.tgz.sha256": (hashlib.sha256(archive).hexdigest() + "  agent.tgz\n").encode(),
    "install.sh": (distribution / "install.sh").read_bytes().replace(b"$site/connect/agent.tgz", b"$site/agent/gpu/client/agent.tgz"),
}
print(json.dumps({name: base64.b64encode(data).decode() for name,data in files.items()}))
