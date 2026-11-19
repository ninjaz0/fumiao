import os
import json
import hashlib
import platform
import shutil
import subprocess
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(ROOT/'scripts/prepare_assets.py')],check=True)
target={'Darwin':'aarch64-apple-darwin','Windows':'x86_64-pc-windows-msvc','Linux':'x86_64-unknown-linux-gnu'}[platform.system()]
if platform.system()=='Darwin' and platform.machine()!='arm64':raise SystemExit('The macOS release targets Apple Silicon')
subprocess.run([sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onefile','--name','fmworker-bridge',
    '--distpath',str(ROOT/'build/bridge'),'--workpath',str(ROOT/'build/pyinstaller'),'--specpath',str(ROOT/'build'),
    '--add-data',str(ROOT/'resources')+os.pathsep+'resources',
    '--collect-all','colab_cli','--collect-all','uv','--collect-submodules','keyring.backends',
    '--hidden-import','keyring.backends.macOS','--hidden-import','keyring.backends.Windows',
    str(ROOT/'runtime/bridge.py')],check=True,cwd=ROOT)
suffix='.exe' if platform.system()=='Windows' else ''
binary=ROOT/'build/bridge'/('fmworker-bridge'+suffix)
destination=ROOT/'src-tauri/binaries'/('fmworker-bridge-'+target+suffix)
destination.parent.mkdir(exist_ok=True);shutil.copy2(binary,destination)
(destination.with_suffix(destination.suffix+'.build.json')).write_text(json.dumps({
    'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),
    'sources':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
               for folder in ('runtime','resources') for p in (ROOT/folder).rglob('*')
               if p.is_file() and '__pycache__' not in p.parts}},indent=2))
print('Prepared native sidecar:',destination)
