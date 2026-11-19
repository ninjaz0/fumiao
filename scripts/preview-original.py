"""Run the unmodified production UI and API locally before migrating interfaces.

This parity oracle defaults to its own data under .runtime-advanced/original-oracle.
Run the Studio launcher with STUDIO_BACKEND=python for product compatibility.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = ROOT / "baseline" / "production"
RUNTIME = ROOT / ".runtime-advanced" / "original-oracle"


def prepare(runtime=RUNTIME):
    manifest = json.loads((PRODUCTION / "manifest.json").read_text())
    app = runtime / "app"
    for name, expected in manifest["files"].items():
        source = PRODUCTION / name
        if not source.is_file():
            source = ROOT / "legacy" / "pure" / name
        content = source.read_bytes()
        if hashlib.sha256(content).hexdigest() != expected["sha256"]:
            raise RuntimeError(f"Production baseline mismatch: {name}")
        target = app / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    # Download-only GPU bundles remain in the original source archive.
    agent = app / "agent"
    if not agent.exists():
        agent.symlink_to(ROOT / "legacy" / "pure" / "agent", target_is_directory=True)
    return app, manifest


def main(*, runtime_directory=RUNTIME, configure=None, reuse_local_credentials=False,
         description=__doc__):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--public-url", help="Browser origin when serving behind the Next.js gateway")
    parser.add_argument("--runtime-directory", type=Path, default=runtime_directory)
    parser.add_argument("--no-reuse-local-credentials", action="store_true")
    parser.add_argument("--check", action="store_true", help="Verify all pinned runtime files without starting a server")
    args = parser.parse_args()
    runtime = args.runtime_directory.resolve()
    app, manifest = prepare(runtime)
    public_url = (args.public_url or f"http://localhost:{args.port}").rstrip("/")
    print(f"Verified {len(manifest['files'])} production runtime files ({manifest['capturedAt']})", flush=True)
    if args.check:
        return
    # Keep the original runtime isolated from Advanced and inherited provider keys.
    for key in list(os.environ):
        if key.startswith("FUMIAO_") or key == "OPENAI_API_KEY":
            del os.environ[key]
    os.environ.update({
        "FUMIAO_DATA": str(runtime / "data"),
        "FUMIAO_SITE": public_url,
        "FUMIAO_STATIC_DIR": str(app / "static"),
        "FUMIAO_MUSE_AUTOSTART": "0",
        "FUMIAO_FLOW_AUTOSTART": "0",
        "FUMIAO_PAYMENT_AUTOSTART": "0",
    })
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    if configure:
        configure(app)
    sys.path.insert(0, str(app))
    from server import app as application
    from core import db, password
    from avatars import random_avatar

    credentials_path = runtime / "credentials.json"
    with db(True) as con:
        if not con.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            credentials = {"name": "admin", "password": secrets.token_urlsafe(18)}
            # Reuse the explicitly created local preview login when available.
            advanced_credentials = ROOT / ".runtime-advanced" / "local-credentials.json"
            if (reuse_local_credentials and not args.no_reuse_local_credentials
                    and advanced_credentials.exists()):
                existing = json.loads(advanced_credentials.read_text())
                credentials["name"] = existing.get("name", existing.get("username", "admin"))
                credentials["password"] = existing["password"]
            salt = secrets.token_hex(16)
            con.execute(
                "INSERT INTO users(name,nickname,salt,pw,role,avatar) VALUES(?,?,?,?,'admin',?)",
                (credentials["name"], "本机管理员", salt, password(credentials["password"], salt), random_avatar()),
            )
            credentials_path.write_text(json.dumps(credentials, ensure_ascii=False, indent=2))
            credentials_path.chmod(0o600)
    if credentials_path.exists():
        credentials = json.loads(credentials_path.read_text())
        login_note = runtime / "登录信息.txt"
        login_note.write_text(f"原站本机基线：{public_url}/studio\n用户名：{credentials['name']}\n密码：{credentials['password']}\n")
        login_note.chmod(0o600)
    import uvicorn
    uvicorn.run(application, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
