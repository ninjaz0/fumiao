"""Workspace migration and privacy boundary regression; no external generation calls."""
import ast,base64,hashlib,io,json,os,sqlite3,sys,tempfile,uuid
from pathlib import Path
from unittest.mock import patch
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
tmp=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=tmp.name,FUMIAO_SITE='http://testserver',OPENAI_API_KEY='sk-test-workspaces-only')
sys.path.insert(0,str(ROOT))
# Start with the pre-workspace schema and real shared records.
module=ast.parse((ROOT/'core.py').read_text());schema=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SCHEMA' for t in n.targets))
c=sqlite3.connect(Path(tmp.name)/'studio.sqlite');c.executescript(schema)
salt='11'*16;password='workspace-test-password'
pw=hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=2**15,r=8,p=1,maxmem=64*1024**2).hex()
for i,name in enumerate(('admin','alice','bob','eve'),1):c.execute('INSERT INTO users(id,name,salt,pw,role) VALUES(?,?,?,?,?)',(i,name,salt,pw,'admin' if i==1 else 'member'))
legacy='a'*32;c.execute("INSERT INTO media VALUES(?,'ref',3,'image/png',64,64,2)",(legacy,))
c.execute("INSERT INTO jobs(uid,owner,prompt,refs,status,created,updated,result,ratio,quality,seconds,seed,width,height) VALUES('legacy',2,'shared legacy','[]','done',1,2,?,'16:9',480,5,1,864,480)",(legacy,))
c.execute("INSERT INTO canvas_projects(id,title,owner,last_editor,created,updated) VALUES('legacycanvas','旧画布',2,2,1,2)")
c.commit();c.close()
from fastapi.testclient import TestClient
import core,image_api,worker_api
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
core.store.path(legacy).write_bytes(b'old')
def ok(response):
 assert response.is_success,(response.status_code,response.text[:300]);return response.json()
def denied(response):
 assert response.status_code in (403,404),(response.status_code,response.text[:300])
def client(name):
 result=TestClient(app);ok(result.post('/api/login',json={'name':name,'password':password}));return result
admin,alice,bob,eve=[client(n) for n in ('admin','alice','bob','eve')]
state=ok(alice.get('/api/state'));default=state['workspace_id'];assert any(j['prompt']=='shared legacy' for j in state['jobs'])
assert ok(bob.get('/api/state'))['workspace_id']==default
assert core.store.path(legacy).read_bytes()==b'old'
assert len(ok(eve.get('/api/canvases'))['projects'])==1
core.init_db();assert len([s for s in ok(admin.get('/api/state'))['workspaces'] if s['name']=='默认团队'])==1
new=ok(admin.post('/api/users',json={'name':'newuser','password':password,'nickname':'新用户'}));fresh=client('newuser');freshstate=ok(fresh.get('/api/state'));assert freshstate['jobs']==[] and len(freshstate['workspaces'])==1
print('PASS legacy migration preserves shared access and media; repeated migration and new-user privacy')
def personal(client):
 s=ok(client.get('/api/workspaces'));return next(w['id'] for w in s['workspaces'] if w['kind']=='personal')
def select(client,wid):client.headers['X-Workspace-Id']=str(wid)
pa,pb,pe=[personal(x) for x in (alice,bob,eve)]
select(alice,pa);select(bob,pb);select(eve,pe)
denied(alice.post('/api/workspaces',json={'name':'forbidden'}))
a=ok(admin.post('/api/workspaces',json={'name':'影像组','members':[2]}));b=ok(admin.post('/api/workspaces',json={'name':'设计组','members':[3]}))
assert 1 not in a['members']
assert a['id'] in [w['id'] for w in ok(admin.get('/api/workspaces'))['workspaces']]
assert b['id'] not in [w['id'] for w in ok(alice.get('/api/workspaces'))['workspaces']]
denied(alice.post(f"/api/workspaces/{b['id']}/select"))
def upload(client):
 raw=io.BytesIO();Image.new('RGB',(64,64),'orange').save(raw,format='PNG');return ok(client.post('/api/assets',content=raw.getvalue()))['id']
ref=upload(alice)
uid=str(uuid.uuid4());job=ok(alice.post('/api/jobs',json={'uid':uid,'prompt':'ALICE_PRIVATE_PROMPT','refs':[ref]}))['id']
project=ok(alice.post('/api/canvases',json={'title':'ALICE_PRIVATE_CANVAS'}))
for other in (bob,eve,admin):
 assert 'ALICE_PRIVATE' not in other.get('/api/state').text
 denied(other.get('/media/'+ref))
 denied(other.post('/api/assets/batch-download',json={'keys':['asset:'+ref]}))
 denied(other.post('/api/assets/batch-delete',json={'keys':['asset:'+ref]}))
 denied(other.put('/api/favorites',json={'keys':['asset:'+ref],'favorite':True}))
 denied(other.delete('/api/assets/'+ref))
 denied(other.post(f'/api/jobs/{job}/cancel',json={}))
 denied(other.post('/api/estimate',json={'refs':[ref]}))
 denied(other.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'steal','refs':[ref]}))
 denied(other.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'steal parent','parent':job}))
 denied(other.get('/api/canvases/'+project['id']))
 denied(other.get('/api/canvases/'+project['id']+'/runs'))
 denied(other.post('/api/canvases/'+project['id']+'/nodes/n/runs',json={'expected_revision':1,'uid':str(uuid.uuid4())}))
 denied(other.post('/api/canvases/'+project['id']+'/duplicate',json={}))
 denied(other.delete('/api/canvases/'+project['id']))
own_ref=upload(bob)
denied(bob.post('/api/assets/batch-delete',json={'keys':['asset:'+own_ref,'asset:'+ref]}))
assert bob.get('/media/'+own_ref).status_code==200
denied(bob.put('/api/favorites',json={'keys':['asset:'+own_ref,'asset:'+ref],'favorite':True}))
assert ok(bob.get('/api/state'))['favorites']==[]
print('PASS personal assets/jobs/canvases inaccessible to other members and administrators; mixed operations roll back')
select(alice,a['id']);team_ref=upload(alice);teamjob=ok(alice.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'TEAM_A_PROMPT','refs':[team_ref]}))['id']
teamcanvas=ok(alice.post('/api/canvases',json={'title':'TEAM_A_CANVAS'}))
for foreign in (bob,eve):
 denied(foreign.get('/media/'+team_ref));denied(foreign.get('/api/canvases/'+teamcanvas['id']))
select(admin,a['id']);assert admin.get('/media/'+team_ref).status_code==200
assert 'TEAM_A_PROMPT' in admin.get('/api/state').text
# Membership does not allow moving references, parents, reused idempotency keys across spaces.
denied(alice.post('/api/jobs',json={'uid':uid,'prompt':'different workspace'}))
denied(alice.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'cross','refs':[ref]}))
node={'id':'n','type':'image','x':0,'y':0,'media_id':ref}
denied(alice.put('/api/canvases/'+teamcanvas['id']+'/document',json={'expected_revision':1,'title':'team','document':{'nodes':[node]}}))
node['media_id']=team_ref
ok(alice.put('/api/canvases/'+teamcanvas['id']+'/document',json={'expected_revision':1,'title':'team','document':{'nodes':[node]}}))
# A nonmember administrator edits the team canvas; a member cannot administer the team.
ok(admin.put('/api/canvases/'+teamcanvas['id']+'/document',json={'expected_revision':2,'title':'team edited','document':{'nodes':[node]}}))
denied(alice.patch('/api/workspaces/'+str(a['id']),json={'expected_revision':1,'name':'hijack','members':[2,4]}))
ticket=ok(alice.post('/api/assets/batch-download',json={'keys':['asset:'+team_ref]}))['url']
ok(alice.put('/api/favorites',json={'keys':['asset:'+team_ref],'favorite':True}))
updated=ok(admin.patch('/api/workspaces/'+str(a['id']),json={'expected_revision':a['revision'],'name':a['name'],'members':[]}))
assert admin.patch('/api/workspaces/'+str(a['id']),json={'expected_revision':a['revision'],'name':a['name'],'members':[2]}).status_code==409
denied(alice.get(ticket));denied(alice.get('/media/'+team_ref));denied(alice.get('/api/state'));denied(alice.get('/api/canvases/'+teamcanvas['id']))
alice.headers.pop('X-Workspace-Id');assert a['id'] not in [w['id'] for w in ok(alice.get('/api/workspaces'))['workspaces']]
assert ok(admin.get('/api/state'))['workspace_id']==a['id']
print('PASS team membership, admin nonmember access, cross-space reference denial, live revocation and download recheck')
# GPU result inherits the original job workspace even after its creator is removed.
secret=core.token()
with core.db(True) as con:
 nid=con.execute("INSERT INTO nodes(owner,name,key,lastseen,stage) VALUES(1,'test',?,?,'ready')",(core.hashed(secret),core.now())).lastrowid
 con.execute("UPDATE jobs SET status='cancelled' WHERE id!=? AND status='queued'",(teamjob,))
gpu=TestClient(app,headers={'Authorization':'Bearer '+secret});claimed=ok(gpu.post('/agent/claim'))['job'];assert claimed['id']==teamjob
gpu.headers['X-Job-Ticket']=claimed['ticket']
# Discover the actual ticket header in the API contract rather than transmitting secrets.
raw=b'test-video-bytes'
with patch.object(worker_api,'validate_video',return_value=None):
 result=gpu.put(f'/agent/jobs/{teamjob}/result',content=raw,headers={'X-Sha256':hashlib.sha256(raw).hexdigest(),'X-Job-Ticket':claimed['ticket']})
 assert result.is_success,(result.status_code,result.text)
key=result.json()['id'];assert admin.get('/media/'+key).status_code==200;denied(alice.get('/media/'+key))
# Server-generated images are also attached to the submission workspace.
ok(admin.put('/api/settings/openai',json={'enabled':True,'default_model':image_api.DEFAULT_MODEL}))
select(bob,pb);imagejob=ok(bob.post('/api/image-jobs',json={'uid':str(uuid.uuid4()),'prompt':'BOB_PRIVATE_IMAGE'}))['id']
raw=io.BytesIO();Image.new('RGB',(1024,1024),'blue').save(raw,format='PNG')
with patch.object(image_api,'provider_call',return_value=({'data':[{'b64_json':base64.b64encode(raw.getvalue()).decode()}]},'fake-request')):
 assert image_api.run_one()
with core.db() as con:
 row=con.execute('SELECT j.workspace,m.workspace AS media_workspace,m.id FROM jobs j JOIN media m ON m.id=j.result WHERE j.id=?',(imagejob,)).fetchone();assert row['workspace']==row['media_workspace']==pb;key=row['id']
assert bob.get('/media/'+key).status_code==200;denied(admin.get('/media/'+key))
print('PASS original workspace retained by GPU results and server image generation')
