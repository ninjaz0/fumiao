"""Fast checkpoint/sampler contract, capability gate, billing and canvas round trip."""
import ast,hashlib,json,os,subprocess,sys,tempfile,types,uuid
from pathlib import Path
temp=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=temp.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'agent')]
from fastapi.testclient import TestClient
import core,timing,job_progress,node_models
from server import app
from canvas_api import Node
from credit_fixtures import fund_test_accounts
fund_test_accounts()
with core.db(True) as c:
 c.execute("INSERT INTO users(name,role) VALUES('fast-admin','admin')");key=core.token();c.execute('INSERT INTO sessions VALUES(?,1,?)',(core.hashed(key),core.now()+1000))
client=TestClient(app);client.cookies.set('fm_session',key)
def ok(r):assert r.is_success,(r.status_code,r.text[:400]);return r.json()
def fetch(i):
 with core.db() as c:return dict(c.execute('SELECT * FROM jobs WHERE id=?',(i,)).fetchone())
def submit(**extra):return client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'快速模式','sampling_steps':4}|extra)
job=ok(submit())['id'];assert fetch(job)['sampling_steps']==4
assert submit(model='muse-video',seconds=6).status_code==400
pair=ok(client.post('/api/pairs',json={}))['command'].split()[-1]
worker=TestClient(app);secret=core.token();ok(worker.post('/agent/enroll',json={'code':pair,'secret':secret}));worker.headers['Authorization']='Bearer '+secret
ok(worker.post('/agent/heartbeat',json={'stage':'ready','workflow':'h3-v4-rocm-qkv-safe-configurable','video_steps':[4,16,20,32,50]}))
assert ok(worker.post('/agent/claim'))['job'] is None
ok(worker.post('/agent/heartbeat',json={'stage':'ready','workflow':node_models.H3_TURBO_WORKFLOW,'video_steps':[4,16,20,32,50]}))
leased=ok(worker.post('/agent/claim'))['job'];assert leased['id']==job and leased['sampling_steps']==4
headers={'X-Job-Ticket':leased['ticket']}
for telemetry in ({'sampling_steps':4},{'sampling_steps':4,'fast_mode':False},{'sampling_steps':20,'fast_mode':True}):
 assert worker.put(f'/agent/jobs/{job}/result',content=b'bad',headers=headers|{'X-Job-Timing':json.dumps(telemetry)}).status_code==422
video=Path(temp.name)/'valid.mp4'
subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=864x480:r=24','-f','lavfi','-i','anullsrc=r=32000:cl=stereo','-t',str(124/24),'-frames:v','124','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-y',str(video)],check=True)
raw=video.read_bytes();headers.update({'X-SHA256':hashlib.sha256(raw).hexdigest(),'X-Job-Timing':'{"sampling_steps":4,"fast_mode":true}'})
ok(worker.put(f'/agent/jobs/{job}/result',content=raw,headers=headers))
assert json.loads(fetch(job)['output_metadata'])=={'sampling_steps':4,'fast_mode':True}
with core.db() as c:assert tuple(c.execute('SELECT amount,state FROM credit_charges WHERE job=?',(job,)).fetchone())==(1,'spent')
again=ok(client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'旧页面重做','parent':job}))['id'];assert fetch(again)['sampling_steps']==4
normal=ok(submit(sampling_steps=32,parent=job))['id'];assert fetch(normal)['sampling_steps']==32
project=ok(client.post('/api/canvases',json={'title':'快速画布'}))
node=Node(id='video',type='video',x=0,y=0,prompt='快速画布',params={'fast_mode':True,'sampling_steps':32}).model_dump()
rev=ok(client.put(f"/api/canvases/{project['id']}/document",json={'expected_revision':project['revision'],'title':project['title'],'document':{'schemaVersion':1,'nodes':[node],'edges':[]}}))['revision']
canvas_job=ok(client.post(f"/api/canvases/{project['id']}/nodes/video/runs",json={'expected_revision':rev,'uid':str(uuid.uuid4())}))['id']
assert fetch(canvas_job)['sampling_steps']==4
assert ok(client.get(f"/api/canvases/{project['id']}/runs"))['runs'][0]['sampling_steps']==4
with core.db() as c:
 params=json.loads(c.execute('SELECT inputs FROM canvas_job_links WHERE job=?',(canvas_job,)).fetchone()[0])['params']
 assert params['fast_mode'] and params['sampling_steps']==32
assert Node(id='legacy',type='video',x=0,y=0).params.fast_mode is False
print('PASS fast API, legacy capability gate, verified result mode, unchanged credits, retries and saved canvas toggle')

engine={'json':json,'ROOT':ROOT/'agent/vendor/engine'};render={name:getattr(node_models,name) for name in ('h3_fast_preset','h3_input_metadata','h3_reference_files')};render['sampling_steps']=job_progress.sampling_steps
for path,name,scope in [('agent/vendor/engine/scripts/generate.py','make_graph',engine),('agent/render.py','build_graph',render)]:
 if name=='build_graph':scope['h3']=types.SimpleNamespace(make_graph=engine['make_graph'])
 fn=next(n for n in ast.parse((ROOT/path).read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name)
 exec(compile(ast.Module(body=[fn],type_ignores=[]),path,'exec'),scope)
baseline=json.loads((ROOT/'tests/fixtures/regular_graphs_before_turbo.json').read_text())
manifest=json.loads((ROOT/'agent/vendor/engine/assets/models.lock.json').read_text())['files']
for steps in (4,16,20,32,50):
 for refs in ([],['first'],['first','second']):
  for quality in (480,768):
   w,h=(864,480) if quality==480 else (1344,768)
   j={'id':99,'prompt':'test','seed':1,'quality':quality,'seconds':5,'width':w,'height':h,'refs':refs,'sampling_steps':steps}
   g=render['build_graph'](j,'job-99');assert g['9']['inputs']['steps']==steps
   if steps!=4:
    assert hashlib.sha256(json.dumps(g,sort_keys=True).encode()).hexdigest()==baseline[f'{steps}-{len(refs)}-{quality}'];continue
   preset=node_models.h3_fast_preset(j)
   assert g['8']['inputs']['sampler_name']=='euler'
   assert g['16']['inputs']['lora_name']==preset['lora']
   assert g['17']['class_type']=='MiniMaxH3SigmaShift'
   assert g['17']['inputs']=={'model':['16',0],'shift_video':6.0 if len(refs)<2 and quality==768 else 12.0,'shift_audio':3.0}
   assert g['7']['inputs']['model']==g['9']['inputs']['model']==['17',0]
   assert any(f['path']=='loras/'+preset['lora'] and not f.get('requires_env') for f in manifest)
print('PASS correct fast LoRA/Euler/sigma shifts for T2V/I2V/R2V at both tiers; 24 standard graphs unchanged')

regular=timing.features(fetch(normal),node={'hardware':'gpu','workflow':node_models.H3_TURBO_WORKFLOW})
fast=timing.features(fetch(job),node={'hardware':'gpu','workflow':node_models.H3_TURBO_WORKFLOW})
est=object.__new__(timing.Estimator);est.samples=[{'id':1,'node':1,'f':regular,'status':'done','started':100.,'finished':300.,'details':'{"generate_s":120}'}]
assert est.estimate(fast)['source']=='none'
est.samples.append({'id':2,'node':1,'f':fast,'status':'done','started':100.,'finished':180.,'details':'{"generate_s":40}'})
assert est.estimate(fast)['median']==80
assert timing.workflow_family(node_models.H3_TURBO_WORKFLOW)==timing.workflow_family('h3-v4-rocm-qkv-safe-configurable')
print('PASS fast measurements isolated from normal-step scaling while normal historical samples remain compatible')

with core.db(True) as c:
 node=dict(c.execute('SELECT * FROM nodes').fetchone());node.update(runtime_id='mode-runtime',stage='ready',lastseen=core.now())
 completed=timing.features(fetch(job),node=node)
 c.execute('UPDATE job_runs SET features=? WHERE job=?',(json.dumps(completed),job))
 assert timing.features(fetch(normal),c,node)['cold'] is True
 assert timing.features(fetch(job),c,node)['cold'] is False
 assert timing.features(fetch(job)|{'quality':768,'width':1344,'height':768},c,node)['cold'] is True
 pending=[fetch(normal)|{'id':100+i,'sampling_steps':steps,'status':'queued','node':None} for i,steps in enumerate((32,50,4))]
 class CacheEstimator:
  def estimate(self,target,*args):
   duration=100 if target['cold'] else 10
   return {'low':duration,'median':duration,'high':duration,'source':'history','samples':7,'confidence':'medium'}
 planned=timing.local_queue_estimates(c,pending,[node],{},CacheEstimator(),core.now())
 assert [planned[i]['duration']['median'] for i in (100,101,102)]==[100,10,100],planned
print('PASS queue simulation includes fast/normal and LoRA changes while ordinary step changes retain the warm model')
