"""One node identity, one independent worker process per model lane."""
import json,os,signal,subprocess,sys,time
from pathlib import Path


def boot():return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def serve(worker):
    state=worker.NODE_STATE
    worker.save(state/'prepared-models.json',{'boot':boot(),'runtime_id':worker.runtime_id,'execution':worker.execution,'models':worker.installed_models,'profiles':worker.model_profiles,'hardware':worker.hardware_profile})
    children={};failures={m:0 for m in worker.selected_models};restart_at={};ready_announced=False
    def launch(model):
        from node_models import GPU_MODELS
        folder=state/'lanes'/GPU_MODELS[model]['slug'];folder.mkdir(parents=True,exist_ok=True)
        env=dict(os.environ,FUMIAO_LANE_MODEL=model,FUMIAO_RUNTIME_ID=worker.runtime_id,FUMIAO_PARENT_RUN=worker.runtime_id)
        with (folder/'worker.log').open('ab') as log:
            p=subprocess.Popen([sys.executable,'-u',str(worker.ROOT/'worker.py')],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        children[model]=p
        print('已启动独立执行通道：'+model,flush=True)
    def terminate_group(p):
        try:os.killpg(p.pid,signal.SIGTERM)
        except ProcessLookupError:pass
    for model in worker.selected_models:launch(model)
    try:
        while not worker.stopped.wait(1):
            ready=0
            for model,p in list(children.items()):
                if p.poll() is None:
                    try:
                        from node_models import GPU_MODELS
                        r=json.loads((state/'lanes'/GPU_MODELS[model]['slug']/'lane-ready.json').read_text())
                        if r['pid']==p.pid and r['runtime_id']==worker.runtime_id:ready+=1
                    except (OSError,ValueError,KeyError):pass
                    continue
                terminate_group(p)
                try:worker.api('/agent/heartbeat',{'stage':'error','lane_model':model,'ready_models':[model],'detail':'执行进程异常，正在恢复' if failures[model]<3 else '执行进程反复退出，请检查实例日志','runtime_id':worker.runtime_id,'can_accept':False})
                except OSError:pass
                if model not in restart_at:failures[model]+=1;restart_at[model]=time.monotonic()+10
                if failures[model]<=3 and time.monotonic()>=restart_at[model]:restart_at.pop(model,None);launch(model)
            if ready==len(children) and not ready_announced:
                worker.installation.update('安装完成，视频与语音并行通道已就绪','ready');ready_announced=True
    finally:
        for p in children.values():terminate_group(p)
        for p in children.values():
            try:p.wait(timeout=12)
            except subprocess.TimeoutExpired:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                p.wait(timeout=5)
