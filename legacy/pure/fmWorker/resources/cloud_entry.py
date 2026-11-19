"""fmWorker adapter around the platform's exact native H3/Breeze executor."""
import hashlib
import json
import os
import signal
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent
RUN_ID=''


def atomic(path,value):
    if path.name=='worker-status.json':value={'run_id':RUN_ID,**value}
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value));temp.chmod(0o600);temp.replace(path)


def prepare(config):
    archive=ROOT/'agent.tgz'
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=config['agent_sha256']:raise RuntimeError('执行器校验失败')
    target=ROOT/'agent';target.mkdir(exist_ok=True)
    with tarfile.open(archive) as package:package.extractall(target,filter='data')
    state=target/'state';state.mkdir(exist_ok=True,mode=0o700)
    atomic(state/'models.json',[config['model']])
    (state/'credential').write_text(config['secret']);(state/'credential').chmod(0o600)
    os.environ.update(FUMIAO_SITE=config['site'],H3_CACHE=str(ROOT/'models/h3'),BREEZE_HOME=str(ROOT/'models/breeze'),
                      FUMIAO_H3_FAST_I2V='1',H3_RESERVE_VRAM_GIB='3',FUMIAO_SEARCH_ROOTS=str(ROOT/'models'),
                      H3_PYTHON=sys.executable,FMWORKER_COLAB='1' if config.get('cloud') else '0')
    sys.path.insert(0,str(target))
    return target


def main():
    global RUN_ID
    os.umask(0o077)
    config=json.loads((ROOT/'config.json').read_text())
    RUN_ID=config['run_id']
    last_busy=time.time()
    atomic(ROOT/'worker-status.json',{'stage':'preparing','at':time.time(),'pid':os.getpid(),'last_busy':last_busy})
    installing=True
    def installation_pulse():
        while installing:
            atomic(ROOT/'worker-status.json',{'stage':'preparing','at':time.time(),'pid':os.getpid(),'last_busy':last_busy})
            time.sleep(10)
    threading.Thread(target=installation_pulse,daemon=True).start()
    target=prepare(config)
    # Dependencies are installed only inside the dedicated Linux runtime.
    subprocess.run([sys.executable,'-m','pip','install','requests','pyyaml','pillow','numpy','safetensors'],check=True)
    subprocess.run([sys.executable,'-m','pip','install','torch==2.9.1','torchaudio==2.9.1','torchvision==0.24.1','--index-url','https://download.pytorch.org/whl/cu128'],check=True)
    import worker
    from node_models import H3_TURBO_WORKFLOW
    original_api=worker.api
    matrix={'modes':['text','first','last','first_last','image','video','audio','mixed'],
            'steps':[4,16,20,32,50],'quality':[480,768],'seconds':[5,10,15]}
    original_prepare=worker.prepare
    def prepare_models():
        original_prepare()
        if config.get('drive_cache') and (ROOT/'drive-access.json').exists():
            def save_cache():
                try:
                    from drive_cache import DriveCache
                    from cache_manager import entries_for
                    cache=DriveCache(ROOT/'drive-access.json',print)
                    for item in entries_for([config['model']],target):
                        entry=item['entry'];path=Path(os.environ['H3_CACHE'])/'models'/entry['path']
                        if path.is_file():cache.store(entry,path)
                except Exception:print('Drive 缓存未完成，推理使用本地已校验模型',flush=True)
            threading.Thread(target=save_cache,daemon=True).start()
    worker.prepare=prepare_models
    # Restore the exact platform manifest into the execution cache before its
    # standard downloader runs; missing entries still use verified public sources.
    if config.get('drive_cache') and (ROOT/'drive-access.json').exists() and config['model']=='MiniMax H3':
        try:
            from drive_cache import DriveCache
            from cache_manager import entries_for
            cache=DriveCache(ROOT/'drive-access.json',print)
            for item in entries_for([config['model']],target):
                entry=item['entry'];destination=Path(os.environ['H3_CACHE'])/'models'/entry['path']
                if not destination.exists():cache.restore(entry,destination)
        except Exception:print('未恢复 Drive 缓存，将校验并补齐所需模型',flush=True)
    installing=False
    def api(path,data=None,method='POST',**kwargs):
        nonlocal last_busy
        if path=='/agent/heartbeat':
            if data.get('stage')=='busy':last_busy=time.time()
            atomic(ROOT/'worker-status.json',{'stage':data['stage'],'detail':data.get('detail',''),'ticket':data.get('ticket',''),
                   'at':time.time(),'last_busy':last_busy,'pid':os.getpid()})
            models=data.get('ready_models',[])
            body={'stage':data['stage'],'detail':data.get('detail',''),'ticket':data.get('ticket',''),
                  'capabilities':{'models':models,'h3':matrix} if config['model']=='MiniMax H3' else {'models':models},
                  'workflow':H3_TURBO_WORKFLOW if config['model']=='MiniMax H3' else 'breeze-tts-2-eager-v1','runtime_id':worker.runtime_id}
            response=original_api('/fmworker/heartbeat',body)
            if not config.get('cloud') and not response.get('enabled',True) and not data.get('ticket'):
                (ROOT/'drain').touch()
            return response|{'protocol':2,'execution_mode':'serial'}
        if path=='/agent/claim':
            if (ROOT/'drain').exists():
                worker.stopped.set();return {'job':None,'protocol':2}
            return original_api('/fmworker/claim',data,method,**kwargs)
        return original_api(path,data,method,**kwargs)
    worker.api=api
    try:worker.main()
    finally:atomic(ROOT/'worker-status.json',{'stage':'stopped','at':time.time(),'pid':os.getpid(),'last_busy':last_busy})

if __name__=='__main__':main()
