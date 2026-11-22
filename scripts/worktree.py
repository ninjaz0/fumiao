#!/usr/bin/env python3
"""Run a private Docker Compose Studio for the current Git checkout."""
import argparse
import base64
import fcntl
import hashlib
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile


def write_private(path, text):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as out:
        out.write(text)
    os.replace(out.name, path)


def available_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["up", "status", "logs", "down"])
    parser.add_argument("service", nargs="?", choices=["web", "api", "worker", "postgres", "redis"])
    args = parser.parse_args()
    if args.service and args.action != "logs":
        parser.error("a service is only valid for logs")
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()).resolve()
    if not (root / "compose.dev.yaml").is_file():
        parser.error("run inside a Fumiao checkout")
    project = "fumiao-wt-" + hashlib.sha256(os.fsencode(root)).hexdigest()[:12]
    state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "fumiao" / project
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    config = state / "services.env"
    password = state / "admin-password"
    # Whitelist Docker client settings. Shell/.env values must not select a
    # different database, S3 bucket, port or Compose configuration.
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "TMPDIR", "SSH_AUTH_SOCK")
           or k.startswith("DOCKER_")}
    env["FUMIAO_SERVICE_ENV"] = str(config.resolve())
    base = ["docker", "compose", "-p", project, "--env-file", str(config.resolve()),
            "-f", "compose.yaml", "-f", "compose.dev.yaml"]

    def compose(*arguments, capture=False, extra=None):
        return subprocess.run([*base, *arguments], cwd=root, env={**env, **(extra or {})},
                              check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout

    with (state / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not config.exists():
            if args.action != "up":
                parser.exit(message=f"{project} has not been started.\n")
            key = base64.b64encode(secrets.token_bytes(32)).decode()
            port = available_port()
            write_private(config, f"POSTGRES_PASSWORD={secrets.token_hex(24)}\nENCRYPTION_KEY={key}\n"
                          f"FUMIAO_WEB_PORT={port}\nPUBLIC_URL=http://{project}.localhost:{port}\n")
        settings = dict(line.split("=", 1) for line in config.read_text().splitlines())
        url = settings["PUBLIC_URL"]
        if args.action == "up":
            # Docker owns the final bind. If an old port was taken during
            # downtime, allocate another while keeping the same data and keys.
            bound = compose("ps", "--status", "running", "-q", "web", capture=True).strip()
            if not bound:
                with socket.socket() as probe:
                    try:
                        probe.bind(("127.0.0.1", int(settings["FUMIAO_WEB_PORT"])))
                    except OSError:
                        port = available_port()
                        url = f"http://{project}.localhost:{port}"
                        settings.update(FUMIAO_WEB_PORT=str(port), PUBLIC_URL=url)
                        write_private(config, "".join(f"{k}={v}\n" for k, v in settings.items()))
            if not password.exists():
                write_private(password, secrets.token_urlsafe(24) + "\n")
            compose("build", "migrate")
            compose("up", "-d", "--wait", "postgres", "redis")
            compose("run", "--rm", "--no-deps", "migrate")
            initialized = compose("exec", "-T", "postgres", "psql", "-U", "fumiao", "-d", "fumiao",
                                  "-Atc", "SELECT EXISTS(SELECT 1 FROM users)", capture=True).strip()
            if initialized == "f":
                compose("run", "--rm", "--no-deps", "-e", "ADMIN_PASSWORD", "migrate", "pnpm", "bootstrap",
                        extra={"ADMIN_PASSWORD": password.read_text().strip()})
            for services in (("api",), ("worker", "web")):
                compose("up", "-d", "--no-build", "--no-deps", "--renew-anon-volumes", "--wait", *services)
        elif args.action == "down":
            compose("down")
            return
        elif args.action == "logs":
            compose("logs", "--tail", "150", *([args.service] if args.service else []))
            return
        else:
            compose("ps", "-a")
        print(f"{project}  {url}/studio\nLocal admin password file: {password}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode)
