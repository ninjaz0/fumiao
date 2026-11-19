#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends python3.12 python3.12-venv python3-pip git curl ffmpeg ca-certificates xz-utils
mkdir -p /opt/fmworker
python3.12 -m venv /opt/fmworker/venv
chmod 700 /opt/fmworker
