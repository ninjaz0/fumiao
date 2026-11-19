"""Shared-library bulk deletion and per-user favorites in an isolated data store."""
import io
import os
import sys
import tempfile
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

tmp = tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=tmp.name, FUMIAO_SITE='http://testserver')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from fastapi.testclient import TestClient
import core
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()


def okay(r):
    assert r.is_success,(r.status_code,r.text[:400])
    return r.json()


def auth(role,name):
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+60))
    c=TestClient(app)
    okay(c.post('/api/register',json={"nickname": name, 'name':name,'password':'test-library-secret-2026','code':code}))
    return c


def upload(c):
    raw=io.BytesIO();Image.new('RGB',(32,32),'#cc9966').save(raw,'PNG')
    return okay(c.post('/api/assets',content=raw.getvalue()))['id']


def job(c,refs=None):
    return okay(c.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'素材管理验收','refs':refs or []}))['id']


def fav(c,keys,value=True):return c.put('/api/favorites',json={'keys':keys,'favorite':value})
def delete(c,keys):return c.post('/api/assets/batch-delete',json={'keys':keys})
def state(c):return okay(c.get('/api/state'))


a=auth('admin','管理员');b=auth('member','甲成员');c=auth('member','乙成员');anon=TestClient(app)
from shared_workspace import share_workspace
shared=share_workspace(a,b,c)
bid=state(b)['me']['id'];cid=state(c)['me']['id']
x=upload(b);y=upload(b);other=upload(c)
assert anon.put('/api/favorites',json={'keys':['asset:'+x],'favorite':True}).status_code==401
assert anon.post('/api/assets/batch-delete',json={'keys':['asset:'+x]}).status_code==401
assert delete(a,['job:1 OR 1=1']).status_code==400
assert fav(a,['asset:'+x]*201).status_code==422
assert delete(a,[]).status_code==422
# A favorite belongs to its viewer, even for someone else's shared asset.
okay(fav(a,['asset:'+x]));okay(fav(b,['asset:'+x,'asset:'+y]))
assert state(c)['favorites']==[]
assert set(state(b)['favorites'])=={'asset:'+x,'asset:'+y}
assert state(a)['favorites']==['asset:'+x]
# Concurrent repeated additions remain unique.
with ThreadPoolExecutor() as pool:
    list(pool.map(lambda _:okay(fav(c,['asset:'+x])),range(6)))
assert state(c)['favorites']==['asset:'+x]
okay(fav(b,['asset:'+x],False));assert state(a)['favorites']==['asset:'+x]
# Mixed ownership must fail before removing any allowed selection.
assert delete(b,['asset:'+y,'asset:'+other]).status_code==403
assert b.get('/media/'+y).status_code==200
assert b.get('/media/'+other).status_code==200
# In-flight tasks cannot be deleted or favorited.
j=job(b,[x]);assert delete(b,['job:'+str(j),'asset:'+y]).status_code==409
assert fav(b,['job:'+str(j)]).status_code==409
assert b.get('/media/'+y).status_code==200
okay(b.post(f'/api/jobs/{j}/cancel'))
assert delete(b,['asset:'+x,'asset:'+y]).status_code==409
assert b.get('/media/'+y).status_code==200
# Deleting references with all of their selected dependent jobs is safe.
assert okay(delete(b,['job:'+str(j),'asset:'+x,'asset:'+x]))['deleted']==2
assert b.get('/media/'+x).status_code==404
assert state(a)['favorites']==[] and state(c)['favorites']==[]
assert not core.store.path(x).exists()
assert okay(delete(b,['asset:'+x]))['deleted']==0
# Generated image aliases collapse to one favorite and one deletion target.
result=upload(b);generated=job(b)
with core.db(True) as con:
    con.execute("UPDATE jobs SET status='done',kind='image',result=? WHERE id=?",(result,generated))
okay(fav(c,['asset:'+result,'job:'+str(generated)]))
assert state(c)['favorites']==['job:'+str(generated)]
linked=job(c,[result]);okay(c.post(f'/api/jobs/{linked}/cancel'))
assert delete(b,['job:'+str(generated)]).status_code==409
assert delete(b,['job:'+str(generated),'job:'+str(linked)]).status_code==403
assert okay(delete(a,['job:'+str(generated),'asset:'+result,'job:'+str(linked)]))['deleted']==2
assert state(c)['favorites']==[]
# Existing single-delete routes also cascade favorites.
okay(fav(c,['asset:'+y]));okay(b.delete('/api/assets/'+y));assert state(c)['favorites']==[]
z=upload(b);done=job(b)
with core.db(True) as con:con.execute("UPDATE jobs SET status='done',result=? WHERE id=?",(z,done))
okay(fav(a,['job:'+str(done)]));okay(b.delete('/api/jobs/'+str(done)));assert state(a)['favorites']==[]
# Invalid additions are atomic, and removed assets can be unfavorited idempotently.
assert fav(a,['asset:'+other,'asset:'+'0'*32]).status_code==404
assert state(a)['favorites']==[]
okay(fav(a,['asset:'+'0'*32],False))
with core.db() as con:
    assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not list(con.execute('PRAGMA foreign_key_check'))
print('PASS private persistent favorites, canonical aliases, concurrent deduplication, bulk ownership, atomic deletion, references and cascade cleanup')
