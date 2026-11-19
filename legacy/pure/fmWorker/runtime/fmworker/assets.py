import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


def bundled(name):
    if getattr(sys, 'frozen', False): return Path(sys._MEIPASS)/'resources'/name
    return Path(__file__).resolve().parents[2]/'resources'/name


def uv_binary():
    import uv
    return uv.find_uv_bin()


def extract_verified(archive, target, expected, strip_root=False):
    archive, target = Path(archive), Path(target)
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected: raise RuntimeError('运行包校验失败，请重新安装 fmWorker')
    stage = target.with_name(target.name+'.installing')
    if stage.exists(): shutil.rmtree(stage)
    stage.mkdir(parents=True, mode=0o700)
    with tarfile.open(archive) as package:
        for item in package.getmembers():
            parts = Path(item.name).parts[1:] if strip_root else Path(item.name).parts
            if not parts: continue
            if Path(item.name).is_absolute() or '..' in parts or not (item.isfile() or item.isdir()):
                raise RuntimeError('运行包包含不受支持的路径')
            path = stage.joinpath(*parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            if item.isdir(): path.mkdir(exist_ok=True)
            else:
                with package.extractfile(item) as src, path.open('wb') as dest: shutil.copyfileobj(src, dest)
                if item.mode & 0o111: path.chmod(0o700)
    if target.exists(): shutil.rmtree(target)
    stage.replace(target)


def managed_python(root, requirements, log):
    root = Path(root)
    python = root/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(root.parent/'python'), UV_CACHE_DIR=str(root.parent/'uv-cache'))
    if not python.exists():
        subprocess.run([uv_binary(), 'venv', '--python', '3.12', '--managed-python', str(root)], env=env, stdout=log, stderr=log, check=True, timeout=900)
    subprocess.run([uv_binary(), 'pip', 'install', '--python', str(python), '-r', str(requirements)], env=env, stdout=log, stderr=log, check=True, timeout=1200)
    return python
