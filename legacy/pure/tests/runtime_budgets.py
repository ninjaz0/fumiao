"""Allocator launcher wiring and admission math without a real GPU."""
import sys,tempfile,json,os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root),str(root/'agent')]
import limited_runtime,resource_gate
from node_models import execution_plan
hardware={'ram_gib':200,'devices':[{'index':0,'name':'AMD','backend':'rocm','vram_gib':192,'free_gib':190}]}
p=execution_plan(hardware,['MiniMax H3','breeze-tts-2']);voice=p['lanes']['breeze-tts-2'];G=2**30
assert resource_gate.enough(voice,p,20*G,8*G,40*G,8*G)[0]
assert not resource_gate.enough(voice,p,2*G,8*G,40*G,8*G)[0]
assert not resource_gate.enough(voice,p,20*G,8*G,10*G,8*G)[0]
assert not resource_gate.enough(voice,p,20*G,8*G,None,8*G)[0]
# Actual container downloads populate reclaimable file cache; those pages must
# not make an otherwise idle 200 GiB instance wait indefinitely for RAM.
def available_fixture(files):
 def read(path,*args,**kwargs):
  if str(path) not in files:raise FileNotFoundError(path)
  return files[str(path)]
 with patch.object(Path,'read_text',read):return resource_gate.memory_available()
v1='/sys/fs/cgroup/memory/'
files={'/proc/meminfo':f'MemAvailable: {180*G//1024} kB\n',v1+'memory.limit_in_bytes':str(200*G),v1+'memory.usage_in_bytes':str(150*G),v1+'memory.stat':f'total_inactive_file {140*G}\ntotal_dirty {2*G}\ntotal_writeback {G}\nrss {8*G}\n'}
assert available_fixture(files)==180*G # Still capped by host MemAvailable.
files['/proc/meminfo']=f'MemAvailable: {240*G//1024} kB\n'
assert available_fixture(files)==187*G
files[v1+'memory.stat']=f'total_active_file {140*G}\ntotal_inactive_file 0\ntotal_cache {140*G}\n'
assert available_fixture(files)==190*G
assert resource_gate.enough(p['lanes']['MiniMax H3'],p,180*G,0,available_fixture(files),8*G)[0]
files[v1+'memory.stat']=f'total_active_file {100*G}\ntotal_inactive_file {40*G}\ntotal_cache {140*G}\ntotal_shmem {50*G}\ntotal_dirty {2*G}\ntotal_writeback {G}\n'
assert available_fixture(files)==137*G
files[v1+'memory.stat']=f'total_inactive_file {5*G}\ntotal_dirty {7*G}\n'
assert available_fixture(files)==50*G # Dirty cache and anonymous RAM are not freed.
files.pop(v1+'memory.stat');assert available_fixture(files)==50*G
v2='/sys/fs/cgroup/'
assert available_fixture({'/proc/meminfo':f'MemAvailable: {240*G//1024} kB\n',v2+'memory.max':str(200*G),v2+'memory.current':str(150*G),v2+'memory.stat':f'inactive_file {100*G}\nfile_dirty {2*G}\nfile_writeback {G}\nshmem {20*G}\n'})==147*G
assert available_fixture({'/proc/meminfo':f'MemAvailable: {240*G//1024} kB\n',v2+'memory.max':str(200*G),v2+'memory.current':str(150*G),v2+'memory.stat':f'active_file {100*G}\ninactive_file {40*G}\nfile {140*G}\nshmem {50*G}\nfile_dirty {2*G}\nfile_writeback {G}\n'})==137*G
assert available_fixture({}) is None
print('PASS cgroup v1/v2 clean active/inactive cache, tmpfs and dirty-page exclusion, host cap and missing-stat fallback')

with tempfile.TemporaryDirectory() as d:
 directory=Path(d);receipt=directory/'limit.json';calls=[];fraction=[None]
 cuda=SimpleNamespace(get_device_properties=lambda _:SimpleNamespace(total_memory=192*G),set_per_process_memory_fraction=lambda f,i:(fraction.__setitem__(0,f),calls.append(('set',i,f))),get_per_process_memory_fraction=lambda _:fraction[0],mem_get_info=lambda _:(180*G,192*G),memory_reserved=lambda _:8*G,max_memory_reserved=lambda _:9*G,memory_allocated=lambda _:7*G,max_memory_allocated=lambda _:8*G,reset_peak_memory_stats=lambda _:calls.append(('reset',)))
 torch=SimpleNamespace(cuda=cuda,set_num_threads=lambda n:None)
 class App:
  def __init__(self):self.routes={}
  def get(self,path):return lambda f:(self.routes.__setitem__(path,f) or f)
  post=get
 app=App();uvicorn=SimpleNamespace(run=lambda current,*a,**k:calls.append(('serve',current)))
 def run_module(*args,**kwargs):
  assert calls[0][0]=='set';assert sys.path[0]==str(Path.cwd());uvicorn.run(app)
 old_read=Path.read_text
 def read(path,*a,**k):
  if str(path)=='/proc/sys/kernel/random/boot_id':return 'test-boot'
  if str(path)=='/proc/self/stat':return '1 (python) '+' '.join(['S']+['0']*18+['1234'])
  return old_read(path,*a,**k)
 with patch.dict(sys.modules,{'torch':torch,'uvicorn':uvicorn}),patch.dict(os.environ,{'FUMIAO_LIMIT_RECEIPT':str(receipt)}),patch.object(sys,'argv',['limited_runtime.py','breeze','0','12','breeze_infer.api','checkpoint']),patch.object(limited_runtime.runpy,'run_module',side_effect=run_module),patch.object(Path,'read_text',read):limited_runtime.main()
 assert abs(fraction[0]-12/192)<1e-8 and '/fumiao/resources' in app.routes
 assert json.loads(receipt.read_text())['budget_gib']==12
 assert app.routes['/fumiao/resources']()['peak_bytes']==9*G
 assert app.routes['/fumiao/resources/reset']()['peak_allocated_bytes']==8*G and ('reset',) in calls
print('PASS memory limits applied before model imports, speech module path, resource endpoint, and conservative VRAM/RAM admission')
# H3 must keep its normal argument-parsing order: importing server early changes
# the port and VRAM policy back to defaults. The hook runs after the real import.
with tempfile.TemporaryDirectory() as d:
 directory=Path(d);receipt=directory/'limit.json';marker=directory/'cli-ready';seen=[]
 (directory/'server.py').write_text("from pathlib import Path\nassert Path("+repr(str(marker))+").exists(), 'server imported before CLI'\nclass Routes:\n def __init__(self): self.paths=[]\n def get(self,path):\n  self.paths.append(path)\n  return lambda f:f\n post=get\nclass PromptServer:\n def __init__(self):self.routes=Routes()\n def add_routes(self):return 42\n")
 def run_h3(path,run_name):
  assert 'server' not in sys.modules
  assert sys.argv==[str(directory/'main.py'),'--port','18388','--reserve-vram','28']
  marker.write_text('ready')
  import server
  instance=server.PromptServer();assert instance.add_routes()==42;seen.extend(instance.routes.paths)
 with patch.dict(sys.modules,{'torch':torch,'aiohttp':SimpleNamespace(web=SimpleNamespace(json_response=lambda x:x))}),patch.dict(os.environ,{'FUMIAO_LIMIT_RECEIPT':str(receipt),'PYTORCH_CUDA_ALLOC_CONF':'backend:cudaMallocAsync,max_split_size_mb:64'}),patch.object(sys,'argv',['limited_runtime.py','h3','0','164',str(directory/'main.py'),'--port','18388','--reserve-vram','28']),patch.object(limited_runtime.runpy,'run_path',side_effect=run_h3),patch.object(Path,'read_text',read):
  sys.modules.pop('server',None);limited_runtime.main()
  assert os.environ['PYTORCH_CUDA_ALLOC_CONF']=='max_split_size_mb:64,backend:native'
 sys.modules.pop('server',None)
 assert seen==['/fumiao/resources','/fumiao/resources/reset']
print('PASS H3 CLI parsing preserved, late server instrumentation and native allocator enforcement')
