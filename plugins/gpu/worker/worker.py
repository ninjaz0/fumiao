#!/usr/bin/env python3
"""Portable v2 pull worker. Renderer runs locally; no platform database credentials."""
import argparse,hashlib,importlib.util,json,os,signal,subprocess,sys,time,urllib.request,urllib.error,uuid
from pathlib import Path
_clock_spec=importlib.util.spec_from_file_location('fumiao_worker_clock',Path(__file__).with_name('clock.py'))
_clock_module=importlib.util.module_from_spec(_clock_spec);_clock_spec.loader.exec_module(_clock_module)
JobClock=_clock_module.JobClock
TIMING_FIELDS=('prepare_s','generate_s','finalize_s','peak_vram_bytes','peak_allocated_vram_bytes','cold','recovered')

class Worker:
    def __init__(self,url,state,command,capabilities=None):
        self.url=url.rstrip('/');self.state=Path(state).resolve();self.state.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.command=command;self.token='';self.stopped=False;self.capabilities=json.loads(json.dumps(capabilities or {}));self.clock=None;self.progress={}
        if self.capabilities:self.capabilities.setdefault('context',{}).setdefault('runtime_id',uuid.uuid4().hex)
        if (self.state/'node.json').exists():self.token=json.loads((self.state/'node.json').read_text())['token']
    def save(self,path,value):
        tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value));os.chmod(tmp,0o600);tmp.replace(path)
    def api(self,path,body=None,method='POST',lease=None,receipt=None):
        headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'}
        if lease:headers['X-Job-Lease']=lease
        if receipt:headers.update({'X-Sha256':receipt['sha256'],'X-Job-Timing':json.dumps(receipt['report'],ensure_ascii=True,separators=(',',':'))})
        if isinstance(body,bytes):headers['Content-Type']='application/octet-stream';raw=body
        else:raw=json.dumps(body or {}).encode() if method!='GET' else None
        req=urllib.request.Request(self.url+'/agent/v2'+path,data=raw,headers=headers,method=method)
        with urllib.request.urlopen(req,timeout=60) as response:
            if method=='GET':return response.read()
            return json.load(response)
    def enroll(self,code,name,models):
        result=self.api('/enroll',{'code':code,'name':name,'models':models});self.token=result['token'];self.save(self.state/'node.json',result)
    def heartbeat(self,job=None):
        body=json.loads(json.dumps(self.capabilities))
        if job:
            body.update(jobId=job['id'],lease=job['lease'])
            if self.clock:
                phase,timing=self.clock.snapshot();body['report']={'job_phase':phase,'timing':{k:timing[k] for k in TIMING_FIELDS if timing.get(k) is not None},**self.progress}
        if 'queue' in body:body['queue']['stage']='busy' if job else 'ready'
        return self.api('/heartbeat',body)
    def execute(self,job):
        folder=self.state/job['id'];folder.mkdir(exist_ok=True,mode=0o700)
        self.save(folder/'request.json',job)
        cached=any((folder/name).exists() for name in ('result.json','verified.json','submission.json'))
        self.clock=JobClock(cold=None,recovered=cached,steps=job['params'].get('sampling_steps',20) if job['kind']=='video' else 1);self.progress={}
        progress_file=folder/'sampler-progress.json'
        for index,asset in enumerate(job['references']):
            target=folder/f'input-{index}'
            if not target.exists():
                raw=self.api(f"/jobs/{job['id']}/inputs/{asset}",method='GET',lease=job['lease'])
                pending=target.with_suffix('.tmp');pending.write_bytes(raw);os.chmod(pending,0o600);pending.replace(target)
        result=folder/'result.json';proc=None;cancelled=False
        if not result.exists():
            progress_file.unlink(missing_ok=True)
            args=[part.replace('{jobdir}',str(folder)) for part in self.command]
            proc=subprocess.Popen(args,cwd=folder,start_new_session=True)
        try:
            last=0
            while proc and proc.poll() is None:
                try:
                    if progress_file.stat().st_size<=65536:
                        progress=json.loads(progress_file.read_text());step=progress.get('step');steps=progress.get('steps')
                        if type(step) is int and type(steps) is int and steps==self.clock.steps and 0<=step<=steps and step>=self.progress.get('step',0):
                            self.progress={'step':step,'steps':steps};self.clock.observe_sampling(step,steps)
                except (OSError,ValueError,AttributeError):pass
                if time.monotonic()-last>15:
                    state=self.heartbeat(job);last=time.monotonic()
                    if state.get('cancelRequested'):cancelled=True;break
                if self.stopped:raise RuntimeError('Worker is stopping')
                time.sleep(0.5)
            if cancelled:
                self.stop_process(proc);self.api(f"/jobs/{job['id']}/fail",{'lease':job['lease'],'cancelled':True,'error':'任务已取消'});return
            if proc and proc.returncode!=0:
                # Renderer may have submitted work to its own engine. Do not guess whether it ran.
                raise RuntimeError('Renderer exited; retain the job for reconciliation')
            record=json.loads(result.read_text());path=Path(record['path']).resolve()
            if not path.is_relative_to(folder) or not path.is_file():raise RuntimeError('Renderer output must be inside job directory')
            if path.stat().st_size>128*1024*1024:raise RuntimeError('Renderer output exceeds 128 MiB')
            raw=path.read_bytes()
            fields=('h3_input_fingerprint','sampling_steps','fast_mode','peak_vram_bytes','peak_allocated_vram_bytes','prepare_s','generate_s','finalize_s','cold','recovered')
            report=record.get('report',{})
            self.clock.finish_render(cached=report.get('recovered',False));self.clock.begin_upload()
            measured=self.clock.snapshot()[1]
            # Renderer observations win; never conceal a mismatched sampler receipt.
            report={**measured,**report,'recovered':measured['recovered'] or bool(report.get('recovered',False))}
            receipt={'sha256':hashlib.sha256(raw).hexdigest(),'report':{k:report[k] for k in fields if report.get(k) is not None}}
            while not self.stopped:
                self.heartbeat(job)
                try:self.api(f"/jobs/{job['id']}/result",raw,method='PUT',lease=job['lease'],receipt=receipt);return
                except urllib.error.HTTPError as e:
                    if e.code not in (429,500,502,503,504):raise
                except (OSError,TimeoutError):pass
                time.sleep(5)
            raise RuntimeError('Stopped before delivery')
        finally:
            if proc and proc.poll() is None:self.stop_process(proc)
    def stop_process(self,proc):
        if proc and proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
    def run(self):
        active=self.state/'active.json'
        while not self.stopped:
            try:
                if active.exists():
                    job=json.loads(active.read_text());self.heartbeat(job)
                else:
                    self.heartbeat();job=self.api('/claim')['job']
                    if not job:time.sleep(3);continue
                    self.save(active,job)
                self.execute(job);active.unlink(missing_ok=True)
            except urllib.error.HTTPError as e:
                print('Platform response:',e.code,flush=True)
                if e.code in (401,403):return
                if e.code==409:active.unlink(missing_ok=True)
                elif e.code in (400,413,422):
                    print('Worker halted: rejected input or artifact; retain the local receipt for reconciliation',flush=True);return
                time.sleep(5)
            except Exception as e:
                # Keep the local receipt, but stop heartbeats so a lost execution becomes uncertain.
                print('Worker halted:',type(e).__name__,str(e),flush=True);return

def main():
    p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--state',default='.fumiao-gpu');p.add_argument('--name',default='GPU worker');p.add_argument('--models',nargs='+',default=['MiniMax H3']);p.add_argument('--renderer',required=True,help='JSON argv; {jobdir} is substituted without a shell');p.add_argument('--capabilities',help='JSON file containing verified context and serial queue readiness');a=p.parse_args()
    capabilities=json.loads(Path(a.capabilities).read_text()) if a.capabilities else None
    if capabilities is not None and (not isinstance(capabilities,dict) or set(capabilities)-{'context','queue'}):raise SystemExit('Capabilities may only contain context and queue')
    w=Worker(a.url,a.state,json.loads(a.renderer),capabilities)
    for event in (signal.SIGTERM,signal.SIGINT):signal.signal(event,lambda *_:setattr(w,'stopped',True))
    if not w.token:
        code=os.environ.pop('FUMIAO_PAIR_CODE','')
        if not code:raise SystemExit('首次启动需设置 FUMIAO_PAIR_CODE')
        w.enroll(code,a.name,a.models)
    w.run()
if __name__=='__main__':main()
