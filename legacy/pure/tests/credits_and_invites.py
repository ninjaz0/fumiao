"""Billing transactions, team model access and bounded invitations; no real generation."""
import json, os, sys, tempfile, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',OPENAI_API_KEY='sk-credit-test-only')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core, credits, model_policy, muse_provider as muse, image_api
from server import app

def ok(r):
 assert r.is_success,(r.status_code,r.text[:350]);return r.json()
def state(c):return ok(c.get('/api/state'))
def create_user(name,code=None,role='member'):
 if code is None:
  code=core.token()
  with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+600))
 c=TestClient(app);ok(c.post('/api/register',json={'name':name,'nickname':'姓名 '+name,'password':'credit-test-password','code':code}));return c
admin=create_user('admin',role='admin');alice=create_user('alice');bob=create_user('bob')
au,bu=state(alice)['me']['id'],state(bob)['me']['id']
team=ok(admin.post('/api/workspaces',json={'name':'测试团队','members':[au,bu]}))['id']
second=ok(admin.post('/api/workspaces',json={'name':'第二团队','members':[au]}))['id']

def grant(wid,amount=100,note='test allocation',uid=None):
 return admin.post('/api/admin/credits/adjust',json={'workspace':wid,'amount':amount,'note':note,'uid':uid or str(uuid.uuid4())})
def price(amount):
 p=state(admin)['pricing'];return ok(admin.put('/api/settings/prices',json={'values':{i['key']:amount for i in p['items']},'expected_revision':p['revision']}))
def post(c,model='MiniMax H3',uid=None,**extra):
 body={'uid':uid or str(uuid.uuid4()),'prompt':'billing test','model':model,'seconds':6 if model=='muse-video' else 5}|extra
 return c.post('/api/image-jobs' if model in ('muse-image','gpt-image-2.6-sunburst') else '/api/jobs',json=body)
def wallet(c):return ok(c.get('/api/credits'))['wallet']
def terminal(jid,status):
 with core.db(True) as con:con.execute('UPDATE jobs SET status=? WHERE id=?',(status,jid))
def toggle(wid,model,enabled):
 s=state(admin);p=s['model_policy'] if wid is None else s['team_model_policies'][str(wid)]
 return ok(admin.patch('/api/settings/models',json={'workspace':wid,'model':model,'enabled':enabled,'expected_revision':p['revision']}))

assert wallet(alice)['balance']==0
assert post(alice).status_code==409 # Not priced: no job/hold admitted.
assert alice.put('/api/settings/prices',json={'values':{},'expected_revision':1}).status_code==403
assert alice.get('/api/admin/credits').status_code==403
assert alice.post('/api/admin/credits/adjust',json={'workspace':team,'amount':10,'note':'x','uid':str(uuid.uuid4())}).status_code==403
p=price(10);assert len(p['items'])==20+len(__import__('flow_catalog').MODELS)
assert post(admin).status_code==409 # Administrators pay as well.
assert post(alice,price_revision=p['revision']-1).status_code==409
assert admin.put('/api/settings/prices',json={'values':{i['key']:1.5 for i in p['items']},'expected_revision':p['revision']}).status_code==422
personal=state(alice)['workspace_id'];identity=str(uuid.uuid4())
ok(grant(personal,20,uid=identity));ok(grant(personal,20,uid=identity));assert wallet(alice)['balance']==20
assert grant(personal,21,uid=identity).status_code==409
uid=str(uuid.uuid4());first=ok(post(alice,uid=uid))['id'];assert ok(post(alice,uid=uid))['id']==first
assert wallet(alice)=={'workspace':personal,'balance':20,'reserved':10,'available':10}
assert grant(personal,-11).status_code==409
price(30);terminal(first,'done');terminal(first,'done')
assert wallet(alice)['balance']==10 and wallet(alice)['reserved']==0 # Submission price, once only.
assert post(alice).status_code==409
price(10);failed=ok(post(alice))['id'];terminal(failed,'failed');terminal(failed,'failed')
assert wallet(alice)['available']==10
cancelled=ok(post(alice))['id'];ok(alice.post(f'/api/jobs/{cancelled}/cancel',json={}));assert wallet(alice)['available']==10
retry=ok(post(alice))['id'];terminal(retry,'running');terminal(retry,'queued');assert wallet(alice)['reserved']==10
terminal(retry,'failed');assert wallet(alice)['available']==10
ok(alice.delete(f'/api/jobs/{first}'));assert any(r['job']==first and r['action']=='spend' for r in ok(alice.get('/api/credits'))['history'])
print('PASS unpriced/insufficient admission, integer prices, admin charging, idempotent holds/grants, locked price, refunds, retry and retained ledger')

# Two members share a single balance; concurrent transactions cannot overspend.
alice.headers['X-Workspace-Id']=str(team);bob.headers['X-Workspace-Id']=str(team)
ok(grant(team,10))
with ThreadPoolExecutor(2) as pool:results=list(pool.map(lambda c:post(c),[alice,bob]))
assert sorted(r.status_code for r in results)==[200,409]
jid=next(r.json()['id'] for r in results if r.status_code==200)
assert wallet(alice)['reserved']==10 and wallet(bob)['available']==0
terminal(jid,'cancelled');assert wallet(bob)['available']==10
bob.headers['X-Workspace-Id']=str(personal);assert bob.get('/api/credits').status_code==403
bob.headers['X-Workspace-Id']=str(team)
admin.headers['X-Workspace-Id']=str(team);jadmin=ok(post(admin))['id'];assert wallet(bob)['available']==0;terminal(jadmin,'cancelled')
# An admin may inspect balances, but this does not grant access to private assets.
admin.headers['X-Workspace-Id']=str(personal);assert admin.get('/api/state').status_code==403
admin.headers.pop('X-Workspace-Id');assert any(a['workspace']==personal for a in ok(admin.get('/api/admin/credits'))['accounts'])
print('PASS shared-team atomic balance, workspace billing, admin payment and personal privacy')

# Each team's gate intersects with global controls, and queued work does not
# monopolize a provider lane when a different permitted team is ready.
ok(grant(team,100));ok(grant(second,100));first_muse=ok(post(alice,'muse-video'))['id']
toggle(team,'muse-video',False)
assert state(alice)['model_access']['muse-video'] is False
assert post(alice,'muse-video').status_code==403
admin.headers['X-Workspace-Id']=str(team);assert post(admin,'muse-video').status_code==403
admin.headers.pop('X-Workspace-Id')
assert next(j for j in state(alice)['jobs'] if j['id']==first_muse)['eta']['reason']=='model_paused'
alice.headers['X-Workspace-Id']=str(second);permitted=ok(post(alice,'muse-video'))['id']
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',return_value={'task_id':'task_'+'b'*20}) as call:
 muse.tick();assert call.call_count==1
with core.db() as con:
 assert con.execute('SELECT status FROM jobs WHERE id=?',(first_muse,)).fetchone()[0]=='queued'
 assert con.execute('SELECT status FROM jobs WHERE id=?',(permitted,)).fetchone()[0]=='running'
toggle(None,'muse-video',False);assert state(alice)['model_access']['muse-video'] is False
terminal(permitted,'done');toggle(None,'muse-video',True);assert state(alice)['model_access']['muse-video'] is True
assert bob.patch('/api/settings/models',json={'workspace':team,'model':'MiniMax H3','enabled':False,'expected_revision':0}).status_code==403
assert admin.patch('/api/settings/models',json={'workspace':personal,'model':'MiniMax H3','enabled':False,'expected_revision':0}).status_code==404
assert admin.patch('/api/settings/models',json={'workspace':team,'model':'muse-video','enabled':True,'expected_revision':0}).status_code==409
terminal(first_muse,'cancelled')
# All model families share the same settlement rules, including canvas submissions.
for model in ['gpt-image-2.6-sunburst','muse-image']:
 j=ok(post(alice,model))['id'];held=wallet(alice)['reserved'];assert held==10
 terminal(j,'done');assert wallet(alice)['reserved']==0
project=ok(alice.post('/api/canvases',json={'title':'计费画布'}))
node={'id':'v','type':'video','x':0,'y':0,'prompt':'test','params':{'model':'MiniMax H3'}}
ok(alice.put('/api/canvases/'+project['id']+'/document',json={'expected_revision':1,'title':project['title'],'document':{'nodes':[node]}}))
body={'expected_revision':2,'uid':str(uuid.uuid4()),'price_revision':state(alice)['pricing']['revision']}
j=ok(alice.post('/api/canvases/'+project['id']+'/nodes/v/runs',json=body))['id']
assert ok(alice.post('/api/canvases/'+project['id']+'/nodes/v/runs',json=body))['id']==j
assert wallet(alice)['reserved']==10;terminal(j,'failed');assert wallet(alice)['reserved']==0
print('PASS team/global model intersection, fair dispatch, restricted admins, all providers and canvas billing')

# Reusable invitations grant one selected team and each new member's personal credits.
entry=ok(admin.post('/api/invite-codes',json={'name':'体验','team_id':team,'expires':core.now()+3600,'grant_credits':True,'initial_credits':25}))
code=entry['code'];c=TestClient(app)
assert c.post('/api/register',json={'name':'noname','password':'a-strong-test-pass','code':code}).status_code==422
assert c.post('/api/register',json={'name':'blank','nickname':' ','password':'a-strong-test-pass','code':code}).status_code==400
c1=create_user('joined1',code);c2=create_user('joined2',code)
s1=state(c1);assert s1['workspace_id']==team
assert {w['id'] for w in s1['workspaces'] if w['kind']=='team'}=={team}
personal1=next(w['id'] for w in s1['workspaces'] if w['kind']=='personal')
assert ok(c1.get('/api/credits',headers={'X-Workspace-Id':str(personal1)}))['wallet']['balance']==25
with core.db() as con:assert con.execute('SELECT uses FROM registration_codes WHERE id=?',(entry['id'],)).fetchone()[0]==2
ok(admin.patch(f"/api/invite-codes/{entry['id']}",json={'enabled':False,'expected_revision':entry['revision']}))
assert c.post('/api/register',json={'name':'joined3','nickname':'姓名','password':'a-strong-test-pass','code':code}).status_code==403
assert admin.post('/api/invites',json={}).status_code==410
assert alice.post('/api/invite-codes',json={'name':'no'}).status_code==403
core.init_db()
with core.db() as con:
 assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 for a in con.execute('SELECT * FROM credit_accounts'):
  held=con.execute("SELECT COALESCE(sum(amount),0) FROM credit_charges WHERE workspace=? AND state='held'",(a['workspace'],)).fetchone()[0]
  assert held==a['reserved'] and 0<=a['reserved']<=a['balance']
print('PASS required nicknames, reusable registration, personal gifts, team allocation, retirement and migration invariants')
