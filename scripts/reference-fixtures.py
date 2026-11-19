"""Local codec fixtures and unmodified Pure H3 reference oracle; no providers."""
import json
import math
import random
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'legacy/pure'))
from h3_inputs import normalize_media

root = Path(sys.argv[1])
entries = []

def fixture(name, args):
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', *args, str(root / name)],
                   check=True, capture_output=True, timeout=30)
    for kind in ('video', 'audio'):
        entry = {'name': name, 'kind': kind}
        try:
            output, info = normalize_media(root / name, kind)
            entry.update(result={**info, 'size': output.stat().st_size}, output=output.name)
        except ValueError as error:
            entry['error'] = str(error)
        entries.append(entry)

for name, codec in [('sound.wav', 'pcm_s16le'), ('sound.mp3', 'libmp3lame'),
                    ('sound.flac', 'flac'), ('sound.ogg', 'libvorbis'), ('sound.aac', 'aac')]:
    fixture(name, ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.03125', '-c:a', codec])
for name, length in [('too-short.wav', '1.98'), ('minimum.wav', '1.99'),
                     ('maximum.wav', '15.05'), ('too-long.wav', '15.051')]:
    fixture(name, ['-f', 'lavfi', '-i', f'anullsrc=r=32000:cl=stereo:d={length}', '-c:a', 'pcm_s16le'])
fixture('silent.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=94x62:rate=30:duration=2',
                        '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p'])
fixture('av.mkv', ['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=25:duration=2',
                  '-f', 'lavfi', '-i', 'sine=duration=2:sample_rate=44100',
                  '-c:v', 'libx264', '-threads', '2', '-c:a', 'pcm_s16le', '-metadata', 'title=strip me'])
fixture('odd.mkv', ['-f', 'lavfi', '-i', 'testsrc=size=95x63:rate=24:duration=2',
                   '-c:v', 'ffv1', '-threads', '2'])
fixture('large.mp4', ['-f', 'lavfi', '-i', 'color=blue:size=1366x768:rate=24:duration=2',
                     '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p'])
fixture('vp9.webm', ['-f', 'lavfi', '-i', 'testsrc2=size=64x96:rate=12:duration=2',
                    '-c:v', 'libvpx-vp9', '-threads', '2'])
for name, contents in [('invalid.bin', b'not a media file'), ('empty.bin', b'')]:
    (root / name).write_bytes(contents)
    for kind in ('video', 'audio'):
        try:
            normalize_media(root / name, kind)
            raise AssertionError('corrupt fixture unexpectedly accepted')
        except ValueError as error:
            entries.append({'name': name, 'kind': kind, 'error': str(error)})

rng = random.Random(84)
values = [2.03125, 2.09375, 2.675, 15.05, -2.03125, -0.00001, 5e-324]
for _ in range(1000):
    value = struct.unpack('>d', rng.randbytes(8))[0]
    if math.isfinite(value):
        values.append(value)
rounds = [{'value': v, 'digits': d, 'result': round(v, d)} for v in values for d in (0, 2, 4, 12)]
(root / 'manifest.json').write_text(json.dumps({'entries': entries, 'rounds': rounds}, ensure_ascii=False))
