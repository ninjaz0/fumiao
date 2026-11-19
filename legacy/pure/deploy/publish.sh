#!/usr/bin/env bash
# Update the existing Tencent installation via an SSH alias (or user@host).
set -euo pipefail
if [ "$#" != 1 ]; then echo "Usage: bash deploy/publish.sh SSH_TARGET"; exit 2; fi
cd "$(dirname "$0")/.."
bash agent/build.sh
# Only public program files enter the release. Data and activation links stay private.
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/agent" "$stage/deploy"
cp core.py model_policy.py muse_provider.py workspace_access.py workspace_api.py server.py image_imports.py generation.py canvas_api.py worker_api.py timing.py library_api.py image_api.py profiles.py avatars.py bootstrap_admin.py storage.py requirements.txt "$stage/"
cp -R static "$stage/"
cp agent/install.sh agent/agent.tgz agent/agent.tgz.sha256 "$stage/agent/"
cp agent/vendor/runtime/comfy.git.tgz "$stage/agent/comfy-651ca296.tgz"
cp deploy/nvmes.caddy deploy/fumiao.service "$stage/deploy/"
COPYFILE_DISABLE=1 tar -C "$stage" -czf - . | ssh "$1" 'set -eu; d=$(mktemp -d); trap '\''rm -rf -- "$d"'\'' EXIT; tar -xzf - -C "$d"; (cd "$d/agent" && sha256sum -c agent.tgz.sha256); sudo -n /srv/fumiao/venv/bin/pip install -q -r "$d/requirements.txt"; sudo -n cp -R "$d/." /srv/fumiao/app/; sudo -n chmod -R a+rX /srv/fumiao/app; sudo -n install -m644 "$d/deploy/fumiao.service" /etc/systemd/system/fumiao.service; sudo -n install -m644 "$d/deploy/nvmes.caddy" /etc/caddy/sites-enabled/nvmes.caddy; sudo -n caddy validate --config /etc/caddy/Caddyfile; sudo -n systemctl daemon-reload; sudo -n systemctl restart fumiao; sudo -n systemctl reload caddy; curl --retry 4 --retry-connrefused -fsS http://127.0.0.1:18732/health'
