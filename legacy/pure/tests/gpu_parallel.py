"""Per-model leases and credit-safe controls on one physical GPU node."""
import os,sys,tempfile,uuid,json
from pathlib import Path
from fastapi.testclient import TestClient
folder=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=folder.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,timing,gpu_lanes
from server import app
from node_models import execution_plan
client=TestClient(app)
with core.db(True) as c:
 c.execute("INSERT INTO users(name,role) VALUES('parallel-admin','admin')");key=core.token();c.execute('INSERT INTO sessions VALUES(?,1,?)',(core.hashed(key),core.now()+900));c.execute('UPDATE credit_prices SET amount=1');c.execute('UPDATE credit_accounts SET balance=100')
client.cookies.set('fm_session',key)
def ok(r):assert r.is_success,(r.status_code,r.text[:350]);return r.json()
selected=['MiniMax H3','breeze-tts-2'];gpu={'index':0,'name':'AMD MI300X','backend':'rocm','vram_gib':192,'free_gib':190}
facts={'devices':[gpu],'ram_gib':200};plan=execution_plan(facts,selected);assert plan['mode']=='parallel' and plan['shared_gpu']
assert execution_plan(facts|{'devices':[gpu|{'vram_gib':96}]},selected)['mode']=='serial'
separate=execution_plan({'devices':[gpu|{'vram_gib':96},gpu|{'index':1,'vram_gib':24}],'ram_gib':160},selected)
assert separate['mode']=='parallel' and not separate['shared_gpu']
secret=core.token()
with core.db(True) as c:nid=c.execute("INSERT INTO nodes(owner,name,key,stage,lastseen,models,ready_models) VALUES(1,'parallel',?,'preparing',?,?,'[]')",(core.hashed(secret),core.now(),json.dumps(selected))).lastrowid
node=TestClient(app,headers={'Authorization':'Bearer '+secret})
profile={'gpu_name':'AMD MI300X','backend':'rocm','vram_gib':192,'available_gpus':1,'used_gpus':1,'ram_gib':200}
ok(node.post('/agent/heartbeat',json={'stage':'preparing','execution_plan':plan,'profile':profile,'runtime_id':'boot-one','ready_models':[]}))
for stage,detail in [('preparing','正在下载模型 42%'),('error','依赖文件校验失败'),('preparing','正在恢复安装')]:
 ok(node.post('/agent/heartbeat',json={'stage':stage,'detail':detail,'ready_models':[]}))
 with core.db() as c:
  parent=c.execute('SELECT stage,detail FROM nodes WHERE id=?',(nid,)).fetchone()
  assert (parent['stage'],parent['detail'])==(stage,detail)
audio=TestClient(app,headers={'Authorization':'Bearer '+secret,'X-Model-Lane':'breeze-tts-2'});video=TestClient(app,headers={'Authorization':'Bearer '+secret,'X-Model-Lane':'MiniMax H3'})
def beat(c,model,stage='ready',**kw):return c.post('/agent/heartbeat',json={'stage':stage,'lane_model':model,'ready_models':[model],'model_profiles':{model:profile},'profile':profile,'runtime_id':'boot-one'}|kw)
ok(beat(video,'MiniMax H3'));ok(beat(audio,'breeze-tts-2'))
assert ok(node.post('/agent/claim'))['job'] is None
v=ok(client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'model':'MiniMax H3','prompt':'test'}))['id']
a=ok(client.post('/api/audio-jobs',json={'uid':str(uuid.uuid4()),'model':'breeze-tts-2','prompt':'你好'}))['id']
vj=ok(video.post('/agent/claim'))['job'];aj=ok(audio.post('/agent/claim'))['job'];assert vj['id']==v and aj['id']==a and vj['ticket']!=aj['ticket']
assert ok(video.post('/agent/claim'))['job']['id']==v and ok(audio.post('/agent/claim'))['job']['id']==a
assert not ok(beat(audio,'breeze-tts-2','busy',ticket=vj['ticket']))['held']
assert ok(beat(audio,'breeze-tts-2','busy',ticket=aj['ticket']))['held']
assert ok(beat(video,'MiniMax H3','busy',ticket=vj['ticket']))['held']
with core.db() as c:
 n=dict(c.execute('SELECT * FROM nodes WHERE id=?',(nid,)).fetchone());assert set(json.loads(n['ready_models']))==set(selected);assert set(json.loads(n['model_profiles']))==set(selected)
 assert c.execute("SELECT count(*) FROM jobs WHERE node=? AND status='running'",(nid,)).fetchone()[0]==2
assert node.post('/agent/heartbeat',json={'stage':'ready','execution_plan':{'mode':'serial'}}).status_code==409
# A single expired lane may recover while the other lane still holds its lease.
with core.db(True) as c:c.execute('UPDATE jobs SET lease=? WHERE id=?',(core.now()-1,a));core.reap(c)
assert ok(beat(audio,'breeze-tts-2','busy',ticket=aj['ticket']))['held']
second=ok(client.post('/api/audio-jobs',json={'uid':str(uuid.uuid4()),'model':'breeze-tts-2','prompt':'第二条'}))['id']
with core.db(True) as c:c.execute("UPDATE jobs SET status='done',lease=NULL WHERE id=?",(a,))
ok(beat(audio,'breeze-tts-2',can_accept=False));assert ok(audio.post('/agent/claim'))['job'] is None
ok(beat(audio,'breeze-tts-2',can_accept=True));assert ok(audio.post('/agent/claim'))['job']['id']==second
# Remove/stop invalidates both tickets and returns both jobs to the shared queue.
ok(client.post(f'/api/nodes/{nid}/stop',json={}))
with core.db() as c:
 assert c.execute("SELECT count(*) FROM jobs WHERE node=? AND status='running'",(nid,)).fetchone()[0]==0
 assert all(r['status']=='queued' for r in c.execute('SELECT status FROM jobs WHERE id IN (?,?)',(v,second)))
# Budgets must fit the same physical card and RAM; two cards do not become one big card.
for bad in [plan|{'ram_total_gib':64},plan|{'ram_total_gib':'bad'},plan|{'lanes':[]},plan|{'reserve_vram_gib':{}},plan|{'lanes':plan['lanes']|{'MiniMax H3':plan['lanes']['MiniMax H3']|{'gpu_budget_gib':190}}}]:
 try:gpu_lanes.validate(bad,selected);raise AssertionError('invalid budget')
 except Exception as e:assert getattr(e,'status_code',None)==400,e
print('PASS same-card/dedicated-card plans, independent claims/heartbeats, lane capacity, resource gating, lease recovery, model profiles, stop-all and budget validation')
# Queue forecasts use the occupied model lane, not the first running job on this node.
ok(client.post(f'/api/nodes/{nid}/resume',json={}))
ok(beat(video,'MiniMax H3'));ok(beat(audio,'breeze-tts-2'))
vj=ok(video.post('/agent/claim'))['job'];aj=ok(audio.post('/agent/claim'))['job']
vnext=ok(client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'model':'MiniMax H3','prompt':'next'}))['id']
anext=ok(client.post('/api/audio-jobs',json={'uid':str(uuid.uuid4()),'model':'breeze-tts-2','prompt':'下一条'}))['id']
class Fixed:
 def estimate(self,f,*args):return {'source':'history','samples':3,'confidence':'high','low':60 if f['kind']=='video' else 20,'median':60 if f['kind']=='video' else 20,'high':60 if f['kind']=='video' else 20}
with core.db(True) as c:
 stamp=core.now()
 for job,seconds in [(vj,60),(aj,20)]:c.execute("UPDATE job_runs SET started=?,predicted=? WHERE job=? AND status='running'",(stamp,json.dumps({'low':seconds,'median':seconds,'high':seconds}),job['id']))
 jobs=[dict(r) for r in c.execute("SELECT * FROM jobs WHERE status IN ('queued','running')")]
 forecasts=timing.local_queue_estimates(c,jobs,timing.all_nodes(c),timing.read_runs(c),Fixed(),stamp)
 assert forecasts[vnext]['median']==60 and forecasts[anext]['median']==20,forecasts
print('PASS parallel audio/video queue estimates remain independent on one node')

# A restarted parent must not inherit the recently-ready lanes of the old run.
replacement=core.token()
with core.db(True) as c:
 restart_id=c.execute("INSERT INTO nodes(owner,name,key,stage,lastseen,models,ready_models) VALUES(1,'restart-check',?,'preparing',?,?,'[]')",(core.hashed(replacement),core.now(),json.dumps(selected))).lastrowid
restart=TestClient(app,headers={'Authorization':'Bearer '+replacement})
ok(restart.post('/agent/heartbeat',json={'stage':'preparing','execution_plan':plan,'runtime_id':'previous-run','ready_models':[]}))
for model in selected:
 ok(restart.post('/agent/heartbeat',json={'stage':'ready','lane_model':model,'runtime_id':'previous-run','ready_models':[model],'can_accept':True}))
ok(restart.post('/agent/heartbeat',json={'stage':'preparing','runtime_id':'restored-run','ready_models':[],'detail':'正在校验已有模型'}))
with core.db() as c:
 parent=dict(c.execute('SELECT stage,detail,ready_models FROM nodes WHERE id=?',(restart_id,)).fetchone())
 assert parent=={'stage':'preparing','detail':'正在校验已有模型','ready_models':'[]'},parent
 assert not c.execute('SELECT 1 FROM node_lanes WHERE node=?',(restart_id,)).fetchone()
print('PASS parent restart clears old lane readiness and preserves cache restoration progress')
