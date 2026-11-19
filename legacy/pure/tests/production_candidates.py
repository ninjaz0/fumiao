"""Two-candidate atomicity, replay, scope and independent settlement."""
import os, sys, tempfile, uuid
from pathlib import Path
sandbox = tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import core
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()

def okay(r):
    assert r.is_success,(r.status_code,r.text[:500]);return r.json()
def account(name):
    code=core.token()
    with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'member',?)",(code,core.now()+60))
    c=TestClient(app);okay(c.post('/api/register',json={'name':name,'nickname':name,'password':'candidate-test-password-2026','code':code}));return c
c=account('候选甲');other=account('候选乙')
p=okay(c.post('/api/canvases',json={'template':'event'}));url=f"/api/canvases/{p['id']}/nodes/shot-1/candidates"
body={'uid':str(uuid.uuid4()),'expected_revision':1,'count':2}
with core.db(True) as con:
    con.execute('UPDATE credit_accounts SET balance=1 WHERE workspace=?',(p['workspace'],))
assert c.post(url,json=body).status_code==409
with core.db() as con:
    assert con.execute('SELECT count(*) FROM jobs').fetchone()[0]==0
    assert con.execute('SELECT reserved FROM credit_accounts WHERE workspace=?',(p['workspace'],)).fetchone()[0]==0
with core.db(True) as con:con.execute('UPDATE credit_accounts SET balance=10 WHERE workspace=?',(p['workspace'],))
a=okay(c.post(url,json=body));assert a['count']==2 and a['credits']==2 and len(set(a['ids']))==2
assert okay(c.post(url,json=body))==a
assert other.post(url,json=body).status_code==404
assert c.post(url,json={**body,'count':1}).status_code==409
assert c.post(url,json={**body,'uid':str(uuid.uuid4())}).status_code==409
with core.db(True) as con:
    rows=con.execute('SELECT * FROM jobs ORDER BY id').fetchall()
    assert rows[0]['prompt']==rows[1]['prompt'] and rows[0]['seed']!=rows[1]['seed']
    con.execute("UPDATE jobs SET status='done' WHERE id=?",(a['ids'][0],))
    con.execute("UPDATE jobs SET status='failed' WHERE id=?",(a['ids'][1],))
with core.db() as con:
    w=con.execute('SELECT * FROM credit_accounts WHERE workspace=?',(p['workspace'],)).fetchone()
    assert w['balance']==9 and w['reserved']==0
    assert [r[0] for r in con.execute('SELECT state FROM credit_charges ORDER BY job')]==['spent','refunded']
# Even after the document changes, retry is exactly the original acceptance.
p['document']['nodes'][1]['text']='改后的文字'
okay(c.put(f"/api/canvases/{p['id']}/document",json={'expected_revision':1,'title':p['title'],'document':p['document']}))
assert okay(c.post(url,json=body))==a
assert c.post(url,json={**body,'uid':str(uuid.uuid4())}).status_code==409
fixed=okay(c.post('/api/canvases',json={'template':'event'}))
next(n for n in fixed['document']['nodes'] if n['id']=='shot-1')['params']['seed']=77
revision=okay(c.put(f"/api/canvases/{fixed['id']}/document",json={'expected_revision':1,'title':fixed['title'],'document':fixed['document']}))['revision']
fixed_ids=okay(c.post(f"/api/canvases/{fixed['id']}/nodes/shot-1/candidates",json={'uid':str(uuid.uuid4()),'count':2,'expected_revision':revision}))['ids']
with core.db() as con:assert [con.execute('SELECT seed FROM jobs WHERE id=?',(i,)).fetchone()[0] for i in fixed_ids]==[77,78]
print('PASS atomic two-candidate reservation, no partial task on low balance, replay, scoped access, busy guard and independent settlement')
