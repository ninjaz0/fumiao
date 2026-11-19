"""Signup, code administration, atomic gifts and legacy retirement; isolated database."""
import os,sys,tempfile,secrets
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,invitations,server
from fastapi.testclient import TestClient
app=server.app

def ok(r):
 assert r.is_success,(r.status_code,r.text[:400]);return r.json()
def signup(name,code,**extra):
 c=TestClient(app);r=c.post('/api/register',json={'name':name,'nickname':'测试昵称','password':'test-password-2026','code':code}|extra);return c,r
def create(**kw):return ok(admin.post('/api/invite-codes',json={'name':'创作体验'}|kw))
def change(entry,**kw):return admin.patch('/api/invite-codes/'+str(entry['id']),json={'expected_revision':entry['revision']}|kw)
def state(c):return ok(c.get('/api/state'))
def counts():
 with core.db() as con:return tuple(con.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ('users','workspaces','workspace_members','credit_accounts','credit_ledger','registration_redemptions','sessions'))

# The separately issued initialization code can create only the first administrator.
boot=invitations.generate_code()
with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",(boot,core.now()+600))
admin,r=signup('rootadmin',boot);ok(r)
assert signup('anotheradmin',boot)[1].status_code==403
team=ok(admin.post('/api/workspaces',json={'name':'邀请团队','members':[]}))['id']
code=create(expires=core.now()+3600,grant_credits=True,initial_credits=75,team_id=team)
with ThreadPoolExecutor(6) as pool:users=list(pool.map(lambda i:signup('parallel'+str(i),' '+code['code'].lower()+' '),range(6)))
for client,response in users:
 ok(response);s=state(client);assert s['workspace_id']==team and s['me']['role']=='member'
 assert 'invite_codes' not in s
 personal=next(w['id'] for w in s['workspaces'] if w['kind']=='personal')
 balance=ok(client.get('/api/credits',headers={'X-Workspace-Id':str(personal)}))
 assert balance['wallet']['available']==75 and len(balance['history'])==1
 assert balance['history'][0]['note']=='注册赠送 · 创作体验'
 assert {w['id'] for w in s['workspaces'] if w['kind']=='team'}=={team}
with core.db() as con:
 assert con.execute('SELECT uses FROM registration_codes WHERE id=?',(code['id'],)).fetchone()[0]==6
 assert con.execute('SELECT balance FROM credit_accounts WHERE workspace=?',(team,)).fetchone()[0]==0
assert admin.get('/api/invite-codes').status_code==200
member=users[0][0]
for response in [member.get('/api/invite-codes'),member.post('/api/invite-codes',json={'name':'test'}),member.patch('/api/invite-codes/'+str(code['id']),json={'expected_revision':1,'enabled':False})]:assert response.status_code==403
assert TestClient(app).get('/api/invite-codes').status_code==401
print('PASS concurrent shared codes, case normalization, personal gifts, team assignment and admin-only management')

before=counts()
with ThreadPoolExecutor(2) as pool:race=list(pool.map(lambda _:signup('sameuser',code['code'])[1],range(2)))
assert sorted(r.status_code for r in race)==[200,409]
with core.db() as con:
 assert con.execute('SELECT uses FROM registration_codes WHERE id=?',(code['id'],)).fetchone()[0]==7
 assert con.execute('SELECT count(*) FROM registration_redemptions WHERE invitation=?',(code['id'],)).fetchone()[0]==7
before=counts()
with patch.object(server,'sign_in',side_effect=RuntimeError('simulated transaction failure')):
 r=TestClient(app,raise_server_exceptions=False).post('/api/register',json={'name':'rollback','nickname':'测试','password':'test-password-2026','code':code['code']})
 assert r.status_code==500
assert counts()==before
with core.db() as con:assert con.execute('SELECT uses FROM registration_codes WHERE id=?',(code['id'],)).fetchone()[0]==7

# Edits affect only future registrations; turning gifts off clears the stored amount.
updated=ok(change(code,grant_credits=False,initial_credits=999,team_id=None,expires=None))
assert updated['initial_credits']==0 and updated['expires'] is None
assert change(code,name='stale').status_code==409
client,r=signup('nogift',updated['code']);ok(r);s=state(client)
assert s['credits']['balance']==0 and all(w['kind']=='personal' for w in s['workspaces'])
assert ok(member.get('/api/credits',headers={'X-Workspace-Id':str(next(w['id'] for w in state(member)['workspaces'] if w['kind']=='personal'))}))['wallet']['available']==75
paused=ok(change(updated,enabled=False));before=counts();assert signup('paused',paused['code'])[1].status_code==403;assert counts()==before
active=ok(change(paused,enabled=True));ok(signup('resumed',active['code'])[1])
with core.db(True) as con:con.execute('UPDATE registration_codes SET expires=? WHERE id=?',(core.now(),active['id']))
assert signup('expired',active['code'])[1].status_code==403
assert change(active,enabled=True).status_code==400
paused=ok(change(active,enabled=False));renewed=ok(change(paused,expires=core.now()+1000,enabled=True));ok(signup('renewed',renewed['code'])[1])
print('PASS duplicate and failure rollback, future-only edits, conflict protection, no-gift mode, expiry and pause/resume')

# Invalid policies, role escalation and personal-workspace assignment are rejected.
personal=state(admin)['workspace_id']
for body in [{'initial_credits':-1},{'initial_credits':1.5},{'initial_credits':True},{'grant_credits':True,'initial_credits':0},{'expires':core.now()-1},{'name':' '},{'team_id':personal},{'team_id':999999},{'role':'admin'},{'code':'custom'},{'grant_credits':1}]:
 assert admin.post('/api/invite-codes',json={'name':'invalid'}|body).status_code in (400,422),body
assert change(renewed,enabled=None).status_code==400
assert change(renewed,code='takeover').status_code==422
assert admin.post('/api/invites',json={}).status_code==410
assert admin.post('/api/invites/1/revoke',json={}).status_code==410
legacy=core.token()
with core.db(True) as con:con.execute("INSERT INTO invites(key,role,expires) VALUES(?,'member',?)",(core.hashed(legacy),core.now()+3600))
assert signup('oldlink',legacy)[1].status_code==403
before=counts();core.init_db();core.init_db();assert counts()==before
with core.db() as con:
 assert con.execute('SELECT used FROM invites WHERE key=?',(core.hashed(legacy),)).fetchone()[0]==1
 assert con.execute('SELECT uses FROM registration_codes WHERE id=?',(renewed['id'],)).fetchone()[0]==10
 assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert con.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS strict validation, retired links, stable migrations and database integrity')

# Failed requests count, persist, and expire; the limit is enforced before password work.
with core.db(True) as con:con.execute('DELETE FROM tries')
for i in range(35):assert signup('rateuser','INVALID')[1].status_code==403
assert signup('rateuser','INVALID')[1].status_code==429
with core.db(True) as con:con.execute('UPDATE tries SET until=?',(core.now()-1,))
assert signup('rateuser','INVALID')[1].status_code==403
print('PASS failed-registration rate limiting and expiry')
