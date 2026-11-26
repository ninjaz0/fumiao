"""Build the distributable from the reviewed client source, deterministically."""
import gzip
import hashlib
import io
import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
archive = io.BytesIO()
with gzip.GzipFile(fileobj=archive, mode="wb", mtime=0) as zipped:
    with tarfile.open(fileobj=zipped, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        source = (root / "client" / "worker.py").read_bytes()
        member = tarfile.TarInfo("worker.py")
        member.size = len(source)
        tar.addfile(member, io.BytesIO(source))
data = archive.getvalue()
(root / "distribution" / "agent.tgz").write_bytes(data)
(root / "distribution" / "agent.tgz.sha256").write_text(hashlib.sha256(data).hexdigest() + "  agent.tgz\n")
