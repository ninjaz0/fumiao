"""Sampling-count contract from API/credits through legacy dispatch and native graphs."""
import ast,hashlib,json,os,subprocess,sys,tempfile,types,uuid
from pathlib import Path
from unittest.mock import patch
temp=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=temp.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'agent')]
from fastapi.testclient import TestClient
import core,timing,job_progress
from server import app
from canvas_api import Node
from credit_fixtures import fund_test_accounts
fund_test_accounts()
with core.db(True) as c:
 c.execute("INSERT INTO users(name,role) VALUES('steps-admin','admin')");key=core.token();c.execute('INSERT INTO sessions VALUES(?,1,?)',(core.hashed(key),core.now()+1000))
client=TestClient(app);client.cookies.set('fm_session',key)
def ok(r):assert r.is_success,(r.status_code,r.text[:400]);return r.json()
def submit(steps=20,**extra):return client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'采样测试','sampling_steps':steps}|extra)
def fetch(jid):
 with core.db() as c:return dict(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
default=ok(client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'旧客户端'}))['id'];assert fetch(default)['sampling_steps']==20
ids=[]
for count in [16,20,32,50]:
 jid=ok(submit(count))['id'];ids.append(jid);assert fetch(jid)['sampling_steps']==count
 with core.db() as c:assert c.execute('SELECT amount FROM credit_charges WHERE job=?',(jid,)).fetchone()[0]==1
for bad in [0,3,15,21,100,-1,True,16.5,None,'50']:
 assert submit(bad).status_code==422,bad
assert submit(32,model='muse-video',seconds=6).status_code==400
uid=str(uuid.uuid4());original=ok(submit(32,uid=uid))['id'];assert ok(submit(50,uid=uid))['id']==original and fetch(original)['sampling_steps']==32
assert {j['sampling_steps'] for j in ok(client.get('/api/state'))['jobs']}=={16,20,32,50}
for jid in [default,*ids,original]:ok(client.post(f'/api/jobs/{jid}/cancel'))

secret=core.token()
with core.db(True) as c:
 nid=c.execute("INSERT INTO nodes(owner,name,key,stage,lastseen,models,ready_models) VALUES(1,'legacy',?,'ready',?,'[\"MiniMax H3\"]','[\"MiniMax H3\"]')",(core.hashed(secret),core.now())).lastrowid
agent=TestClient(app,headers={'Authorization':'Bearer '+secret})
queued={s:ok(submit(s))['id'] for s in [50,16,32,20]}
old=ok(agent.post('/agent/claim'))['job'];assert old['id']==queued[20] and old['sampling_steps']==20
ok(client.post(f"/api/nodes/{nid}/stop",json={}))
ok(client.post(f"/api/jobs/{old['id']}/cancel"))
ok(client.post(f"/api/nodes/{nid}/resume",json={}))
ok(agent.post('/agent/heartbeat',json={'stage':'ready','workflow':'h3-v4-rocm-qkv-safe-configurable','video_steps':[16,20,32,50]}))
leased=ok(agent.post('/agent/claim'))['job'];assert leased['id']==queued[50] and leased['sampling_steps']==50
# An accidental downgrade may not recover the running 50-step lease as 20 steps.
ok(agent.post('/agent/heartbeat',json={'stage':'ready','runtime_id':'old-worker-restarted'}));assert ok(agent.post('/agent/claim'))['job'] is None
ok(agent.post('/agent/heartbeat',json={'stage':'ready','video_steps':[16,20,32,50]}))
headers={'X-Job-Ticket':leased['ticket']}
assert agent.put(f"/agent/jobs/{leased['id']}/result",content=b'bad',headers=headers).status_code==422
assert agent.put(f"/agent/jobs/{leased['id']}/result",content=b'bad',headers=headers|{'X-Job-Timing':'{"sampling_steps":20}'}).status_code==422
assert fetch(leased['id'])['status']=='running'
video=Path(temp.name)/'valid.mp4'
subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=864x480:r=24','-f','lavfi','-i','anullsrc=r=32000:cl=stereo','-t',str(124/24),'-frames:v','124','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-y',str(video)],check=True)
raw=video.read_bytes();headers.update({'X-SHA256':hashlib.sha256(raw).hexdigest(),'X-Job-Timing':'{"sampling_steps":50}'})
ok(agent.put(f"/agent/jobs/{leased['id']}/result",content=raw,headers=headers))
assert json.loads(fetch(leased['id'])['output_metadata'])['sampling_steps']==50
with core.db() as c:assert c.execute('SELECT state FROM credit_charges WHERE job=?',(leased['id'],)).fetchone()[0]=='spent'
legacy_retry=ok(client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'旧页面重做','parent':leased['id']}))['id']
assert fetch(legacy_retry)['sampling_steps']==50
explicit_retry=ok(submit(20,parent=leased['id']))['id'];assert fetch(explicit_retry)['sampling_steps']==20
print('PASS four choices, default/invalid counts, immutable retries, unchanged prices, legacy capability gate and checked output count')

project=ok(client.post('/api/canvases',json={'title':'采样画布'}))
node=Node(id='video',type='video',x=0,y=0,prompt='画布采样',params={'sampling_steps':32}).model_dump()
rev=ok(client.put(f"/api/canvases/{project['id']}/document",json={'expected_revision':project['revision'],'title':project['title'],'document':{'schemaVersion':1,'nodes':[node],'edges':[]}}))['revision']
canvas_job=ok(client.post(f"/api/canvases/{project['id']}/nodes/video/runs",json={'expected_revision':rev,'uid':str(uuid.uuid4())}))['id']
assert fetch(canvas_job)['sampling_steps']==32
with core.db() as c:assert json.loads(c.execute('SELECT inputs FROM canvas_job_links WHERE job=?',(canvas_job,)).fetchone()[0])['params']['sampling_steps']==32
assert Node(id='legacy',type='video',x=0,y=0).params.sampling_steps==20
print('PASS canvas defaults, saved parameters and frozen generation inputs')

engine={'json':json,'ROOT':ROOT/'agent/vendor/engine'};render={'sampling_steps':job_progress.sampling_steps};import node_models;render.update({name:getattr(node_models,name) for name in ('h3_fast_preset','h3_input_metadata','h3_reference_files')})
for path,name,scope in [('agent/vendor/engine/scripts/generate.py','make_graph',engine),('agent/render.py','build_graph',render)]:
 if name=='build_graph':scope['h3']=types.SimpleNamespace(make_graph=engine['make_graph'])
 fn=next(n for n in ast.parse((ROOT/path).read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name)
 exec(compile(ast.Module(body=[fn],type_ignores=[]),path,'exec'),scope)
for steps in [16,20,32,50]:
 for refs in [[],['first'],['first','second']]:
  for quality in [480,768]:
   job={'id':99,'prompt':'test','seed':1,'quality':quality,'seconds':5,'width':864,'height':480,'refs':refs,'sampling_steps':steps}
   with patch.object(job_progress,'FAST_I2V',True):graph=render['build_graph'](job,'job-99')
   assert graph['9']['inputs']['steps']==steps and '16' not in graph
   assert graph['5']['inputs']['length']==124
print('PASS requested steps reach standard T2V/I2V/R2V graphs without hidden turbo overrides')

f=timing.features(fetch(default),node={'hardware':'gpu','workflow':'h3-v3-rocm-qkv-safe-standard20'})|{'cold':False,'runtime_id':'run'}
sample={'id':1,'node':1,'f':f,'status':'done','started':100.,'finished':300.,'details':'{"generate_s":120}'}
est=object.__new__(timing.Estimator);est.samples=[sample]
target=f|{'workflow':'h3-v4-rocm-qkv-safe-configurable','steps':50}
assert est.estimate(f)['median']==200
scaled=est.estimate(target);assert scaled['median']==380 and scaled['source']=='step_scaled',scaled
est.samples.append(sample|{'id':2,'f':target,'finished':550.})
exact=est.estimate(target);assert exact['median']==450 and exact['source']=='history',exact
assert est.estimate(target|{'hardware':'different-gpu'})['source']=='none'
assert timing.planning_prediction(type('NoneEstimator',(),{'estimate':lambda *a:{'source':'none'}})(),target,1,{1:{'features':json.dumps(f),'status':'running','valid':1,'started':100.,'steps':20,'step':10,'progress':'[[5,110],[10,120]]','phase':'generating','predicted':'{}','details':'{}'}},120.)['source']=='none'
print('PASS step-specific cohorts, 20-step history compatibility and compute-only scaling')
