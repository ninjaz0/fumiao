"""MiniMax H3 BF16, matching EasyColab's DiffSynth pipeline and RAM tiers."""
import gc
import os
from pathlib import Path
import shutil
import subprocess
import threading

os.environ["DIFFSYNTH_DOWNLOAD_SOURCE"] = "huggingface"
os.environ["DIFFSYNTH_DISK_MAP_BUFFER_SIZE"] = str(10**12)
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
MODEL_REVISION = "42ed227ee7df40d41602854ae760620d6eb651fe"
FRAMES = {5: 124, 10: 243, 15: 362}
STEPS = [16, 20, 32, 50]


def ram_available():
    values = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    return int(values["MemAvailable"].split()[0]) / 1024**2


def model_config(ram, torch):
    cpu = dict(offload_dtype=torch.bfloat16, offload_device="cpu", onload_dtype=torch.bfloat16,
               onload_device="cpu", preparing_dtype=torch.bfloat16, preparing_device="cuda",
               computation_dtype=torch.bfloat16, computation_device="cuda")
    disk = dict(cpu, offload_dtype="disk", offload_device="disk", onload_dtype="disk", onload_device="disk")
    return (cpu, cpu, cpu) if ram >= 148 else ((cpu, disk, cpu) if ram >= 88 else (disk, disk, disk))


class Engine:
    def __init__(self, root, report):
        self.root, self.report = Path(root), report
        self.cache = self.root / "models"
        self.pipe = None
        self.mode = None
        self.cache.mkdir(exist_ok=True)
        self.drive_process = None

    def drive_command(self, *args, timeout=1800):
        config = self.root / "rclone.conf"
        if not config.exists() or not shutil.which("rclone"):
            return
        return subprocess.run(["rclone", "--config", str(config), *args, "--transfers", "8", "--checkers", "8"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout, check=False)

    def load(self, mode="FL2VA"):
        if self.pipe is not None and self.mode == mode:
            return
        import torch
        from huggingface_hub import snapshot_download
        from diffsynth.pipelines.minimax_h3_audio_video import MiniMaxH3Pipeline, ModelConfig
        from h3_optimizations import _enable_high_vram_optimizations
        if not torch.cuda.is_available():
            raise RuntimeError("Colab 未提供 CUDA GPU")
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
            gc.collect(); torch.cuda.empty_cache()
        remote = "easycolab_gdrive:FumiaoColab/Models/" + MODEL_REVISION + "/" + mode
        self.report("正在检查 Google Drive 模型缓存")
        # Copy an existing cache to local NVMe, rather than mapping weights through FUSE.
        try:
            self.drive_command("copy", remote, str(self.cache / mode), "--ignore-existing")
        except (OSError, subprocess.SubprocessError):
            pass  # Hugging Face download verifies/resumes any missing files below.
        self.report("正在下载 MiniMax H3 权重（首次约 134 GB）")
        paths = [f"{mode}/text_encoder/model-*.safetensors", f"{mode}/transformer/model-*.safetensors",
                 f"{mode}/video_vae/source/model.safetensors", f"{mode}/audio_vae/model.safetensors", f"{mode}/processor/*"]
        snapshot_download("MiniMaxAI/MiniMax-H3", revision=MODEL_REVISION,
                          allow_patterns=paths, local_dir=str(self.cache), max_workers=8)
        folder = self.cache / mode
        if (self.root / "rclone.conf").exists() and shutil.which("rclone"):
            def backup():
                try: self.drive_command("copy", str(folder), remote, "--exclude", ".cache/**", timeout=7200)
                except (OSError, subprocess.SubprocessError): pass
            threading.Thread(target=backup, daemon=True).start()
        total = torch.cuda.mem_get_info()[1] / 1024**3
        te_cfg, dit_cfg, vae_cfg = model_config(ram_available(), torch)
        self.report("正在加载 MiniMax H3 到内存与显存")
        te = sorted(str(p) for p in (folder / "text_encoder").glob("model-*.safetensors"))
        dit = sorted(str(p) for p in (folder / "transformer").glob("model-*.safetensors"))
        if len(te) != 14 or len(dit) != 13:
            raise RuntimeError("模型分片不完整")
        self.pipe = MiniMaxH3Pipeline.from_pretrained(torch_dtype=torch.bfloat16, device="cuda",
            model_configs=[ModelConfig(path=te, **te_cfg), ModelConfig(path=dit, **dit_cfg),
                ModelConfig(path=str(folder / "video_vae/source/model.safetensors"), **vae_cfg),
                ModelConfig(path=str(folder / "audio_vae/model.safetensors"), **vae_cfg)],
            processor_config=ModelConfig(path=str(folder / "processor")), vram_limit=max(8, total - 2.5))
        _enable_high_vram_optimizations(self.pipe, total, preload_vram=True, skip_preload_attrs=("dit",))
        self.mode = mode

    def render(self, job, references, destination, progress):
        from PIL import Image, ImageOps
        from diffsynth.utils.data.audio_video import write_video_audio
        from h3_optimizations import _run_pipeline_with_smart_tiling, _reclaim_transient_gpu_memory
        steps = int(job["sampling_steps"])
        if steps not in STEPS:
            raise ValueError("此 BF16 实例不支持请求的采样步数")
        self.load("Ref2VA" if len(references) > 1 else "FL2VA")
        width, height = int(job["width"]), int(job["height"])
        kwargs = dict(prompt=job["prompt"], width=width, height=height, num_frames=FRAMES[job["seconds"]],
                      num_inference_steps=steps, seed=int(job["seed"]))
        images = []
        for path in references:
            with Image.open(path) as im:
                images.append(ImageOps.exif_transpose(im).convert("RGB"))
        if len(images) == 1:
            kwargs.update(keyframes=[ImageOps.fit(images[0], (width, height), method=Image.Resampling.LANCZOS)], keyframe_indices=[0])
        elif images:
            kwargs["references"] = [{"type": "image", "image": image} for image in images]
        def bars(sequence):
            for index, value in enumerate(sequence):
                progress(index, steps)
                yield value
            progress(steps, steps)
        kwargs["progress_bar_cmd"] = bars
        _reclaim_transient_gpu_memory()
        video, audio = _run_pipeline_with_smart_tiling(self.pipe, kwargs)
        raw = Path(destination).with_suffix(".raw.mp4")
        write_video_audio(video=video, audio=audio, output_path=str(raw), fps=24, audio_sample_rate=32000)
        del video, audio
        _reclaim_transient_gpu_memory()
        # Normalize to the exact existing platform media contract; no web changes needed.
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-map", "0:v:0", "-map", "0:a:0",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24", "-frames:v", str(FRAMES[job["seconds"]]),
            "-c:a", "aac", "-ac", "2", "-ar", "32000", "-t", str(FRAMES[job["seconds"]] / 24),
            "-movflags", "+faststart", str(destination)], check=True, timeout=180)
        raw.unlink(missing_ok=True)
