"""Assemble official Windows embedded Python + Windows wheels on a non-Windows host.

This creates build artifacts, not a Windows runtime validation claim.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
subprocess.run([sys.executable,str(ROOT/'scripts/prepare_assets.py')],check=True)
runtime=ROOT/'build/windows-runtime'
if not (runtime/'python.exe').exists():raise SystemExit('Download the pinned official Python embed archive first')
shutil.copytree(ROOT/'runtime',runtime/'app',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
shutil.copytree(ROOT/'resources',runtime/'resources',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
(runtime/'python312._pth').write_text('python312.zip\n.\napp\nLib/site-packages\nimport site\n')
destination=ROOT/'src-tauri/binaries/fmworker-bridge-x86_64-pc-windows-gnu.exe'
subprocess.run(['x86_64-w64-mingw32-gcc','-O2','-s','-municode','-mwindows',str(ROOT/'scripts/windows_bridge.c'),'-o',str(destination)],check=True)
config={'bundle':{'resources':{'../build/windows-runtime/':'runtime/'}}}
(ROOT/'src-tauri/tauri.windows-cross.json').write_text(json.dumps(config,indent=2))
print('Prepared Windows sidecar and resource tree')
