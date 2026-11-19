"""Start the pinned ComfyUI on loopback, or verify the service for this checkout."""
import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent))
from rocm_attention_patch import apply, record_runtime, verify_runtime
from h3_service import stop_owned
from resource_gate import valid_receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["both", "t2v", "r2v"])
    args = parser.parse_args()
    state = ROOT / "state"
    cache = Path(os.getenv("H3_CACHE", "/opt/ms-minimax-h3")).resolve()
    port = int(os.getenv("H3_PORT", "8188"))
    url = f"http://127.0.0.1:{port}"
    source = state / "ComfyUI"
    apply(source)
    receipt = state / 'comfy-runtime.json'
    config = cache / "extra-models.yaml"
    models = cache / "models"
    folders = ["diffusion_models", "text_encoders", "vae", "loras"]
    config_data = {"ms_h3": {"base_path": str(models), **{p: p for p in folders}}}
    config.write_text(yaml.safe_dump(config_data))
    output = state / "outputs"
    for d in (output, state / "inputs", state / "user", state / "logs"):
        d.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, str(source / "main.py"), "--listen", "127.0.0.1",
               "--port", str(port), "--extra-model-paths-config", str(config),
               "--output-directory", str(output), "--input-directory", str(state / "inputs"),
               "--user-directory", str(state / "user"), "--use-pytorch-cross-attention",
               "--disable-xformers", "--disable-all-custom-nodes", "--preview-method", "none",
               "--reserve-vram", os.getenv("H3_RESERVE_VRAM_GIB","8")]
    if os.getenv('FMWORKER_COLAB') == '1':
        # Keep the same graphs and weights on Colab; only loading/offload changes.
        # GPU qualification remains a separate real-hardware release check.
        command += ['--fast-disk', '--cpu-vae']
    with socket.socket() as probe:
        occupied = probe.connect_ex(("127.0.0.1", port)) == 0
    budget=float(os.getenv('H3_VRAM_BUDGET_GIB','0'))
    if budget:command += ['--disable-dynamic-vram','--disable-cuda-malloc']
    limit_receipt=cache/'memory-limit.json'
    matches=False
    if occupied:
        try:
            stats=requests.get(url+'/system_stats',timeout=5).json()
            matches=verify_runtime(source,receipt) and stats['system'].get('argv')==command[1:]
            if budget:matches=matches and bool(valid_receipt(limit_receipt,budget))
        except (requests.RequestException,KeyError,ValueError):pass
        if not matches:
            if not stop_owned(source,receipt,url):raise SystemExit('该端口不是本接入程序的空闲服务，请检查端口或等待当前任务完成')
            occupied=False
    process = None
    if not occupied:
        with (state / "logs/comfy.log").open("ab") as log:
            launch=command
            env=dict(os.environ)
            if budget:
                launch=[sys.executable,str(ROOT.parent/'limited_runtime.py'),'h3','0',str(budget),*command[1:]]
                env['FUMIAO_LIMIT_RECEIPT']=str(limit_receipt)
            process = subprocess.Popen(launch, env=env, cwd=source, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        record_runtime(source, receipt, process.pid)
    for _ in range(120):
        if process and process.poll() is not None:
            raise SystemExit("ComfyUI exited; inspect state/logs/comfy.log")
        try:
            response = requests.get(url + "/system_stats", timeout=3)
            response.raise_for_status()
            system = response.json()["system"]
            break
        except (requests.RequestException, KeyError, ValueError):
            if occupied:
                raise SystemExit("Port is occupied by another or still-starting service. Inspect it or choose H3_PORT.")
            time.sleep(1)
    else:
        raise SystemExit("Service readiness timed out; inspect the log before restarting.")
    if system.get("comfyui_version") != "0.38.0" or system.get("argv") != command[1:]:
        raise SystemExit("Port belongs to a different configuration. Select another H3_PORT.")
    if budget and not valid_receipt(limit_receipt,budget):raise SystemExit('H3 显存预算未通过运行检查')
    required = {"t2v": "MiniMaxH3ImageToVideo", "r2v": "MiniMaxH3ReferenceToVideo"}
    for mode, node in required.items():
        if args.mode in (mode, "both"):
            response = requests.get(url + "/object_info/" + node, timeout=20)
            response.raise_for_status()
            if node not in response.json():
                raise SystemExit(f"Missing native node: {node}")
    print(f"Ready: {url} ({args.mode})")


if __name__ == "__main__":
    main()
