"""Atomic model-family policy changes, scoped teams and legacy compatibility."""
import json,os,sys,tempfile,uuid
from pathlib import Path
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,model_policy
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
def ok(r):assert r.is_success,(r.status_code,r.text[:350]);return r.json()
def user(name,role):
 code=core.token()
 with core.db(True) as c:c.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+600))
 client=TestClient(app);ok(client.post('/api/register',json={'name':name,'nickname':name,'password':'model-group-test','code':code}));return client
admin=user('admin','admin');member=user('member','member')
def state(client=admin):return ok(client.get('/api/state'))
team=ok(admin.post('/api/workspaces',json={'name':'Group policy team','members':[state(member)['me']['id']]}))['id']
def change(group,value,workspace=None,revision=None,client=admin):
 s=state();p=s['model_policy'] if workspace is None else s['team_model_policies'].get(str(workspace),{'revision':0})
 return client.patch('/api/settings/models',json={'model':group,'enabled':value,'group':True,'workspace':workspace,'expected_revision':p['revision'] if revision is None else revision})
s=state();quality='flow:veo-3.1-quality';omni='flow:omni-1.2-flash';qm=s['model_groups'][quality]['models'];om=s['model_groups'][omni]['models']
assert len(qm)==13 and len(om)==22
assert {v['label'] for v in s['model_groups'].values() if v['kind']=='video'}=={'MiniMax H3','Muse','Veo 3.1 Quality','Omni 1.2 Flash'}
assert 'flow:veo-3.1-fast' not in s['model_groups']
assert change(quality,False,client=member).status_code==403
assert change('flow:veo-3.1-fast',True).status_code==400
before=s['model_policy'];closed=ok(change(quality,False))['policy'];assert closed['revision']==before['revision']+1
assert all(closed['enabled'][k] is False for k in qm)
assert all(closed['enabled'][k]==v for k,v in before['enabled'].items() if k not in qm)
for model in ['flow:veo-3.1-quality-4s-landscape','flow:veo-3.1-quality-i2v-6s-portrait']:
 assert member.post('/api/jobs',json={'uid':str(uuid.uuid4()),'model':model,'prompt':'group admission'}).status_code==403
assert change(quality,True,revision=before['revision']).status_code==409
assert state()['model_policy']==closed
opened=ok(change(quality,True))['policy'];assert all(opened['enabled'][k] for k in qm)
jid=ok(member.post('/api/jobs',json={'uid':str(uuid.uuid4()),'model':'flow:veo-3.1-quality-4s-landscape','prompt':'group admission'}))['id']
ok(member.post(f'/api/jobs/{jid}/cancel',json={}))
print('PASS one global revision for all 13 native specs, permissions, stale revisions and submission enforcement')

old_global=state()['model_policy'];tc=ok(change(omni,False,team))['policy'];assert tc['revision']==1 and all(not tc['enabled'][k] for k in om)
assert state()['model_policy']==old_global
member.headers['X-Workspace-Id']=str(team);assert all(not state(member)['model_access'][k] for k in om)
assert change(omni,True,team,revision=0).status_code==409
ok(change(omni,True,team));assert all(state(member)['model_access'][k] for k in om)
ok(change(omni,False));assert all(not state(member)['model_access'][k] for k in om)
assert all(state()['team_model_policies'][str(team)]['enabled'][k] for k in om)
ok(change(omni,True))
personal=state()['workspace_id'];assert change(quality,False,personal,revision=0).status_code==404
print('PASS atomic team updates, global/team intersection and personal-scope rejection')

# Reading grouped controls never silently enables or disables mixed old values.
selected=qm[0];rev=state()['model_policy']['revision']
ok(admin.patch('/api/settings/models',json={'model':selected,'enabled':False,'expected_revision':rev}))
mixed=state()['model_policy'];assert not mixed['enabled'][selected] and any(mixed['enabled'][k] for k in qm if k!=selected)
core.init_db();assert state()['model_policy']==mixed
ok(change(quality,False));ok(change(quality,True));assert all(state()['model_policy']['enabled'][k] for k in qm)
with core.db(True) as c:
 c.execute("INSERT INTO settings VALUES('hidden_model_ids',?)",(json.dumps([selected]),));model_policy.migrate(c)
assert selected not in state()['model_groups'][quality]['models']
ok(change(quality,True));assert state()['model_policy']['enabled'][selected] is False
print('PASS mixed-state preservation, legacy individual updates and hidden-model exclusion')
