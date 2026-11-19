"""Mounted Drive discovery and a private model cache, separate from runtime state."""
import os
from pathlib import Path

DEFAULT_MOUNT=Path('/content/drive')

def drive_mounts():
    result=[]
    try:
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            left,right=line.split(' - ',1)
            if right.split()[0].startswith('fuse.drive'):
                result.append(Path(left.split()[4].replace('\\040',' ')).resolve())
    except (OSError,ValueError,IndexError):pass
    return result


def drive_mount_for(path,mounts=None):
    path=Path(path).resolve();mounts=drive_mounts() if mounts is None else mounts
    return next((m for m in sorted(mounts,key=lambda p:len(p.parts),reverse=True) if path==m or m in path.parents),None)


def persistence_root():
    explicit=os.getenv('FUMIAO_PERSIST_ROOT')
    mounts=drive_mounts()
    if explicit:
        path=Path(explicit).expanduser().resolve()
        # A stale /content/drive directory is local storage, never persistence.
        if (path==DEFAULT_MOUNT or DEFAULT_MOUNT in path.parents) and not drive_mount_for(path,mounts):
            raise RuntimeError('Google Drive 尚未挂载，请先在 Colab 运行 drive.mount("/content/drive")')
        if drive_mount_for(path,mounts):
            if path in mounts or any(path==m/'MyDrive' for m in mounts):
                raise RuntimeError('请为模型设置专用的 Drive 子目录，例如 MyDrive/FumiaoAIGC')
            path.mkdir(parents=True,exist_ok=True)
        return path
    for mount in mounts:
        if (mount/'MyDrive').is_dir():
            path=mount/'MyDrive/FumiaoAIGC';path.mkdir(exist_ok=True);return path
    path=Path('/mnt/workspace')
    return path if path.is_dir() and os.access(path,os.W_OK) else None


def scan_redirect(folder,persistent,mounts,extra=()):
    """Never traverse unrelated personal Drive files as part of cache discovery."""
    folder=Path(folder).resolve()
    if not drive_mount_for(folder,mounts):return None
    allowed=[Path(p).resolve() for p in [persistent,*extra] if p is not None]
    if any(folder==p or p in folder.parents for p in allowed):return None
    return [p for p in allowed if folder in p.parents and p.is_dir()]


def logical_bytes(path):
    total=0;stack=[Path(path)];seen=set()
    while stack:
        folder=stack.pop()
        for p in folder.iterdir():
            if p.is_symlink():continue
            if p.is_dir():stack.append(p)
            elif p.is_file():
                s=p.stat();key=(s.st_dev,s.st_ino)
                if key not in seen:seen.add(key);total+=s.st_size
    return total


def local_model_path(entry,cache):
    return Path(cache)/'fumiao-models'/entry['sha256'][:2]/(entry['sha256']+'-'+Path(entry['path']).name)
