"""Bound the native PyTorch allocator without pre-importing a model's CLI/server."""
import importlib.abc,importlib.machinery,json,os,runpy,sys
from pathlib import Path


def process_rss(pid=None,field='VmRSS'):
    try:
        for line in Path('/proc/'+str(pid or os.getpid())+'/status').read_text().splitlines():
            if line.startswith(field+':'):return int(line.split()[1])*1024
    except OSError:pass
    return 0


def native_allocator_env(environment):
    env=dict(environment)
    for key in ['PYTORCH_CUDA_ALLOC_CONF',*[k for k in ('PYTORCH_ALLOC_CONF','PYTORCH_HIP_ALLOC_CONF') if k in env]]:
        parts=[p for p in env.get(key,'').split(',') if p and not p.strip().startswith('backend:')]
        env[key]=','.join([*parts,'backend:native'])
    return env


class ServerHook(importlib.abc.MetaPathFinder):
    """Instrument only after ComfyUI itself imports its server, after CLI setup."""
    def __init__(self,callback):self.callback=callback
    def find_spec(self,fullname,path=None,target=None):
        if fullname!='server':return None
        sys.meta_path.remove(self)
        spec=importlib.machinery.PathFinder.find_spec(fullname,path)
        if spec is None or spec.loader is None:raise ImportError('未找到固定版本的 ComfyUI server')
        original=spec.loader;callback=self.callback
        class Loader(importlib.abc.Loader):
            def create_module(self,child_spec):return original.create_module(child_spec) if hasattr(original,'create_module') else None
            def exec_module(self,module):original.exec_module(module);callback(module)
        spec.loader=Loader();return spec


def main():
    kind,device,budget,target,*args=sys.argv[1:];device=int(device);budget=float(budget)
    os.environ.update(native_allocator_env(os.environ))
    import torch
    if os.getenv('FUMIAO_CPU_THREADS'):torch.set_num_threads(max(1,int(os.environ['FUMIAO_CPU_THREADS'])))
    total=torch.cuda.get_device_properties(device).total_memory
    if budget<=0 or budget*2**30>total:raise RuntimeError('显存预算超出当前设备容量')
    fraction=budget*2**30/total;torch.cuda.set_per_process_memory_fraction(fraction,device)
    getter=getattr(torch.cuda,'get_per_process_memory_fraction',None);actual=getter(device) if getter else fraction
    if abs(actual-fraction)>1e-4:raise RuntimeError('显存额度设置未生效')
    backend=getattr(getattr(torch.cuda,'memory',None),'get_allocator_backend',None)
    if backend and backend()!='native':raise RuntimeError('显存预算需要 native 分配器')
    receipt=Path(os.environ['FUMIAO_LIMIT_RECEIPT']);receipt.parent.mkdir(parents=True,exist_ok=True)
    value={'pid':os.getpid(),'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'started':Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19],'budget_gib':budget,'device':device,'fraction':actual,'allocator':'native'}
    temp=receipt.with_name(receipt.name+'.next');temp.write_text(json.dumps(value));temp.replace(receipt)
    print('FUMIAO_MEMORY_LIMIT '+json.dumps(value),flush=True)
    def metrics():
        free,total=torch.cuda.mem_get_info(device)
        return {'pid':os.getpid(),'free_bytes':free,'total_bytes':total,'reserved_bytes':torch.cuda.memory_reserved(device),'peak_bytes':torch.cuda.max_memory_reserved(device),'allocated_bytes':torch.cuda.memory_allocated(device),'peak_allocated_bytes':torch.cuda.max_memory_allocated(device),'rss_bytes':process_rss(),'anonymous_bytes':process_rss(field='RssAnon'),'budget_gib':budget}
    def reset_metrics():
        torch.cuda.reset_peak_memory_stats(device)
        return metrics()
    if kind=='breeze':
        import uvicorn
        original=uvicorn.run
        def serve(app,*a,**kwargs):
            @app.get('/fumiao/resources')
            def resources():return metrics()
            @app.post('/fumiao/resources/reset')
            def reset_resources():return reset_metrics()
            return original(app,*a,**kwargs)
        uvicorn.run=serve
        sys.path.insert(0,str(Path.cwd()));sys.argv=[target,*args];runpy.run_module(target,run_name='__main__')
    elif kind=='h3':
        sys.path.insert(0,str(Path(target).parent));sys.argv=[target,*args]
        def instrument(server):
            original_routes=server.PromptServer.add_routes
            def add_routes(instance):
                from aiohttp import web
                @instance.routes.get('/fumiao/resources')
                async def resources(request):return web.json_response(metrics())
                @instance.routes.post('/fumiao/resources/reset')
                async def reset_resources(request):return web.json_response(reset_metrics())
                return original_routes(instance)
            server.PromptServer.add_routes=add_routes
        hook=ServerHook(instrument);sys.meta_path.insert(0,hook)
        try:runpy.run_path(target,run_name='__main__')
        finally:
            if hook in sys.meta_path:sys.meta_path.remove(hook)
    else:raise RuntimeError('未知运行器')


if __name__=='__main__':main()
