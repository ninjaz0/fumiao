#!/usr/bin/env bash
# Run on the Linux DSW-AMD instance from a checkout on persistent storage.
set -euo pipefail
if [[ $# != 1 || ! "$1" =~ ^(t2v|r2v|both)$ ]]; then
  echo "Usage: bash scripts/restore.sh {t2v|r2v|both}" >&2
  exit 2
fi
mode=$1
root=$(cd "$(dirname "$0")/.." && pwd -P)
cache=$(realpath -m "${H3_CACHE:-/opt/ms-minimax-h3}")
export H3_CACHE="$cache"
base_python=${H3_PYTHON:-python}
revision=651ca296a73cd21c12a57eb8741d52e40dc6528f
origin=https://github.com/Comfy-Org/ComfyUI.git
state="$root/state"
comfy="$state/ComfyUI"

"$base_python" - <<'PY'
import sys
if sys.platform != "linux" or sys.version_info[:2] < (3, 12):
    raise SystemExit("Select a Linux Python 3.12+ interpreter with a working GPU runtime.")
import torch
if not torch.cuda.is_available():
    raise SystemExit("This interpreter does not see a CUDA or ROCm GPU.")
print("Platform torch:", torch.__version__, "GPU runtime:", torch.version.hip or torch.version.cuda,
      "VRAM GiB:", round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1))
PY
mkdir -p "$state" "$cache"
exec 9>"$cache/restore.lock"
flock -n 9 || { echo "Another restore is active for this cache." >&2; exit 1; }
"$base_python" "$root/scripts/models.py" "$mode" --action plan
if [[ ! -e "$comfy" ]]; then
  staging=$(mktemp -d "$state/ComfyUI.new.XXXXXX")
  git -C "$staging" init -q
  git -C "$staging" remote add origin "$origin"
  git -C "$staging" fetch --depth 1 origin "$revision"
  git -C "$staging" checkout -q --detach FETCH_HEAD
  mv -T "$staging" "$comfy"
fi
[[ $(git -C "$comfy" rev-parse --show-toplevel) == "$comfy" && $(git -C "$comfy" rev-parse HEAD) == "$revision" ]] ||
  { echo "Unexpected ComfyUI checkout in $comfy; inspect it." >&2; exit 1; }
"$base_python" "$root/../rocm_attention_patch.py" "$comfy"
echo "FM_STAGE 安装 Python 依赖"
# Validate the existing environment against this boot's GPU runtime.
backend=$("$base_python" -c 'import torch; print("rocm" if torch.version.hip else "cuda")')
"$base_python" "$root/../runtime_cache.py" isolate "$cache" "$base_python" "$backend" 0 "$root/assets/requirements-amd.txt"
py="$cache/venv/bin/python"
"$base_python" - <<'PY' > "$cache/platform-constraints.txt"
from importlib.metadata import version, PackageNotFoundError
for package in ("torch", "torchvision", "torchaudio", "modelscope"):
    try:
        print(f"{package}=={version(package)}")
    except PackageNotFoundError:
        continue
PY
if "$base_python" "$root/../runtime_cache.py" check "$py" "$root/assets/requirements-amd.txt"; then
  echo "FM_STAGE 沿用已验证的 H3 Python 依赖"
else
  "$py" "$root/../package_sources.py" --python "$py" -- -c "$cache/platform-constraints.txt" -r "$root/assets/requirements-amd.txt"
fi
"$py" -c 'import torch; assert torch.cuda.is_available(), "GPU torch check failed"'
"$py" -m ipykernel install --user --name ms-minimax-h3 --display-name "MiniMax H3"
echo "FM_STAGE 检查模型缓存"
"$py" "$root/scripts/models.py" "$mode" --action fetch
echo "FM_STAGE 启动生成服务"
"$py" "$root/scripts/service.py" "$mode"
