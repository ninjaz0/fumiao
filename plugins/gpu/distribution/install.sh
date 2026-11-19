#!/usr/bin/env bash
set -eu -o pipefail
umask 077
unset FUMIAO_LANE_MODEL FUMIAO_PARENT_RUN FUMIAO_RUNTIME_ID
step() { printf "\n[%s/4] %s\n" "$1" "$2"; }
trap 'echo "接入未完成（第 $LINENO 行），请查看上方错误。" >&2' ERR
[ "$(uname -s)" = Linux ] || { echo "请在 Linux GPU 实例的终端运行"; exit 1; }
code=""; selection=""; audit_only=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --audit-only) audit_only=1 ;;
        --models=*) selection="${1#--models=}" ;;
        --models) shift; selection="${1:?缺少模型选项}" ;;
        --*) echo "未知选项：$1"; exit 1 ;;
        *) [ -z "$code" ] || { echo "接入参数过多"; exit 1; }; code="$1" ;;
    esac
    shift
done
site="${FUMIAO_SITE:-https://nvmes.com}"
if [ -n "${FUMIAO_HOME:-}" ]; then root="$FUMIAO_HOME";
elif [ -d /content ] && { [ -d /opt/google/drive ] || [ -d /var/colab ]; }; then root=/content/fumiao-worker;
elif [ -n "${FUMIAO_PERSIST_ROOT:-}" ] && [ -w "$FUMIAO_PERSIST_ROOT" ]; then root="$FUMIAO_PERSIST_ROOT/fumiao-worker";
elif [ -d /mnt/workspace ] && [ -w /mnt/workspace ]; then root=/mnt/workspace/fumiao-worker;
else root="${XDG_DATA_HOME:-$HOME/.local/share}/fumiao-worker"; fi
if [ -n "${FUMIAO_CACHE_ROOT:-}" ]; then cache_base="$FUMIAO_CACHE_ROOT";
elif [ -w /opt ]; then cache_base=/opt;
else cache_base="${XDG_CACHE_HOME:-$HOME/.cache}/fumiao"; fi
mkdir -p "$cache_base"
export FUMIAO_CACHE_ROOT="$cache_base" H3_CACHE="${H3_CACHE:-$cache_base/fumiao-h3}" BREEZE_HOME="${BREEZE_HOME:-$cache_base/fumiao-breeze}"
mkdir -p "$root/state"
exec 8>"$root/state/install.lock"; flock -n 8 || { echo "接入程序正在运行"; exit 1; }
active_worker=0
if ! flock -n "$root/state/lock" true; then active_worker=1; fi
step 1 "获取并校验接入程序"
stage=$(mktemp -d "$root/.install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
curl -fsSL --retry 4 --connect-timeout 15 "$site/connect/agent.tgz.sha256" -o "$stage/checksum"
hash=$(awk 'NR==1{print $1}' "$stage/checksum")
[[ $hash =~ ^[0-9a-f]{64}$ ]] || { echo "安装包摘要无效"; exit 1; }
mkdir -p "$root/state/packages"
package="$root/state/packages/$hash.tgz"
valid() { [ -f "$1" ] && printf '%s  %s\n' "$hash" "$1" | sha256sum --status -c -; }
if ! valid "$package"; then
    partial="$package.partial"
    curl -fSL --retry 4 --connect-timeout 15 -C - "$site/connect/agent.tgz" -o "$partial"
    if ! valid "$partial"; then
        rm -f -- "$partial"
        echo "安装包校验失败，请再次运行接入命令"; exit 1
    fi
    mv -f "$partial" "$package"
fi
echo "接入包校验通过"
tar -C "$stage" -xzf "$package"
step 2 "识别显卡并检查所选模型的资源要求"
py="${FUMIAO_PYTHON:-${H3_PYTHON:-}}"
if [ -z "$py" ]; then
    for candidate in python python3 /opt/conda/bin/python "$H3_CACHE/venv/bin/python" "$BREEZE_HOME/venv/bin/python" python3.13 python3.12; do
        if "$candidate" -c 'import sys,torch; assert sys.version_info[:2]>=(3,10) and torch.cuda.is_available()' >/dev/null 2>&1; then py=$(command -v "$candidate"); break; fi
    done
fi
if [ -z "$py" ]; then
    for candidate in python3 python python3.13 python3.12; do
        if "$candidate" -c 'import sys; assert sys.version_info[:2]>=(3,10)' >/dev/null 2>&1; then py=$(command -v "$candidate"); break; fi
    done
fi
[ -n "$py" ] || { echo "需要 Python 3.10 或更高版本"; exit 1; }
if [ -z "$selection" ] && [ -s "$root/state/models.json" ]; then
    selection=$("$py" -c 'import json,sys;sys.path.insert(0,sys.argv[1]);from node_models import GPU_MODELS;print(",".join(GPU_MODELS[m]["slug"] for m in json.load(open(sys.argv[1]+"/state/models.json"))))' "$root")
fi
selection="${selection:-minimax-h3}"
export FUMIAO_INSTALL_RUN="${stage##*/}"
if [ "$active_worker" = 1 ] || [ "$audit_only" = 1 ]; then
    echo "执行完整缓存检查；当前服务与接入凭据保持不变。"
    "$py" "$stage/cache_manager.py" --models "$selection" --root "$root" --audit-only
    exit 0
fi
mkdir -p "$root/engine/state"
cp -R "$stage/engine/." "$root/engine/"
cp "$stage/worker.py" "$stage/render.py" "$stage/reference_image.py" "$stage/job_progress.py" "$stage/install_progress.py" "$stage/rocm_attention_patch.py" "$stage/sampler_progress.py" "$stage/video_quality.py" "$stage/bootstrap.py" "$stage/hardware_probe.py" "$stage/node_models.py" "$stage/breeze_adapter.py" "$stage/breeze.lock.json" "$stage/download_sources.py" "$stage/package_sources.py" "$stage/cache_manager.py" "$stage/storage_platform.py" "$stage/runtime_cache.py" "$stage/limited_runtime.py" "$stage/resource_gate.py" "$stage/h3_service.py" "$stage/concurrent_node.py" "$root/"
"$py" "$root/bootstrap.py" "$selection"
step 3 "连接团队工作台"
if [ -n "$code" ]; then printf '%s\n' "$code" | FUMIAO_SITE="$site" "$py" "$root/worker.py" --enroll; fi
test -s "$root/state/credential" || { echo "请从网站的「GPU 实例」复制完整接入命令"; exit 1; }
"$py" -c 'import json,sys;from pathlib import Path;p=Path(sys.argv[1]);requested=json.loads((p/"requested-models.json").read_text());saved=json.loads((p/"models.json").read_text()) if (p/"models.json").exists() else ["MiniMax H3"];assert requested==saved,"模型选择已改变，请从网站重新生成接入命令"' "$root/state"
export FUMIAO_SITE="$site" H3_PYTHON="$py"
step 4 "准备模型和生成服务"
export FUMIAO_INSTALL_RUN="${stage##*/}"
nohup setsid --wait "$py" -u "$root/worker.py" >>"$root/state/worker.log" 2>&1 </dev/null 8>&- &
worker_pid=$!
echo "完整日志：$root/state/worker.log"
if [ "${FUMIAO_NO_FOLLOW:-0}" = 1 ]; then
    echo "已转入后台，可在工作台的 GPU 实例页查看进度。"
else
    echo "按 Ctrl+C 可退出进度显示，后台安装会继续。"
    trap 'printf "\n已退出进度显示。\n"; exit 0' INT
    if ! "$py" "$root/install_progress.py" "$root/state/install-progress.json" "$FUMIAO_INSTALL_RUN" "$worker_pid"; then
        echo "最近的安装日志：" >&2
        tail -n 8 "$root/state/worker.log" >&2
        exit 1
    fi
fi
