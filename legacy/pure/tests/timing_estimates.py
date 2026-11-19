"""Deterministic timing, queue simulation and telemetry tests; no GPU/API billing."""
import io
import json
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path
from unittest.mock import patch

tmp=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=tmp.name,FUMIAO_SITE='http://testserver',OPENAI_API_KEY='sk-timing-test-only')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import core
import timing
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
from worker_api import TimingReport


def okay(r):
    assert r.is_success,(r.status_code,r.text[:300]);return r.json()


code=core.token()
with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",(code,core.now()+60))
a=TestClient(app);anon=TestClient(app)
okay(a.post('/api/register',json={"nickname": '计时管理员', 'name':'计时管理员','password':'timing-test-secret-2026','code':code}))
base=float(core.now())


def new_job(con, *, created=base-1000, kind='video', seconds=5, quality=480, refs=None):
    jid=con.execute("""INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,image_quality,attempts,ticket)
     VALUES(?,1,'not retained in metrics',?,'16:9',?,?,1,864,480,'running',?,?,?,?,'medium',1,?)""",(str(uuid.uuid4()),json.dumps(refs or []),quality,seconds,created,created,kind,'MiniMax H3' if kind=='video' else 'gpt-image-2.6-sunburst',core.token())).lastrowid
    return dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())


hardware={'id':1,'hardware':'AMD-test|192GiB','workflow':timing.WORKFLOW,'runtime_id':'runtime-A'}
with core.db(True) as con:
    j=new_job(con,created=base-500)
    run=timing.start_run(con,j,hardware,timestamp=base-400)
    timing.mark_phase(con,j,'generating',base-380)
    timing.mark_phase(con,j,'finalizing',base-250)
    timing.mark_phase(con,j,'uploading',base-220)
    timing.mark_phase(con,j,'validating',base-210)
    timing.end_run(con,j,'done',base-200)
    timing.end_run(con,j,'done',base-190) # replay must not shift completion
    con.execute("UPDATE jobs SET status='done',updated=? WHERE id=?",(base-200,j['id']))
    row=timing.current_run(con,j['id'])
    d=timing.elapsed_detail(row,base)
    assert d['queue']==100 and d['elapsed']==200 and d['total']==300
    assert (d['prepare'],d['generation'],d['finalize'],d['upload'],d['validation'])==(20,130,30,10,10)
    assert con.execute('SELECT count(*) FROM job_runs WHERE job=?',(j['id'],)).fetchone()[0]==1
    assert 'not retained' not in row['features']
    f=timing.features(j,con,hardware)
    result=timing.Estimator(con).estimate(f)
    assert result['median']==200 and result['source']=='history' and result['samples']==1
    assert result['high']>result['median']>result['low']
    assert timing.Estimator(con).estimate(f | {'seconds':15})['source']=='none'
    assert timing.Estimator(con).estimate(f | {'hardware':'different-GPU'})['source']=='none'
    assert timing.Estimator(con).estimate(f | {'workflow':'different-engine'})['source']=='none'
    # Failed/cancelled attempts never train the successful-duration estimator.
    failed=new_job(con)
    timing.start_run(con,failed,hardware,base-300)
    timing.end_run(con,failed,'failed',base-1)
    assert timing.Estimator(con).estimate(f)['samples']==1
    cancelled=new_job(con)
    timing.end_run(con,cancelled,'cancelled',base)
    assert timing.current_run(con,cancelled['id'])['started'] is None
    # Deleted works leave only anonymous parameter/timing samples.
    con.execute('DELETE FROM jobs WHERE id=?',(j['id'],))
    assert con.execute('SELECT job FROM job_runs WHERE id=?',(row['id'],)).fetchone()[0] is None
    assert timing.Estimator(con).estimate(f)['median']==200
    # A resumed lease is measurable but excluded from training.
    resumed=new_job(con)
    timing.start_run(con,resumed,hardware,base-100)
    timing.end_run(con,resumed,'interrupted',base-70)
    timing.observe(con,resumed,{'step':2,'steps':20,'timing':{'recovered':False}},base-60)
    timing.end_run(con,resumed,'done',base-20)
    assert timing.current_run(con,resumed['id'])['valid']==0
    assert timing.Estimator(con).estimate(f)['samples']==1
    # Each new ticket creates an independent attempt and start time.
    retry=new_job(con)
    timing.start_run(con,retry,hardware,base-300)
    timing.end_run(con,retry,'interrupted',base-200)
    con.execute('UPDATE jobs SET ticket=?,attempts=2 WHERE id=?',(core.token(),retry['id']))
    retry=dict(con.execute('SELECT * FROM jobs WHERE id=?',(retry['id'],)).fetchone())
    timing.start_run(con,retry,hardware,base-100)
    assert con.execute('SELECT count(*) FROM job_runs WHERE job=?',(retry['id'],)).fetchone()[0]==2
    assert timing.elapsed_detail(timing.current_run(con,retry['id']),base)['queue']==100
    timing.observe(con,retry,{'step':4,'steps':4},base-95)
    assert timing.current_run(con,retry['id'])['phase']=='preparing'
    # Repeated heartbeat values don't invent new progress samples.
    for step,stamp in [(1,base-90),(1,base-85),(2,base-80),(3,base-70)]:
        timing.observe(con,retry,{'step':step,'steps':20},stamp)
    row=timing.current_run(con,retry['id'])
    assert len(json.loads(row['progress']))==3
    eta=timing.remaining(row,base-60)
    assert eta['source']=='progress' and eta['high']>0
    assert json.loads(row['details'])['eta_history'][-1]['source']=='progress'
    later=timing.remaining(row,base+1000)
    assert later['overdue'] and later['high']==0
    timing.mark_phase(con,retry,'uploading',base-10)
    timing.observe(con,retry,{'step':3,'steps':20},base-5)
    assert timing.current_run(con,retry['id'])['phase']=='uploading'
    # A trusted-looking but impossible interval cannot overwrite observed phases.
    timing.observe(con,retry,{'timing':{'generate_s':170000}},base)
    assert 'generate_s' not in json.loads(timing.current_run(con,retry['id'])['details'])
    # Multi-GPU waiting uses the earliest available slot, not a serial sum.
    active=new_job(con,created=base-100)
    active['node']=1
    active['status']='running'
    r={'started':base-100,'phase':'generating','predicted':json.dumps({'source':'history','low':200,'median':200,'high':200}), 'progress':'[]','step':0,'steps':20}
    n1=hardware | {'lastseen':base,'stage':'busy','control':'active'}
    n2=hardware | {'id':2,'lastseen':base,'stage':'ready','control':'active'}
    queued=[]
    for _ in range(3):
        q=new_job(con);q.update(status='queued',node=None);queued.append(q)
    plans=timing.queue_estimates(con,[active]+queued,[n1,n2],{active['id']:r},timing.Estimator(con),base)
    assert plans[queued[0]['id']]['median']==0
    assert plans[queued[1]['id']]['median']==100
    assert plans[queued[2]['id']]['median']==200
    offline=timing.queue_estimates(con,queued,[n1|{'lastseen':0}],{},timing.Estimator(con),base)
    assert all(p['reason']=='waiting_gpu' for p in offline.values())
    # Legacy records remain end-to-end references, never fake generation samples.
    legacy=new_job(con,kind='image',created=base-27)
    con.execute("UPDATE jobs SET status='done',updated=? WHERE id=?",(base,legacy['id']))
    timing.import_legacy(con)
    old=timing.current_run(con,legacy['id'])
    assert old['started'] is None and old['status']=='legacy'
    fimage=timing.features(legacy,con)
    estimate=timing.Estimator(con).estimate(fimage)
    assert estimate['source']=='legacy' and estimate['median']==27
    assert timing.elapsed_detail(old,base)['source']=='legacy'

assert anon.post('/api/estimate',json={}).status_code==401
assert a.post('/api/estimate',json={'kind':'bad'}).status_code==400
assert a.post('/api/estimate',json={'seconds':99}).status_code==400
assert a.post('/api/estimate',json={'refs':['missing']}).status_code==404
response=okay(a.post('/api/estimate',json={}))
assert response['duration']['source']=='none' and response['queue']['reason']=='waiting_gpu'
# Full HTTP claimant and heartbeat path, including stale-ticket rejection.
command=okay(a.post('/api/pairs',json={}))['command'];code=command.split()[-1];secret=core.token()
okay(anon.post('/agent/enroll',json={'code':code,'secret':secret}))
gpu=TestClient(app,headers={'Authorization':'Bearer '+secret})
okay(gpu.post('/agent/heartbeat',json={'stage':'ready','hardware':hardware['hardware'],'runtime_id':'runtime-A','workflow':timing.WORKFLOW}))
jid=okay(a.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'timing HTTP smoke'}))['id']
claimed=okay(gpu.post('/agent/claim'))['job'];assert claimed['id']==jid
with core.db() as con:assert timing.current_run(con,jid)['status']=='running'
okay(gpu.post('/agent/heartbeat',json={'stage':'busy','ticket':claimed['ticket'],'step':2,'steps':20,'job_phase':'generating'}))
assert not okay(gpu.post('/agent/heartbeat',json={'stage':'busy','ticket':'invalid','step':19,'steps':20}))['held']
job_state=next(j for j in okay(a.get('/api/state'))['jobs'] if j['id']==jid)
assert job_state['eta']['phase']=='generating' and job_state['timing']['source']=='measured'
with core.db() as con:assert timing.current_run(con,jid)['step']==2
okay(gpu.post(f'/agent/jobs/{jid}/error',json={'stage':'error'},headers={'X-Job-Ticket':claimed['ticket']}))
with core.db() as con:assert timing.current_run(con,jid)['status']=='failed'
# Local worker monotonic snapshots and recovery flags.
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
from job_progress import JobClock
clock=[0.0];jobclock=JobClock(True,clock=lambda:clock[0])
clock[0]=5;jobclock.observe_sampling(4,4);assert jobclock.snapshot()[0]=='preparing'
clock[0]=10;jobclock.observe_sampling(0,20)
clock[0]=110;jobclock.observe_sampling(20,20)
clock[0]=125;jobclock.finish_render();clock[0]=130;jobclock.begin_upload()
phase,metrics=jobclock.snapshot()
assert phase=='uploading' and metrics=={'cold':True,'recovered':False,'sampling_steps':20,'fast_mode':False,'prepare_s':10.0,'generate_s':100.0,'finalize_s':20.0}
jobclock.finish_render(cached=True);assert jobclock.snapshot()[1]['recovered']
print('PASS phase boundaries, queue exclusion, retries, stale tickets, retained anonymous samples, legacy labels, cohort isolation, parallel GPUs, progress ETA, overdue and worker clocks')

# Hardware grouping distinguishes task GPU use from total available devices.
p1={'backend':'cuda','gpu_name':'NVIDIA A100','vram_gib':80,'available_gpus':1,'used_gpus':1,'runtime':'12.8','driver':'580','torch_version':'2.8','precision':'bf16','attention':'pytorch','memory_mode':'default','cpu_cores':16,'ram_gib':128}
assert timing.hardware_signature(p1)==timing.hardware_signature(p1|{'available_gpus':8,'cpu_cores':64,'ram_gib':512})
for change in ({'used_gpus':2},{'vram_gib':40},{'gpu_name':'NVIDIA L40S'},{'precision':'fp8'},{'memory_mode':'cpu-offload'},{'attention':'flash'},{'runtime':'12.9'},{'driver':'590'}):
    assert timing.hardware_signature(p1)!=timing.hardware_signature(p1|change)
with core.db(True) as con:
    # Reported new hardware must not inherit timings from unknown legacy nodes.
    j=new_job(con); f=timing.features(j,con,{'id':99,'profile':json.dumps(p1),'runtime_id':'new-boot'})
    assert timing.Estimator(con).estimate(f,99)['source']=='none'
print('PASS hardware/runtime isolation, no theoretical GPU-count scaling and unknown-instance calibration')

with core.db(True) as con:
    for node_id,duration in [(31,100),(32,300)]:
        for index in range(3):
            j=new_job(con,created=base-1000);j['node']=node_id
            node={'id':node_id,'hardware':'same-hardware','workflow':timing.WORKFLOW,'runtime_id':f'boot-{node_id}'}
            timing.start_run(con,j,node,base-900)
            timing.end_run(con,j,'done',base-900+duration,telemetry={'cold':False})
    engine=timing.Estimator(con)
    target=timing.features(j,con,{'id':31,'hardware':'same-hardware','workflow':timing.WORKFLOW,'runtime_id':'boot-31'})
    fast=engine.estimate(target,31)
    slow=engine.estimate(target|{'runtime_id':'boot-32'},32)
    assert fast['calibrated'] and fast['median']==100
    assert slow['calibrated'] and slow['median']==300
    assert not engine.estimate(target|{'runtime_id':'boot-33'},33)['calibrated']
print('PASS instance-specific calibration preserves different observed speeds on equivalent GPUs')

# A measured cold run can conservatively cover warm work before a warm sample exists.
with core.db(True) as con:
    h={'id':88,'hardware':'cold-fallback-only','workflow':timing.WORKFLOW,'runtime_id':'boot-cold'}
    j=new_job(con);j['node']=88
    timing.start_run(con,j,h,base-600)
    timing.end_run(con,j,'done',base-300,telemetry={'cold':True})
    target=timing.features(j,con,h)|{'cold':False}
    prediction=timing.Estimator(con).estimate(target,88)
    assert prediction['source']=='cold_reference' and prediction['median']==300 and prediction['confidence']=='low'
    # The reverse is unsafe: warm timing cannot invent an unobserved model loading cost.
    h={'id':89,'hardware':'warm-only','workflow':timing.WORKFLOW,'runtime_id':'boot-warm'}
    j=new_job(con);j['node']=89
    timing.start_run(con,j,h,base-300)
    timing.end_run(con,j,'done',base-100,telemetry={'cold':False})
    assert timing.Estimator(con).estimate(timing.features(j,con,h)|{'cold':True},89)['source']=='none'
print('PASS conservative cold-to-warm fallback and no invented warm-to-cold loading cost')
