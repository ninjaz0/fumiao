#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${FUMIAO_SITE:?缺少工作台地址}" "${COMFY_WORKFLOW:?请设置 ComfyUI API 格式的工作流文件路径}"
: "${COMFY_PROMPT_NODE:?请设置工作流文本输入节点 ID}"
root=${FUMIAO_NODE_HOME:-"$HOME/.local/share/fumiao-comfy"}
mkdir -p "$root"
if command -v flock >/dev/null; then
  exec 9>"$root/worker.lock"
  flock -n 9 || { echo "此工作目录已有运行中的节点" >&2; exit 1; }
fi
stage=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
base="$FUMIAO_SITE/agent/example-node-pool/client"
curl -fsSL "$base/agent.tgz" -o "$stage/agent.tgz"
curl -fsSL "$base/agent.tgz.sha256" -o "$stage/digest"
(cd "$stage" && sha256sum -c digest && tar xzf agent.tgz worker.py)
cp "$COMFY_WORKFLOW" "$root/workflow.json"
install -m 600 "$stage/worker.py" "$root/worker.py"
cd "$root"
python3 worker.py "${2:?缺少配对码}"
