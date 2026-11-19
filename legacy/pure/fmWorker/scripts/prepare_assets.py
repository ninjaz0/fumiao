"""Build reproducible worker resources from the approved platform checkout."""
import hashlib
import gzip
import io
import json
import shutil
import tarfile
import urllib.request
import base64
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PLATFORM=Path(os.environ.get('FMWORKER_PLATFORM_SOURCE') or ROOT/'vendor/platform').resolve()
extension=json.loads((ROOT/'resources/chrome-extension/manifest.json').read_text())
key_hash=hashlib.sha256(base64.b64decode(extension['key'])).hexdigest()[:32]
(ROOT/'resources/chrome-extension/id.txt').write_text(''.join(chr(ord('a')+int(c,16)) for c in key_hash)+'\n')
files={p.name:p for p in (PLATFORM/'agent').glob('*.py')}
files['node_models.py']=PLATFORM/'node_models.py'
files['breeze.lock.json']=PLATFORM/'agent/breeze.lock.json'
for p in (PLATFORM/'agent/vendor/engine').rglob('*'):
    if p.is_file() and '__pycache__' not in p.parts:files['engine/'+p.relative_to(PLATFORM/'agent/vendor/engine').as_posix()]=p
archive=ROOT/'resources/agent.tgz'
with archive.open('wb') as raw, gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='') as compressed, tarfile.open(fileobj=compressed,mode='w') as package:
    for name,path in sorted(files.items()):
        data=path.read_bytes();entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o755 if name.endswith('.sh') else 0o644
        package.addfile(entry,io.BytesIO(data))
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(ROOT/'resources/agent.lock.json').write_text(json.dumps({'sha256':digest,'workflow':'h3-v6-native-inputs-turbo4',
    'files':{name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in files.items()}},indent=2)+'\n')
shutil.copyfile(PLATFORM/'flow_models.json',ROOT/'resources/flow_models.json')
flow=json.loads((ROOT/'resources/upstream.lock.json').read_text())['flow2api']
flow_archive=ROOT/'resources/flow2api.tar.gz'
if not flow_archive.exists():
    with urllib.request.urlopen(flow['url'],timeout=90) as response:flow_archive.write_bytes(response.read())
if hashlib.sha256(flow_archive.read_bytes()).hexdigest()!=flow['sha256']:raise SystemExit('Pinned Flow2API archive checksum mismatch')
with tarfile.open(flow_archive) as package:
    license=next(item for item in package.getmembers() if item.name.endswith('/LICENSE') and item.name.count('/')==1)
    (ROOT/'resources/LICENSE-Flow2API.txt').write_bytes(package.extractfile(license).read())
print('Bundled',len(files),'platform files; archive SHA-256',digest)
