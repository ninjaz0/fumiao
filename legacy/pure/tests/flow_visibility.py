"""Restricted Flow admission, historical compatibility and migration; no cloud calls."""
import json,os,sys,tempfile,uuid
from pathlib import Path
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,flow_catalog,model_policy,credits
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
def ok(r):assert r.is_success,(r.status_code,r.text[:300]);return r.json()
def user(name,role):
 code=core.token()
 with core.db(True) as c:c.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+60))
 client=TestClient(app)
 ok(client.post('/api/register',json={'nickname':name,'name':name,'password':'visibility-test-password','code':code}))
 return client
admin=user('Flow管理员','admin');member=user('Flow成员','member')
state=ok(admin.get('/api/state'))
visible={k for k in state['video_models'] if k.startswith('flow:')}
expected={k for k in flow_catalog.MODELS if k=='flow:veo-3.1-quality' or k.startswith('flow:veo-3.1-quality-') or k=='flow:omni-1.2-flash' or k.startswith('flow:omni-1.2-flash-')}
assert visible==expected and len(visible)==35
hidden=set(flow_catalog.MODELS)-visible
assert not any(k.startswith('flow:') for k in state['images']['models'])
assert all(not state['model_access'][k] and not state['model_policy']['enabled'][k] for k in hidden)
assert all(state['model_access'][k] for k in visible)
for model in ('flow:veo-3.1-fast-8s-landscape','flow:gemini-3.1-flash-image-square'):
 endpoint='/api/image-jobs' if flow_catalog.MODELS[model]['kind']=='image' else '/api/jobs'
 assert member.post(endpoint,json={'model':model,'prompt':'hidden model','uid':str(uuid.uuid4())}).status_code==403
 assert admin.patch('/api/settings/models',json={'model':model,'enabled':True,'expected_revision':state['model_policy']['revision']}).status_code==400
for model in ('flow:veo-3.1-quality-8s-landscape','flow:omni-1.2-flash-8s-landscape'):
 jid=ok(member.post('/api/jobs',json={'model':model,'prompt':'visible model','uid':str(uuid.uuid4())}))['id']
 ok(member.post('/api/jobs/'+str(jid)+'/cancel',json={}))

# An existing deployment may have enabled all Flow models. Migration masks only
# the hidden families, preserves existing choices and does not remove history.
with core.db(True) as c:
 policy=model_policy.read(c);policy['enabled'].update({k:True for k in flow_catalog.MODELS})
 policy['enabled']['muse-video']=False
 policy['enabled']['flow:veo-3.1-quality-4s-landscape']=False
 c.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(policy),))
 model_policy.migrate(c)
 after=model_policy.read(c)
 assert all(not after['enabled'][k] for k in hidden)
 assert not after['enabled']['muse-video'] and not after['enabled']['flow:veo-3.1-quality-4s-landscape']
 revision=after['revision'];model_policy.migrate(c);assert model_policy.read(c)['revision']==revision
 assert len(c.execute('SELECT * FROM jobs').fetchall())==2
 prices=credits.prices(c)
 assert len([p for p in prices['items'] if p['model'] in hidden])==len(hidden)
 values={p['key']:p['amount'] for p in prices['items']}
 values['flow:omni-1.2-flash-8s-landscape|native']=2
 saved=credits.save_prices(c,values,prices['revision'])
 assert {p['key']:p['amount'] for p in saved['items']}==values
 assert all(not model_policy.enabled(c,k) for k in hidden)

# Old canvas documents still load, but cannot submit a newly hidden model.
project=ok(member.post('/api/canvases',json={'title':'Historical Flow canvas'}))
old_model='flow:veo-3.1-fast-8s-landscape'
doc={'nodes':[{'id':'old','type':'video','x':0,'y':0,'prompt':'old model','params':{'model':old_model,'ratio':'16:9','seconds':8}}]}
ok(member.put('/api/canvases/'+project['id']+'/document',json={'expected_revision':1,'title':project['title'],'document':doc}))
assert member.post('/api/canvases/'+project['id']+'/nodes/old/runs',json={'expected_revision':2,'uid':str(uuid.uuid4())}).status_code==403
assert state['model_catalog'][old_model]['label'] # Historical labels remain available.
print('PASS two Flow families, 35 variants, hidden admission, migration, historical canvas and preserved pricing')

# Product-level hiding must cover legacy providers too, not only Flow entries.
before=ok(admin.get('/api/state'))
with core.db(True) as c:
 c.execute("INSERT INTO settings VALUES('hidden_model_ids',?)",(json.dumps(['MiniMax H3','muse-video']),))
 model_policy.migrate(c)
state=ok(admin.get('/api/state'))
assert set(state['video_models'])==expected
for model in ('MiniMax H3','muse-video'):
 assert state['model_catalog'][model]['hidden'] and not state['model_access'][model]
 assert member.post('/api/jobs',json={'model':model,'prompt':'hidden legacy video','uid':str(uuid.uuid4())}).status_code==403
 assert admin.patch('/api/settings/models',json={'model':model,'enabled':True,'expected_revision':state['model_policy']['revision']}).status_code==400
assert state['images']['models']==before['images']['models']
assert state['audio_models']==before['audio_models']
assert all(state['model_policy']['enabled'][k]==v for k,v in before['model_policy']['enabled'].items() if model_policy.MODELS[k]['kind']!='video')
print('PASS hiding legacy video providers across studio, canvas and admin while preserving other types')
