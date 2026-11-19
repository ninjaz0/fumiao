"""Audio permissions, transactional billing, model-specific GPU leases and WAV validation."""
import hashlib,io,json,math,os,sys,tempfile,uuid,wave,zipfile
from array import array
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
root=Path(__file__).resolve().parents[1];sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(root))
import core,timing,model_policy,credits
from node_models import plan,GPU_MODELS
from server import app

def ok(r):assert r.is_success,(r.status_code,r.text[:300]);return r.json()
def user(name,role='member'):
 code=core.token()
 with core.db(True) as c:c.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+600))
 client=TestClient(app);ok(client.post('/api/register',json={'name':name,'nickname':name,'password':'audio-test-pass-2026','code':code}));return client
admin=user('admin','admin');alice=user('alice');other=user('other')
def state(c):return ok(c.get('/api/state'))
def audio(c=alice,uid=None,**extra):return c.post('/api/audio-jobs',json={'uid':uid or str(uuid.uuid4()),'prompt':'你好，欢迎使用本地语音生成。'}|extra)
personal=state(alice)['workspace_id']
assert next(p['amount'] for p in state(alice)['pricing']['items'] if p['model']=='breeze-tts-2')==1
assert state(alice)['model_access']['breeze-tts-2']
assert audio().status_code==409
ok(admin.post('/api/admin/credits/adjust',json={'workspace':personal,'amount':10,'note':'audio test','uid':str(uuid.uuid4())}))
assert audio(prompt=' ').status_code==400
assert audio(prompt='长'*301).status_code==422
assert audio(model='muse-image').status_code==400
uid=str(uuid.uuid4());j=ok(audio(uid=uid))['id'];assert ok(audio(uid=uid))['id']==j
assert state(alice)['credits']['reserved']==1

def node(models):
 paired=ok(admin.post('/api/pairs',json={'models':models}));secret=core.token();code=paired['command'].split()[-1]
 reply=ok(TestClient(app).post('/agent/enroll',json={'code':code,'secret':secret}));assert reply['models']==models
 agent=TestClient(app,headers={'Authorization':'Bearer '+secret})
 return agent,secret,paired
n,secret,paired=node(['breeze-tts-2']);assert '--models=breeze-tts-2' in paired['command']
ok(n.post('/agent/heartbeat',json={'stage':'ready'}));assert ok(n.post('/agent/claim'))['job'] is None
assert n.post('/agent/heartbeat',json={'stage':'ready','ready_models':['MiniMax H3']}).status_code==400
ok(n.post('/agent/heartbeat',json={'stage':'ready','ready_models':['breeze-tts-2']}))
assigned=ok(n.post('/agent/claim'))['job'];assert assigned['id']==j and assigned['model']=='breeze-tts-2' and assigned['kind']=='audio'
assert assigned['audio_settings']['instruction'];ticket=assigned['ticket'];assert ok(n.post('/agent/claim'))['job']['ticket']==ticket

def wav(channels=1,silent=False):
 stream=io.BytesIO()
 with wave.open(stream,'wb') as w:
  w.setnchannels(channels);w.setsampwidth(2);w.setframerate(24000)
  w.writeframes(array('h',(0 if silent else int(5000*math.sin(i*2*math.pi*440/24000)) for i in range(24000*channels))).tobytes())
 return stream.getvalue()
def deliver(raw):
 return n.put(f'/agent/jobs/{j}/result',content=raw,headers={'X-Job-Ticket':ticket,'X-SHA256':hashlib.sha256(raw).hexdigest()})
assert deliver(wav(channels=2)).status_code==422
assert deliver(wav(silent=True)).status_code==422
assert state(alice)['credits']['reserved']==1
result=ok(deliver(wav()));assert ok(deliver(wav()))['id']==result['id']
s=state(alice);job=next(r for r in s['jobs'] if r['id']==j)
assert job['actual']['sample_rate']==24000 and job['actual']['duration']==1
assert s['credits']['balance']==9 and s['credits']['reserved']==0
r=alice.get('/media/'+result['id']+'?download=true');assert r.status_code==200 and r.headers['content-type']=='audio/wav' and '.wav' in r.headers['content-disposition']
assert other.get('/media/'+result['id']).status_code==404 and admin.get('/media/'+result['id']).status_code==404
assert audio(other,parent=j).status_code==404
batch=ok(alice.post('/api/assets/batch-download',json={'keys':['job:'+str(j)]}))
with zipfile.ZipFile(io.BytesIO(alice.get(batch['url']).content)) as archive:
 assert len(archive.namelist())==1 and archive.namelist()[0].endswith('.wav')
 assert archive.read(archive.namelist()[0])==wav()
# Queue cancellations refund, and speech participates in GPU lease recovery.
cancel=ok(audio())['id'];ok(alice.post(f'/api/jobs/{cancel}/cancel',json={}));assert state(alice)['credits']['reserved']==0
retry=ok(audio())['id'];held=ok(n.post('/agent/claim'))['job'];assert held['id']==retry
with core.db(True) as c:c.execute('UPDATE jobs SET lease=0 WHERE id=?',(retry,))
assert next(x for x in state(alice)['jobs'] if x['id']==retry)['status']=='queued'
held=ok(n.post('/agent/claim'))['job']
with core.db(True) as c:c.execute('UPDATE jobs SET lease=0 WHERE id=?',(retry,))
assert next(x for x in state(alice)['jobs'] if x['id']==retry)['status']=='failed'
assert state(alice)['credits']['reserved']==0
# A legacy/H3-only node cannot take speech, while a dual-model node can.
h3,_,_=node(['MiniMax H3']);ok(h3.post('/agent/heartbeat',json={'stage':'ready'}))
waiting=ok(audio())['id'];assert ok(h3.post('/agent/claim'))['job'] is None
both,_,paired=node(['MiniMax H3','breeze-tts-2']);assert '--models=minimax-h3,breeze-tts-2' in paired['command']
ok(both.post('/agent/heartbeat',json={'stage':'ready','ready_models':['MiniMax H3','breeze-tts-2']}));assert ok(both.post('/agent/claim'))['job']['id']==waiting
p=state(admin)['model_policy'];ok(admin.patch('/api/settings/models',json={'model':'breeze-tts-2','enabled':False,'expected_revision':p['revision']}));assert audio().status_code==403
print('PASS audio admission, 1-credit holds/settlement/refund, privacy, model-specific enrollment/claims, WAV validation and lease recovery')

# Resource requirements use actual per-card capacity and model subsets.
def hw(backend,vrams,ram=200,disk=250):return {'python':[3,12],'ram_gib':ram,'disk_free_gib':disk,'devices':[{'index':i,'name':'test','backend':backend,'vram_gib':v,'free_gib':v} for i,v in enumerate(vrams)]}
assert plan(hw('cuda',[24],32),['breeze-tts-2'])['ok']
assert not plan(hw('cuda',[24],32),['MiniMax H3','breeze-tts-2'])['ok']
assert not plan(hw('cuda',[48,48]),['MiniMax H3'])['ok']
assert plan(hw('rocm',[192]),['MiniMax H3','breeze-tts-2'])['ok']
assert plan(hw('cuda',[24,128]),['MiniMax H3','breeze-tts-2'])['device']['index']==1
assert not plan(hw('rocm',[8]),['breeze-tts-2'])['ok']
assert not plan(hw('cuda',[24],32,5),['breeze-tts-2'])['ok']
# A waiting H3 job must not delay a ready speech-only device.
with core.db() as con:
 stamp=10000
 nodes=[dict(id=101,stage='ready',control='active',lastseen=stamp,ready_models=json.dumps(['MiniMax H3'])),dict(id=102,stage='ready',control='active',lastseen=stamp,ready_models=json.dumps(['breeze-tts-2']))]
 jobs=[dict(id=100,node=101,status='running',kind='video',model='MiniMax H3',refs=[],width=864,height=480,quality=480,seconds=5),dict(id=101,node=None,status='queued',kind='video',model='MiniMax H3',refs=[],width=864,height=480,quality=480,seconds=5),dict(id=102,node=None,status='queued',kind='audio',model='breeze-tts-2',refs=[],width=0,height=0,quality=0,seconds=0,prompt='你好')]
 estimator=SimpleNamespace(estimate=lambda *args,**kwargs:{'low':10,'median':10,'high':10,'source':'history','samples':5})
 with patch.object(timing,'remaining',return_value={'low':90,'median':90,'high':90}):
  plans=timing.local_queue_estimates(con,jobs,nodes,{100:{}},estimator,stamp)
 assert plans[101]['median']==90 and plans[102]['median']==0,plans
print('PASS AMD/NVIDIA plans, individual VRAM, RAM/disk gates and heterogeneous serial GPU scheduling')
