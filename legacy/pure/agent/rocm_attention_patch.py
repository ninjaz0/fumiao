"""Apply the H3 large-stride ROCm attention workaround to the pinned core."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ORIGINAL = '''        q = AttentionTensorContainer(q.transpose(0, 1).unsqueeze(0))
        k = AttentionTensorContainer(k.transpose(0, 1).unsqueeze(0))
        v = AttentionTensorContainer(v.transpose(0, 1).unsqueeze(0))'''
PATCHED = '''        compact_attention = torch.version.hip is not None and v.stride(0) * s * v.element_size() >= (1 << 31)
        q, k, v = (part.transpose(0, 1).unsqueeze(0) for part in (q, k, v))
        # PyTorch 2.12.0+git6bbd260 / ROCm 7.2 miscomputes large interleaved QKV views.
        # Compact head-major copies match the FP32 reference in the large-QKV probe.
        if compact_attention:
            q, k, v = (part.contiguous() for part in (q, k, v))
        q = AttentionTensorContainer(q)
        k = AttentionTensorContainer(k)
        v = AttentionTensorContainer(v)'''


def apply(source):
    path = Path(source) / 'comfy/ldm/minimax/model.py'
    text = path.read_text()
    if PATCHED in text:
        return False
    if text.count(ORIGINAL) != 1:
        raise RuntimeError('H3 attention source differs from the pinned version; patch not applied')
    path.write_text(text.replace(ORIGINAL, PATCHED))
    return True


def verify_checkout(source):
    """Permit only this exact patch when restoring a persistent checkout."""
    source = Path(source)
    relative = 'comfy/ldm/minimax/model.py'
    subprocess.run(['git', '-C', str(source), 'diff', '--quiet', 'HEAD', '--', '.', ':!' + relative], check=True)
    original = subprocess.check_output(['git', '-C', str(source), 'show', 'HEAD:' + relative], text=True)
    if original.count(ORIGINAL) != 1 or (source / relative).read_text() not in (original, original.replace(ORIGINAL, PATCHED)):
        raise RuntimeError('Tracked H3 files differ from the pinned source and the attention fix')


def process_started(pid):
    return Path(f'/proc/{int(pid)}/stat').read_text().rsplit(')', 1)[1].split()[19]


def boot_id():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def record_runtime(source, receipt, pid):
    value = {'pid': pid, 'started': process_started(pid), 'boot_id': boot_id(),
             'source': hashlib.sha256((Path(source) / 'comfy/ldm/minimax/model.py').read_bytes()).hexdigest()}
    temp = Path(receipt).with_suffix('.tmp')
    temp.write_text(json.dumps(value))
    temp.replace(receipt)


def verify_runtime(source, receipt):
    try:
        value = json.loads(Path(receipt).read_text())
        return (value['boot_id'] == boot_id() and value['started'] == process_started(value['pid']) and
                value['source'] == hashlib.sha256((Path(source) / 'comfy/ldm/minimax/model.py').read_bytes()).hexdigest())
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return False


if __name__ == '__main__':
    verify_checkout(sys.argv[1])
