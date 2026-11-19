"""Automatic node names, parallel pairing and removal of instance deadlines."""
import os
import sys
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

tmp=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=tmp.name,FUMIAO_SITE='http://testserver')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import core
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()


def okay(response):
    assert response.is_success,(response.status_code,response.text[:200]);return response.json()


anon=TestClient(app)
code=core.token()
with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",(code,core.now()+60))
a=TestClient(app)
okay(a.post('/api/register',json={"nickname": '管理员', 'name':'管理员','password':'pairing-test-secret-2026','code':code}))
assert anon.get('/api/pairs/default-name').status_code==401
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼001'
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼001'
first=okay(a.post('/api/pairs',json={'deadline':1}))
assert first['name']=='弗淼001' and first['expires']>core.now()
with ThreadPoolExecutor(max_workers=8) as pool:
    names=list(pool.map(lambda _:okay(a.post('/api/pairs',json={}))['name'],range(8)))
assert set(names)=={f'弗淼{i:03d}' for i in range(2,10)}
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼010'
assert a.post('/api/pairs',json={'name':'弗淼001'}).status_code==409
assert okay(a.post('/api/pairs',json={'name':'自定义实例'}))['name']=='自定义实例'
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼010'
secret=core.token();paircode=first['command'].split()[-1]
# Legacy pairing deadlines are ignored when enrolling.
with core.db(True) as con:con.execute('UPDATE pairs SET deadline=1')
okay(anon.post('/agent/enroll',json={'code':paircode,'secret':secret}))
okay(anon.post('/agent/enroll',json={'code':paircode,'secret':secret}))
with core.db() as con:
    node=dict(con.execute('SELECT * FROM nodes').fetchone())
    assert node['name']=='弗淼001' and node['deadline'] is None
    assert con.execute('SELECT COUNT(*) FROM nodes').fetchone()[0]==1
# Existing legacy deadlines no longer prevent FIFO work assignment.
with core.db(True) as con:con.execute('UPDATE nodes SET deadline=1')
job=okay(a.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'接入验收'}))['id']
gpu=TestClient(app,headers={'Authorization':'Bearer '+secret})
okay(gpu.post('/agent/heartbeat',json={'stage':'ready'}))
assert okay(gpu.post('/agent/claim'))['job']['id']==job
assert 'deadline' not in okay(a.get('/api/state'))['nodes'][0]
# The counter survives cleanup and picks up pre-existing numbered names.
with core.db(True) as con:
    con.execute("UPDATE nodes SET control='removed'")
    con.execute('DELETE FROM pairs')
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼010'
assert okay(a.post('/api/pairs',json={'name':'弗淼999'}))['name']=='弗淼999'
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼1000'
with core.db(True) as con:con.execute("DELETE FROM settings WHERE key='node_name_sequence'")
assert okay(a.get('/api/pairs/default-name'))['name']=='弗淼1000'
assert okay(a.post('/api/pairs',json={'name':' '}))['name']=='弗淼1000'
print('PASS name previews, concurrent monotonic allocation, custom names, no reused numbers, legacy deadline removal, FIFO and pairing replay')
# A completed pairing code is a receipt, not a fresh invitation. Its original
# node credential may reconnect after expiry; revoked credentials never revive.
with core.db(True) as con:
    reconnect_code=core.token();reconnect_secret=core.token()
    con.execute("INSERT INTO pairs(key,owner,label,expires,models) VALUES(?,1,'reconnect',?,?)",(core.hashed(reconnect_code),core.now()+60,'["MiniMax H3"]'))
node_client=TestClient(app)
assert node_client.post('/agent/enroll',json={'code':reconnect_code,'secret':reconnect_secret}).is_success
node_client.headers['Authorization']='Bearer '+reconnect_secret
registration=node_client.get('/agent/registration').json();assert registration['paired_code_hash']==core.hashed(reconnect_code)
with core.db(True) as con:con.execute('UPDATE pairs SET expires=? WHERE key=?',(core.now()-1,core.hashed(reconnect_code)))
assert node_client.post('/agent/enroll',json={'code':reconnect_code,'secret':reconnect_secret}).is_success
assert node_client.post('/agent/enroll',json={'code':reconnect_code,'secret':core.token()}).status_code==403
with core.db(True) as con:con.execute("UPDATE nodes SET control='removed' WHERE key=?",(core.hashed(reconnect_secret),))
assert node_client.post('/agent/enroll',json={'code':reconnect_code,'secret':reconnect_secret}).status_code==403
print('PASS expired pairing receipt reconnect and revoked-node protection')
