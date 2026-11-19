"""Check an existing isolated environment before invoking package downloads."""
import json,os,subprocess,time
from pathlib import Path
from hardware_probe import kernel_probe,runtime_compatible

BREEZE_REQUIREMENTS=['qwen-tts==0.1.1','transformers==4.57.3','huggingface-hub>=0.34,<1','soundfile>=0.13','fastapi>=0.115','uvicorn>=0.30','python-multipart']


def requirements(path):
    return [line.strip() for line in Path(path).read_text().splitlines() if line.strip() and not line.lstrip().startswith('#')]


def dependencies_ready(python,wanted,imports=()):
    script='''import json,sys,importlib
from importlib.metadata import version,PackageNotFoundError
from packaging.requirements import Requirement
wanted=json.loads(sys.argv[1]);issues=[]
for text in wanted:
 r=Requirement(text)
 if r.marker and not r.marker.evaluate():continue
 try:
  actual=version(r.name)
  if r.specifier and actual not in r.specifier:issues.append(r.name+': '+actual)
 except PackageNotFoundError:issues.append(r.name+': missing')
for module in json.loads(sys.argv[2]):
 try:importlib.import_module(module)
 except Exception:issues.append(module+': import failed')
print(json.dumps(issues))
sys.exit(bool(issues))'''
    try:
        r=subprocess.run([str(python),'-c',script,json.dumps(wanted),json.dumps(list(imports))],capture_output=True,text=True,timeout=90)
        return r.returncode==0
    except (OSError,subprocess.SubprocessError):return False


def compatible(python,backend,device,minimum=(2,9,1),minimum_python=(3,10)):
    try:
        profile=kernel_probe(str(python),device)
        if not runtime_compatible(profile,backend,minimum) or tuple(profile.get('python',[]))<minimum_python:return False
        constraints=Path(python).parent.parent.parent/'platform-constraints.txt'
        if constraints.exists():
            pins=[line.partition('==')[2] for line in constraints.read_text().splitlines() if line.startswith('torch==')]
            if pins and pins[0]!=profile.get('distribution',profile['torch']):return False
        return True
    except (OSError,RuntimeError,subprocess.SubprocessError):return False


def pip_ready(python):
    try:return subprocess.run([str(python),'-m','pip','--version'],capture_output=True,timeout=30).returncode==0
    except (OSError,subprocess.SubprocessError):return False


def create_environment(base_python,venv,system_site=True,progress=print):
    """Colab may ship venv but a broken ensurepip; never install into its base Python."""
    venv=Path(venv);python=venv/'bin/python'
    args=[str(base_python),'-m','venv',*(['--system-site-packages'] if system_site else [])]
    result=subprocess.run([*args,str(venv)],capture_output=True,text=True)
    if result.returncode:
        detail=(result.stdout or '')+(result.stderr or '')
        if 'ensurepip' not in detail:raise RuntimeError('创建独立 Python 环境失败：'+detail[-800:])
        progress('当前镜像的 ensurepip 不可用，使用现有安装工具创建独立环境')
        subprocess.run([*args,'--without-pip',str(venv)],check=True)
    if not pip_ready(python):
        progress('补齐独立环境中的 pip')
        subprocess.run([str(base_python),'-m','pip','--python',str(python),'install','pip>=23'],check=True)
    if not pip_ready(python):raise RuntimeError('独立 Python 环境中的 pip 无法运行')
    return python


def isolate(home,base_python,backend,device,system_site=True,minimum=(2,9,1),progress=print,minimum_python=(3,10),wanted=None,imports=()):
    home=Path(home);venv=home/'venv';python=venv/'bin/python'
    broken_imports=bool(python.exists() and wanted and dependencies_ready(python,wanted) and not dependencies_ready(python,wanted,imports))
    if python.exists() and compatible(python,backend,device,minimum,minimum_python) and not broken_imports and pip_ready(python):
        progress('沿用 GPU 运算检查通过的运行环境：'+str(venv));return python
    if venv.exists():
        if Path(base_python).is_relative_to(venv):
            base_python=subprocess.check_output([str(base_python),'-c','import sys;print(getattr(sys,"_base_executable",sys.executable))'],text=True,timeout=15).strip()
        backup=venv.with_name('venv.incompatible-'+str(time.time_ns()));venv.rename(backup);progress('旧运行环境与当前显卡或镜像不兼容，已保留：'+str(backup))
    home.mkdir(parents=True,exist_ok=True)
    return create_environment(base_python,venv,system_site,progress)


def disk_reserve(selected,root,backend,device):
    from node_models import GPU_MODELS
    from cache_manager import entries_for,GIB
    result=0
    for model in selected:
        spec=GPU_MODELS[model]
        if model=='MiniMax H3':
            home=Path(os.getenv('H3_CACHE','/opt/fumiao-h3'));req=next(p for p in (root/'engine/assets/requirements-amd.txt',root/'vendor/engine/assets/requirements-amd.txt') if p.exists());wanted=requirements(req);imports=('torch','transformers','safetensors')
        else:home=Path(os.getenv('BREEZE_HOME','/opt/fumiao-breeze'));wanted=BREEZE_REQUIREMENTS;imports=('torch','transformers','qwen_tts','soundfile')
        py=home/'venv/bin/python'
        ready=py.exists() and compatible(py,backend,device,minimum_python=tuple(spec['min_python'])) and dependencies_ready(py,wanted,imports)
        weight_bytes=sum(i['entry']['bytes'] for i in entries_for([model],root))
        result+=512*1024**2 if ready else max(4*GIB,int(spec['disk_gib']*GIB-weight_bytes))
    return result


if __name__=='__main__':
    import sys
    action=sys.argv[1]
    if action=='check':raise SystemExit(0 if dependencies_ready(sys.argv[2],requirements(sys.argv[3]),('torch','transformers','safetensors')) else 1)
    if action=='isolate':
        p=isolate(sys.argv[2],sys.argv[3],sys.argv[4],int(sys.argv[5]),minimum_python=(3,12),wanted=requirements(sys.argv[6]) if len(sys.argv)>6 else None,imports=('torch','transformers','safetensors'));print(p)
