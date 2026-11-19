"""Model admission, admin authorization and queue pause/resume; no provider billing."""
import json,os,sys,tempfile,uuid
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',OPENAI_API_KEY='sk-model-policy-test',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,model_policy,image_api,muse_provider as muse
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()

def ok(r):assert r.is_success,(r.status_code,r.text[:300]);return r.json()
def user(name,role):
 key=core.token()
 with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(key,role,core.now()+60))
 c=TestClient(app);ok(c.post('/api/register',json={"nickname": name, 'name':name,'password':'model-policy-password','code':key}));return c
admin=user('管理员','admin');member=user('普通成员','member')
def policy():return ok(admin.get('/api/state'))['model_policy']
def toggle(model,value):return ok(admin.patch('/api/settings/models',json={'model':model,'enabled':value,'expected_revision':policy()['revision']}))['policy']
def submit(model,uid=None):
 video=model in ('MiniMax H3','muse-video')
 body={'uid':uid or str(uuid.uuid4()),'prompt':'policy test','model':model,'seconds':6 if model=='muse-video' else 5}
 return member.post('/api/jobs' if video else '/api/image-jobs',json=body)
marker=core.DATA/'.dispatch-paused';marker.touch()
with patch.object(image_api,'provider_call',side_effect=AssertionError('dispatch freeze failed')):assert image_api.run_one() is False
with patch.object(muse,'ready',side_effect=AssertionError('dispatch freeze failed')):muse.tick()
marker.unlink()
assert set(policy()['enabled'])==set(model_policy.MODELS)
assert len([k for k in model_policy.MODELS if k.startswith('flow:')])==104
initial=policy();assert member.patch('/api/settings/models',json={'model':'MiniMax H3','enabled':False,'expected_revision':initial['revision']}).status_code==403
assert admin.patch('/api/settings/models',json={'model':'unknown','enabled':False,'expected_revision':initial['revision']}).status_code==400
uid=str(uuid.uuid4());h3=ok(submit('MiniMax H3',uid))['id'];toggle('MiniMax H3',False)
assert submit('MiniMax H3').status_code==403
assert ok(submit('MiniMax H3',uid))['id']==h3 # Acknowledgement replay is not a new task.
secret=core.token()
with core.db(True) as con:con.execute("INSERT INTO nodes(owner,name,key,lastseen,stage) VALUES(1,'test',?,?,'ready')",(core.hashed(secret),core.now()))
gpu=TestClient(app,headers={'Authorization':'Bearer '+secret})
assert ok(gpu.post('/agent/claim'))['job'] is None
j=next(j for j in ok(member.get('/api/state'))['jobs'] if j['id']==h3);assert j['eta']['reason']=='model_paused'
toggle('MiniMax H3',True);active=ok(gpu.post('/agent/claim'))['job'];assert active['id']==h3
toggle('MiniMax H3',False);assert ok(gpu.post('/agent/claim'))['job']['ticket']==active['ticket']
with core.db() as con:assert con.execute('SELECT status FROM jobs WHERE id=?',(h3,)).fetchone()[0]=='running'
print('PASS admin-only changes, closed submissions rejected, existing acknowledgement and active GPU work preserved')
pending={}
for model in ['gpt-image-2.6-sunburst','muse-image','muse-video']:
 pending[model]=ok(submit(model))['id'];toggle(model,False);assert submit(model).status_code==403
with patch.object(image_api,'provider_call',side_effect=AssertionError('paused OpenAI called')):assert image_api.run_one() is False
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',side_effect=AssertionError('paused Muse called')):muse.tick()
for j in ok(member.get('/api/state'))['jobs']:
 if j['id'] in pending.values():assert j['status']=='queued' and j['eta']['reason']=='model_paused'
toggle('muse-video',True)
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',return_value={'task_id':'task_'+'a'*20}) as calls:
 muse.tick();assert calls.call_count==1 and calls.call_args.args[1]['model']=='muse-video'
toggle('muse-video',False)
with patch.object(muse,'ready',return_value=False),patch.object(muse,'request',return_value={'status':'processing'}) as calls:
 muse.tick();assert calls.call_count==1 and calls.call_args.args[0].startswith('/v1/videos/task_')
# Running remote work can still complete after closure.
with patch.object(muse,'ready',return_value=False),patch.object(muse,'request',return_value={'status':'completed'}),patch.object(muse,'complete') as complete:
 muse.tick();complete.assert_called_once()
print('PASS four independent switches, queued jobs pause/resume, running Muse polling/completion continues')
project=ok(member.post('/api/canvases',json={'title':'model settings'}))
node={'id':'v','type':'video','x':0,'y':0,'prompt':'test','params':{'model':'MiniMax H3'}}
ok(member.put('/api/canvases/'+project['id']+'/document',json={'expected_revision':1,'title':project['title'],'document':{'nodes':[node]}}))
assert member.post('/api/canvases/'+project['id']+'/nodes/v/runs',json={'expected_revision':2,'uid':str(uuid.uuid4())}).status_code==403
old=policy();toggle('muse-image',True)
assert admin.patch('/api/settings/models',json={'model':'muse-video','enabled':True,'expected_revision':old['revision']}).status_code==409
before=policy();core.init_db();assert policy()==before
ok(member.post('/api/jobs/'+str(pending['muse-image'])+'/cancel',json={}))
with core.db(True) as con:
 con.execute("DELETE FROM settings WHERE key='model_policy'")
 con.execute("UPDATE settings SET value=? WHERE key='openai_images'",(json.dumps({'enabled':False}),))
 model_policy.migrate(con);flags=model_policy.read(con)['enabled'];assert flags['MiniMax H3'] and flags['muse-video'] and not flags['muse-image'] and not flags['gpt-image-2.6-sunburst']
print('PASS canvas enforcement, revisions, persistence, cancellation and legacy image-off migration')
