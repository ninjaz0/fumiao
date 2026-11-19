"""Regressions for measured install progress and terminal completion."""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agent"))
from install_progress import InstallProgress, follow


def main():
    lock = ROOT / "agent/vendor/engine/assets/models.lock.json"
    model_script = ROOT / "agent/vendor/engine/scripts/models.py"
    spec = importlib.util.spec_from_file_location("fixture_models", model_script)
    models = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(models)
    with tempfile.TemporaryDirectory() as d:
        base = Path(d)
        filename = "minimax_h3_fl2va_pruned_bf16.safetensors"
        p = InstallProgress(base, lock, "test-run")
        p.read_line("FM_STAGE 安装 Python 依赖")
        assert p.message == "安装 Python 依赖"
        p.read_line("Fetching diffusion_models/" + filename)
        p.read_line(filename + ":  42%|████▏| 16.9G/40.2G [01:30<2:00, 189MB/s]")
        assert "下载文生视频模型 42%" in p.message
        p.read_line("different.file: 99%|")
        assert "42%" in p.message
        p.read_line("FM_VERIFY " + filename)
        p.read_line("FM_HASH 32")
        assert "校验文生视频模型 32%" in p.message
        p.read_line("Verified download diffusion_models/" + filename)
        p.read_line("Verified existing diffusion_models/" + filename)
        assert "1/6" in p.message
        # Exercise the actual cache/verify helper with a small real file.
        payload = b"valid weight test data"
        target = base / "models" / filename
        target.parent.mkdir()
        target.write_bytes(payload)
        fixture = base / "lock.json"
        fixture.write_text(
            json.dumps(
                {
                    "files": [
                        {
                            "path": filename,
                            "bytes": len(payload),
                            "sha256": hashlib.sha256(payload).hexdigest(),
                            "modes": ["t2v"],
                        }
                    ]
                }
            )
        )
        out = io.StringIO()
        with (
            patch.object(models, "LOCK", fixture),
            patch.object(
                sys, "argv", ["models.py", "both", "--action", "verify", "--cache", d]
            ),
            contextlib.redirect_stdout(out),
        ):
            models.main()
        assert (
            "FM_VERIFY " + filename in out.getvalue()
            and "Verified existing " + filename in out.getvalue()
        )
        for state, code in [("ready", 0), ("error", 1)]:
            p.update(state, state)
            with contextlib.redirect_stdout(io.StringIO()):
                assert follow(p.path, "test-run", os.getpid()) == code
        with contextlib.redirect_stdout(io.StringIO()):
            assert follow(p.path, "other-run", 99999999) == 1
    print(
        "PASS SDK percentages, checksum stages, cache reuse, stale run rejection, terminal success and failure"
    )


if __name__ == "__main__":
    main()
