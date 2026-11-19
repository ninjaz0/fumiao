"""Portable GPU discovery plus an actual BF16 kernel probe before large downloads."""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def ram_gib():
    values=[os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')]
    for path in ('/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory/memory.limit_in_bytes'):
        try:
            value=Path(path).read_text().strip()
            if value.isdigit() and int(value)>0:values.append(int(value))
        except OSError:pass
    return min(values)/2**30


def cpu_cores():
    limits=[len(os.sched_getaffinity(0)) if hasattr(os,'sched_getaffinity') else os.cpu_count() or 1]
    try:
        quota,period=Path('/sys/fs/cgroup/cpu.max').read_text().split()
        if quota!='max':limits.append(max(1,int(quota)//int(period)))
    except (OSError,ValueError):
        try:
            quota=int(Path('/sys/fs/cgroup/cpu/cpu.cfs_quota_us').read_text());period=int(Path('/sys/fs/cgroup/cpu/cpu.cfs_period_us').read_text())
            if quota>0:limits.append(max(1,quota//period))
        except (OSError,ValueError):pass
    return min(limits)


def probe(cache='/opt', python=None):
    code='''import json,torch
devices=[]
if torch.cuda.is_available():
 for i in range(torch.cuda.device_count()):
  p=torch.cuda.get_device_properties(i)
  free,total=torch.cuda.mem_get_info(i)
  devices.append(dict(index=i,name=p.name,backend='rocm' if torch.version.hip else 'cuda',vram_gib=round(p.total_memory/2**30,2),free_gib=round(free/2**30,2)))
print(json.dumps(dict(devices=devices,torch=torch.__version__,runtime=str(torch.version.hip or torch.version.cuda))))'''
    try:
        p=subprocess.run([python or sys.executable,'-c',code],capture_output=True,text=True,timeout=45)
        value=json.loads(p.stdout.strip().splitlines()[-1]) if p.returncode==0 else {}
    except (OSError,ValueError,IndexError,subprocess.SubprocessError):value={}
    if not value.get('devices'):
        try:
            raw=subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.total,memory.free,driver_version','--format=csv,noheader,nounits'],text=True,timeout=10)
            value['devices']=[dict(index=i,name=parts[0].strip(),backend='cuda',vram_gib=float(parts[1])/1024,free_gib=float(parts[2])/1024,driver=parts[3].strip()) for i,line in enumerate(raw.splitlines()) if len(parts:=line.split(','))==4]
        except (OSError,ValueError,subprocess.SubprocessError):pass
    if not value.get('devices'):
        cards=[]
        for card in sorted(Path('/sys/class/drm').glob('card[0-9]*')):
            if '-' in card.name:continue
            try:
                if (card/'device/vendor').read_text().strip()!='0x1002':continue
                total=int((card/'device/mem_info_vram_total').read_text());used=int((card/'device/mem_info_vram_used').read_text())
                cards.append(dict(index=len(cards),name='AMD GPU',backend='rocm',vram_gib=total/2**30,free_gib=(total-used)/2**30))
            except OSError:continue
        value['devices']=cards
    target=Path(cache)
    while not target.exists():target=target.parent
    return value|{'python':list(sys.version_info[:2]),'ram_gib':round(ram_gib(),2),'cpu_cores':cpu_cores(),
                  'disk_free_gib':round(shutil.disk_usage(target).free/2**30,2)}


def kernel_probe(python, device=0):
    code=f'''import torch,json,sys
from importlib.metadata import version
assert torch.cuda.is_available(), 'GPU runtime unavailable'
torch.cuda.set_device({device})
x=torch.ones((16,16),device='cuda',dtype=torch.bfloat16)
y=x@x;torch.cuda.synchronize()
assert bool(torch.isfinite(y).all()) and float(y[0,0])==16
print(json.dumps(dict(backend='rocm' if torch.version.hip else 'cuda',torch=torch.__version__,distribution=version('torch'),python=list(sys.version_info[:2]),runtime=str(torch.version.hip or torch.version.cuda))))'''
    p=subprocess.run([python,'-c',code],capture_output=True,text=True,timeout=45)
    if p.returncode:raise RuntimeError('当前 GPU 的 BF16 运算检查失败，请检查驱动和 PyTorch 运行环境：'+p.stderr[-350:])
    return json.loads(p.stdout.strip().splitlines()[-1])


if __name__=='__main__':print(json.dumps(probe(sys.argv[1] if len(sys.argv)>1 else '/opt'),ensure_ascii=False))


def runtime_compatible(profile,backend,minimum=(2,9,1)):
    version=re.match(r"(\d+)\.(\d+)\.(\d+)",profile.get('torch',''))
    return bool(version and tuple(map(int,version.groups()))>=minimum and profile.get('backend')==backend)



def budget_probe(python,device=0):
    code=f"""import torch
assert torch.cuda.is_available()
torch.cuda.set_per_process_memory_fraction(.1,{device})
getter=getattr(torch.cuda,'get_per_process_memory_fraction',None)
if getter: assert abs(getter({device})-.1)<.0001
x=torch.ones((16,16),device='cuda:{device}',dtype=torch.bfloat16)
y=x@x;torch.cuda.synchronize({device});assert bool(torch.isfinite(y).all())
"""
    from limited_runtime import native_allocator_env
    try:return subprocess.run([str(python),'-c',code],env=native_allocator_env(os.environ),capture_output=True,timeout=45).returncode==0
    except (OSError,subprocess.SubprocessError):return False
