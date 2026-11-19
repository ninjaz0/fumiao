"""Fetch or audit the exact Comfy-Org model files used by each workflow."""

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "assets/models.lock.json"


def digest(path):
    hasher = hashlib.sha256()
    size = path.stat().st_size
    processed = 0
    last = time.monotonic()
    print("FM_VERIFY", path.name, flush=True)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(16 << 20), b""):
            hasher.update(block)
            processed += len(block)
            if size and time.monotonic() - last >= 3:
                print("FM_HASH", processed * 100 // size, flush=True)
                last = time.monotonic()
    return hasher.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["t2v", "r2v", "both"])
    parser.add_argument("--action", choices=["plan", "fetch", "verify"], default="plan")
    parser.add_argument(
        "--cache", type=Path, default=Path(os.getenv("H3_CACHE", "/opt/ms-minimax-h3"))
    )
    args = parser.parse_args()
    lock = json.loads(LOCK.read_text())
    entries = [
        f for f in lock["files"]
        if (args.mode == "both" or args.mode in f["modes"])
        and (not f.get("requires_env") or os.getenv(f["requires_env"]) == "1")
    ]
    target = args.cache.resolve() / "models"
    print(
        f"{args.mode}: {len(entries)} files, {sum(f['bytes'] for f in entries) / 1e9:.2f} GB -> {target}",
        flush=True,
    )
    for entry in entries:
        print(f"  {entry['bytes'] / 1e9:7.2f} GB  {entry['path']}", flush=True)
    if args.action == "plan":
        return

    if args.action == 'fetch':
        for parent in (ROOT.parent,ROOT.parent.parent):
            if (parent/'cache_manager.py').exists():sys.path.insert(0,str(parent));break
        os.environ['H3_CACHE']=str(args.cache)
        from cache_manager import ensure_model
        ensure_model('MiniMax H3',lambda message:print('FM_STAGE '+message,flush=True),paths={e['path'] for e in entries})
        return

    missing = []
    for entry in entries:
        path = target / entry["path"]
        if not path.exists():
            missing.append(entry)
        elif path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
            raise SystemExit(
                f"Unexpected size/hash: {path}. Inspect and quarantine this file before retrying."
            )
        else:
            print("Verified existing", entry["path"], flush=True)
    if missing and args.action == "verify":
        raise SystemExit("Missing: " + ", ".join(f["path"] for f in missing))



if __name__ == "__main__":
    main()
