"""Reference pack scope, revisions, generation snapshots and deletion guards."""
import io, json, os, sys, tempfile, uuid
from pathlib import Path
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from PIL import Image
from fastapi.testclient import TestClient
import core
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
def okay(r):
    assert r.is_success,(r.status_code,r.text[:400]);return r.json()
def account(name):
    code=core.token()
    with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'member',?)",(code,core.now()+60))
    c=TestClient(app);okay(c.post('/api/register',json={'name':name,'nickname':name,'password':'pack-test-password-2026','code':code}));return c
c=account('素材甲');other=account('素材乙')
raw=io.BytesIO();Image.new('RGB',(64,32),'#3366aa').save(raw,'PNG')
m=okay(c.post('/api/assets',content=raw.getvalue()))['id']
draft={'name':'主角 A','purpose':'subject','description':'蓝色上衣','media':[m]}
p=okay(c.post('/api/asset-packs',json=draft))
assert okay(other.get('/api/asset-packs'))['packs']==[]
assert other.put('/api/asset-packs/'+p['id'],json={**draft,'expected_revision':1}).status_code==404
assert other.post('/api/asset-packs',json=draft).status_code==404
assert c.delete('/api/assets/'+m).status_code==409
body={'uid':str(uuid.uuid4()),'prompt':'缓慢向前走','asset_packs':[{'id':p['id'],'revision':1}]}
jid=okay(c.post('/api/jobs',json=body))['id']
with core.db() as con:
    j=dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
    assert json.loads(j['refs'])==[m] and '<Picture 1>' in j['prompt'] and '蓝色上衣' in j['prompt']
    assert json.loads(j['reference_packs'])[0]['revision']==1
okay(c.put('/api/asset-packs/'+p['id'],json={**draft,'description':'红色上衣','expected_revision':1}))
assert c.put('/api/asset-packs/'+p['id'],json={**draft,'expected_revision':1}).status_code==409
assert okay(c.post('/api/jobs',json=body))['id']==jid
assert c.post('/api/jobs',json={**body,'uid':str(uuid.uuid4())}).status_code==409
with core.db() as con:assert dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())==j
# The canvas stores only IDs + expected revision; job refs contain a frozen expansion.
project=okay(c.post('/api/canvases',json={'template':'product'}));doc=project['document'];node=next(n for n in doc['nodes'] if n['id']=='shot-1');node['asset_packs']=[{'id':p['id'],'revision':2}]
rev=okay(c.put(f"/api/canvases/{project['id']}/document",json={'expected_revision':1,'title':project['title'],'document':doc}))['revision']
assert c.delete('/api/asset-packs/'+p['id']).status_code==409
result=okay(c.post(f"/api/canvases/{project['id']}/nodes/shot-1/candidates",json={'expected_revision':rev,'uid':str(uuid.uuid4()),'count':2}))
with core.db() as con:
    for jid in result['ids']:
        j=con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone();assert '红色上衣' in j['prompt'] and json.loads(j['reference_packs'])[0]['revision']==2
# Cannot trick the image provider with a reference from another workspace.
assert other.post('/api/image-jobs',json={**body,'uid':str(uuid.uuid4()),'model':'muse-image'}).status_code==404
# Extracted frame provenance is scoped, finite and stored alongside the reference.
video=uuid.uuid4().hex
with core.db(True) as con:
    con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) SELECT ?,'video',3,'video/mp4',64,32,owner,workspace FROM media WHERE id=?",(video,m))
assert other.post('/api/assets',content=raw.getvalue(),headers={'X-Frame-Source':video,'X-Frame-Time':'1.5'}).status_code==404
assert c.post('/api/assets',content=raw.getvalue(),headers={'X-Frame-Source':video,'X-Frame-Time':'nan'}).status_code==400
frame=okay(c.post('/api/assets',content=raw.getvalue(),headers={'X-Frame-Source':video,'X-Frame-Time':'1.5'}))['id']
with core.db() as con:
    source=con.execute('SELECT source,frame_seconds FROM media_provenance WHERE media=?',(frame,)).fetchone()
    assert tuple(source)==(video,1.5)
print('PASS pack creation/edit conflict, workspace isolation, immutable submission, idempotency, guarded deletion and canvas candidate expansion')
