"""Install only selected adapters; detect container limits instead of host capacity."""
import sys,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root));sys.path.insert(0,str(root/'agent'))
import worker,hardware_probe
calls=[]
adapter=SimpleNamespace(prepare=Mock(return_value={'backend':'cuda','torch':'test','runtime':'12.6'}),ensure_service=Mock())
worker.selected_models=['breeze-tts-2'];worker.installed_models=[];worker.model_profiles={};worker.adapters={}
worker.hardware_profile={'gpu_name':'NVIDIA A10','backend':'cuda','vram_gib':22.5,'available_gpus':1,'used_gpus':1}
worker.installation=SimpleNamespace(update=lambda *args:None)
with patch('importlib.import_module',return_value=adapter) as load,patch.object(worker,'prepare_h3',side_effect=AssertionError('Unexpected 140GB H3 setup')),patch.object(worker,'beat'),patch.object(worker,'prepare_storage'),patch.object(worker,'release_video_for_audio'):
 worker.prepare()
 load.assert_called_once_with('breeze_adapter')
 assert worker.installed_models==['breeze-tts-2'] and set(worker.model_profiles)=={'breeze-tts-2'}
worker.selected_models=['MiniMax H3','breeze-tts-2'];worker.installed_models=[]
with patch('importlib.import_module',return_value=adapter),patch.object(worker,'prepare_h3',side_effect=lambda:calls.append('h3')),patch.object(worker,'kernel_probe'),patch.object(worker,'beat'),patch.object(worker,'prepare_storage'),patch.object(worker,'release_video_for_audio'):
 worker.prepare();assert worker.installed_models==['MiniMax H3','breeze-tts-2'] and calls==['h3']

def reads(p,*args,**kwargs):
 if str(p).endswith('memory.max'):return str(32*2**30)
 if str(p).endswith('cpu.max'):return '800000 100000'
 raise FileNotFoundError(str(p))
with patch.object(Path,'read_text',reads),patch.object(hardware_probe.os,'sysconf',side_effect=lambda key:4096 if key=='SC_PAGE_SIZE' else (512*2**30)//4096),patch.object(hardware_probe.os,'sched_getaffinity',return_value=set(range(64)),create=True):
 assert hardware_probe.ram_gib()==32 and hardware_probe.cpu_cores()==8
print('PASS model-only installation, dual adapters and cgroup-aware CPU/RAM detection')

assert hardware_probe.runtime_compatible({'torch':'2.13.0+cu130','backend':'cuda'},'cuda')
assert hardware_probe.runtime_compatible({'torch':'2.12.0+rocm7.2','backend':'rocm'},'rocm')
assert not hardware_probe.runtime_compatible({'torch':'2.3.1','backend':'cuda'},'cuda')
assert not hardware_probe.runtime_compatible({'torch':'2.9.1+cu126','backend':'cuda'},'rocm')
import runtime_cache
with tempfile.TemporaryDirectory() as d:
 home=Path(d);python=home/'venv/bin/python';python.parent.mkdir(parents=True);python.touch()
 (home/'platform-constraints.txt').write_text('torch==2.13.0+cu130\n')
 profile={'python':[3,12],'torch':'2.13.0+cu130','distribution':'2.13.0+cu130','runtime':'13.0','backend':'cuda'}
 with patch.object(runtime_cache,'kernel_probe',return_value=profile):assert runtime_cache.compatible(python,'cuda',0,minimum_python=(3,12))
 with patch.object(runtime_cache,'kernel_probe',return_value=profile|{'python':[3,10]}):assert not runtime_cache.compatible(python,'cuda',0,minimum_python=(3,12))
 with patch.object(runtime_cache,'kernel_probe',return_value=profile|{'backend':'rocm','torch':'2.12.0+rocm7.2','distribution':'2.12.0+rocm7.2'}):assert not runtime_cache.compatible(python,'rocm',0)
print('PASS Python version and inherited GPU-runtime drift invalidate only the incompatible environment')
