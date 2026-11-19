"""Canvas persistence, safe shared editing, frozen references and existing job integration."""
import base64, io, json, os, sys, tempfile, uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',OPENAI_API_KEY='sk-test-canvas-only')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core, image_api
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
from canvas_api import Node

def okay(r):
    assert r.is_success,(r.status_code,r.text[:500])
    return r.json()
def user(role,name):
    key=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(key,role,core.now()+100))
    c=TestClient(app);okay(c.post('/api/register',json={"nickname": name, 'name':name,'password':'canvas-test-secret-2026','code':key}));return c

def node(kind,nid,**kwargs):return Node(id=nid,type=kind,x=0,y=0,**kwargs).model_dump()
def upload(c):
    b=io.BytesIO();Image.new('RGB',(64,48),'#8ca0ad').save(b,'PNG');return okay(c.post('/api/assets',content=b.getvalue()))['id']
def save(c,p,doc,rev=None):return c.put('/api/canvases/'+p['id']+'/document',json={'expected_revision':rev or p['revision'],'title':p['title'],'document':doc})
def run(c,p,nid,uid=None):return c.post('/api/canvases/'+p['id']+'/nodes/'+nid+'/runs',json={'expected_revision':p['revision'],'uid':uid or str(uuid.uuid4())})
a=user('admin','画布管理员');b=user('member','画布甲');c=user('member','画布乙');anon=TestClient(app)
from shared_workspace import share_workspace
shared=share_workspace(a,b,c)
p=okay(b.post('/api/canvases',json={'title':'共享研究画布'}));pid=p['id']
assert anon.get('/api/canvases').status_code==401
assert anon.get('/api/canvases/'+pid).status_code==401
assert c.delete('/api/canvases/'+pid).status_code==403
assert okay(c.get('/api/canvases/'+pid))['can_delete'] is False
asset=upload(b)
doc={'schemaVersion':1,'nodes':[node('text','text',text='海边的小屋'),node('image','photo',media_id=asset),node('image','image'),node('video','video',prompt='缓缓推进')],'edges':[{'id':'e1','source':'text','target':'image'},{'id':'e2','source':'photo','target':'image'},{'id':'e3','source':'image','target':'video'}]}
p['revision']=okay(save(c,p,doc))['revision']
assert okay(b.get('/api/canvases/'+pid))['document']==doc
# Same base revision: exactly one edit wins, preserving the other's conflict.
with ThreadPoolExecutor() as pool:results=list(pool.map(lambda client:save(client,p,doc),[b,c]))
assert sorted(r.status_code for r in results)==[200,409]
p=okay(b.get('/api/canvases/'+pid))
assert b.delete('/api/assets/'+asset).status_code==409
assert b.post('/api/assets/batch-delete',json={'keys':['asset:'+asset]}).status_code==409
assert run(b,p,'video').status_code==409  # upstream has no output yet
# Reject cycles, duplicate edges, unsupported types, forged outputs, unknown assets and invalid params.
for mutate in [lambda d:d['edges'].append({'id':'cycle','source':'image','target':'image'}),lambda d:d['edges'].append({'id':'duplicate','source':'text','target':'image'}),lambda d:d['edges'].append({'id':'wrong','source':'video','target':'image'}),lambda d:d['nodes'][2].update(active_job=999),lambda d:d['nodes'][1].update(media_id='0'*32),lambda d:d['nodes'][3]['params'].update(seconds=60)]:
    bad=json.loads(json.dumps(doc));mutate(bad);assert save(b,p,bad).status_code in (400,422)
uid=str(uuid.uuid4())
# Atomic retries return the same job, including after later document edits.
with ThreadPoolExecutor() as pool:ids=list(pool.map(lambda _:okay(run(b,p,'image',uid))['id'],range(4)))
assert len(set(ids))==1;jid=ids[0]
with core.db() as con:
    j=con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
    assert j['prompt']=='海边的小屋' and json.loads(j['refs'])==[asset]
    assert con.execute('SELECT count(*) FROM canvas_job_links WHERE project=?',(pid,)).fetchone()[0]==1
changed=json.loads(json.dumps(doc));changed['nodes'][0]['text']='新的文字，不影响已提交任务'
p['revision']=okay(save(b,p,changed))['revision']
assert okay(run(b,p,'image',uid))['id']==jid
# Actual provider adapter runs with a deterministic local response, no external billing.
png=io.BytesIO();Image.new('RGB',(1536,864),'#9fbac8').save(png,'PNG')
def provider(endpoint,payload=None,files=None):
    assert payload['prompt']=='海边的小屋';assert len(files)==1
    return {'data':[{'b64_json':base64.b64encode(png.getvalue()).decode()}]},'req-canvas-test'
with patch.object(image_api,'provider_call',provider):assert image_api.run_one()
runs=okay(b.get('/api/canvases/'+pid+'/runs'))['runs'];image=next(j for j in runs if j['id']==jid)
assert image['status']=='done' and image['canvas_node']=='image' and image['width']==1536
result=image['result'];assert b.get('/media/'+result).status_code==200
# Real video queue receives the exact generated image; no separate fake canvas queue.
vid=okay(run(c,p,'video'))['id']
with core.db() as con:
    j=con.execute('SELECT * FROM jobs WHERE id=?',(vid,)).fetchone();assert json.loads(j['refs'])==[result] and j['kind']=='video'
    assert j['width']>j['height']
# Refresh does not submit again; duplicate keeps media but starts no jobs.
for _ in range(3):okay(b.get('/api/canvases/'+pid));okay(b.get('/api/canvases/'+pid+'/runs'))
copy=okay(c.post('/api/canvases/'+pid+'/duplicate'))
assert next(n for n in copy['document']['nodes'] if n['id']=='image')['media_id']==result
assert okay(c.get('/api/canvases/'+copy['id']+'/runs'))['runs']==[]
with core.db() as con:assert con.execute('SELECT count(*) FROM jobs').fetchone()[0]==2
assert b.delete('/api/jobs/'+str(jid)).status_code==409
# Replacing a completed node can explicitly select an imported asset instead of the last run.
replacement=json.loads(json.dumps(changed));replacement['nodes'][2].update(media_id=asset,use_media=True)
p['revision']=okay(save(b,p,replacement))['revision']
with core.db() as con:
    from canvas_api import media_for_node
    assert media_for_node(con,pid,Node.model_validate(replacement['nodes'][2]))==asset
# Disabling images also blocks canvas submissions server-side, without creating orphan links.
okay(a.put('/api/settings/openai',json={'enabled':False,'default_model':image_api.DEFAULT_MODEL}))
assert run(b,p,'image').status_code==403
with core.db() as con:assert con.execute('SELECT count(*) FROM canvas_job_links WHERE project=?',(pid,)).fetchone()[0]==2
# Removing nodes never deletes media or stops a task, but releases document references.
p['revision']=okay(save(b,p,{'schemaVersion':1,'nodes':[],'edges':[]}))['revision']
assert b.get('/media/'+asset).status_code==200
assert next(j for j in okay(c.get('/api/state'))['jobs'] if j['id']==vid)['status']=='queued'
okay(c.delete('/api/canvases/'+copy['id']))
okay(a.post('/api/jobs/'+str(vid)+'/cancel'))
okay(a.delete('/api/jobs/'+str(vid)))
okay(b.delete('/api/jobs/'+str(jid)))
okay(b.delete('/api/assets/'+asset))
okay(b.delete('/api/canvases/'+pid))
with core.db() as con:
    assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not list(con.execute('PRAGMA foreign_key_check'))
print('PASS shared permissions, revision races, graph validation, frozen inputs, atomic idempotency, real image adapter + video queue, result recovery, media protection and no refresh resubmission')
