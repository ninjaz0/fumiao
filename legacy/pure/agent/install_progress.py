"""Translate the installer's real events into a status shared by the terminal and panel."""

import json
import os
import re
import sys
import time
from pathlib import Path

NAMES = {
    "minimax_h3_audio_vae_fp32.safetensors": "音频解码器",
    "minimax_h3_video_vae_fp16.safetensors": "视频解码器",
    "minimax_h3_fl2va_pruned_bf16.safetensors": "文生视频模型",
    "minimax_h3_ref2va_pruned_bf16.safetensors": "参考图模型",
    "qwen3vl_32b_minimax_h3_bf16.safetensors": "文本编码器",
    "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors": "参考图加速权重",
    "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors": "图生视频加速权重",
}


class InstallProgress:
    def __init__(self, state, lock, run):
        self.path = state / "install-progress.json"
        self.run = run
        entries = [e for e in (json.loads(lock.read_text())["files"] if lock else [])
                   if not e.get("requires_env") or os.getenv(e["requires_env"]) == "1"]
        self.sizes = {Path(e["path"]).name: e["bytes"] for e in entries}
        self.verified = set()
        self.current = None
        self.checking = False
        self.message = ""
        self.update("检查 GPU 环境")

    def update(self, message, status="preparing"):
        if self.message == message and status == "preparing":
            return
        data = {"run": self.run, "status": status, "message": message}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False))
        tmp.replace(self.path)
        self.message = message

    def model_status(self, percent=None):
        done = sum(self.sizes[name] for name in self.verified)
        total = sum(self.sizes.values())
        action = "校验" if self.checking else "下载"
        title = NAMES.get(self.current, self.current)
        amount = f" {percent}%" if percent is not None else ""
        self.update(
            f"{action}{title}{amount}。已校验 {len(self.verified)}/{len(self.sizes)} 个文件，{done / 1e9:.1f}/{total / 1e9:.1f} GB"
        )

    def read_line(self, line):
        line = line.strip()
        if line.startswith("FM_STAGE "):
            self.current = None
            self.update(line.removeprefix("FM_STAGE "))
            return
        for marker, checking in (("Fetching ", False), ("FM_VERIFY ", True)):
            if line.startswith(marker):
                name = Path(line.removeprefix(marker)).name
                if name in self.sizes:
                    self.current = name
                    self.checking = checking
                    self.model_status()
                return
        if line.startswith(("Verified existing ", "Verified download ")):
            name = Path(line.split(" ", 2)[2]).name
            if name in self.sizes:
                self.verified.add(name)
                self.current = None
                self.update(f"已校验 {len(self.verified)}/{len(self.sizes)} 个模型文件")
            return
        if not self.current:
            return
        if self.checking:
            match = re.fullmatch(r"FM_HASH (\d{1,3})", line)
        elif self.current in line:
            match = re.search(r":\s*(\d{1,3})%\|", line)
        else:
            match = None
        if match and int(match[1]) <= 100:
            self.model_status(int(match[1]))


def follow(path, run, pid):
    last = None
    last_print = 0
    began = time.monotonic()
    tty = sys.stdout.isatty()
    while True:
        try:
            data = json.loads(path.read_text())
            if data.get("run") != run:
                data = {}
        except (FileNotFoundError, ValueError):
            data = {}
        message = data.get("message", "正在启动工作进程")
        elapsed = time.monotonic() - began
        terminal = data.get("status") in ("ready", "error")
        if message != last or terminal or elapsed - last_print >= (5 if tty else 30):
            minutes, seconds = divmod(int(elapsed), 60)
            print(
                ("\r\033[K" if tty else "")
                + f"[{minutes:02d}:{seconds:02d}] {message}",
                end="\n" if terminal or not tty else "",
                flush=True,
            )
            last = message
            last_print = elapsed
        if terminal:
            return 0 if data["status"] == "ready" else 1
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            # Catch a final status written between the previous read and process exit.
            try:
                final = json.loads(path.read_text())
                if final["run"] == run and final["status"] in ("error", "ready"):
                    print("\n" + final["message"], flush=True)
                    return int(final["status"] == "error")
            except (OSError, KeyError, ValueError):
                pass
            print("\n安装进程已退出，请检查同目录的 worker.log。", flush=True)
            return 1
        time.sleep(1)


if __name__ == "__main__":
    try:
        sys.exit(follow(Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])))
    except KeyboardInterrupt:
        print("\n已退出进度显示，安装仍在后台运行。", flush=True)
