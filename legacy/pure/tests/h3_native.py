"""Native roles, typed media, ownership, billing, dispatch, graph and canvas acceptance."""
import ast,io,json,os,sys,tempfile,uuid,subprocess,types
from pathlib import Path
from PIL import Image
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'agent')]
from fastapi.testclient import TestClient
import core,node_models,job_progress
from server import app
from canvas_api import Node
from credit_fixtures import fund_test_accounts
fund_test_accounts()
c=TestClient(app)
with core.db(True) as con:
 con.execute("INSERT INTO users(name,role) VALUES('native-admin','admin')");token=core.token();con.execute('INSERT INTO sessions VALUES(?,1,?)',(core.hashed(token),core.now()+1000))
c.cookies.set('fm_session',token)
def ok(r):assert r.is_success,(r.status_code,r.text[:500]);return r.json()
def image(w,h):
 b=io.BytesIO();Image.new('RGB',(w,h),'#4499aa').save(b,format='PNG');return ok(c.post('/api/assets',content=b.getvalue()))['id']
a,b,p=image(960,540),image(960,540),image(540,960)
def submit(refs=[],options=None,**kw):return c.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'A calm test scene.','refs':refs,'h3':options,'quality':480,'seconds':5}|kw)
def job(i):
 with core.db() as con:return dict(con.execute('SELECT * FROM jobs WHERE id=?',(i,)).fetchone())
engine={'json':json,'ROOT':ROOT/'agent/vendor/engine'};render={name:getattr(node_models,name) for name in ('h3_fast_preset','h3_input_metadata','h3_reference_files')};render['sampling_steps']=job_progress.sampling_steps
for path,name,scope in [('agent/vendor/engine/scripts/generate.py','make_graph',engine),('agent/render.py','build_graph',render)]:
 if name=='build_graph':scope['h3']=types.SimpleNamespace(make_graph=engine['make_graph'])
 fn=next(n for n in ast.parse((ROOT/path).read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name);exec(compile(ast.Module(body=[fn],type_ignores=[]),path,'exec'),scope)
for options,refs,kind,ports in [({'mode':'reference'},[a],'MiniMaxH3ReferenceToVideo',set()),({'mode':'frames','first_frame':a},[a],'MiniMaxH3ImageToVideo',{'first_frame'}),({'mode':'frames','last_frame':a},[a],'MiniMaxH3ImageToVideo',{'last_frame'}),({'mode':'frames','first_frame':a,'last_frame':b},[a,b],'MiniMaxH3ImageToVideo',{'first_frame','last_frame'}),({'mode':'frames'},[],'MiniMaxH3ImageToVideo',set())]:
 i=ok(submit(refs,options))['id'];j=job(i);j['refs']=json.loads(j['refs']);g=render['build_graph'](j,'test');assert g['5']['class_type']==kind,g['5'];assert {'first_frame','last_frame'}&set(g['5']['inputs'])==ports
 assert node_models.h3_needs_native_worker(j) and node_models.h3_input_fingerprint(j)
 for workflow,expected in [(node_models.H3_LEGACY_TURBO_WORKFLOW,False),(node_models.H3_TURBO_WORKFLOW,True)]:assert node_models.can_run_job({'ready_models':'["MiniMax H3"]','models':['MiniMax H3'],'workflow':workflow},j)==expected
 with core.db() as con:assert con.execute('SELECT state FROM credit_charges WHERE job=?',(i,)).fetchone()[0]=='held'
for refs,options in [([a,p],{'mode':'frames','first_frame':a,'last_frame':p}),([a,b],{'mode':'frames','first_frame':a}),([a,a],{'mode':'reference'})]:assert submit(refs,options).status_code==400
assert submit([a],{'mode':'reference'},model='muse-video').status_code==400
video=Path(sandbox.name)/'ref.mp4';audio=Path(sandbox.name)/'ref.wav'
subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2.2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',str(video)],check=True)
subprocess.run(['ffmpeg','-v','error','-i',str(video),'-vn','-y',str(audio)],check=True)
v=ok(c.post('/api/h3/references?kind=video',content=video.read_bytes()));u=ok(c.post('/api/h3/references?kind=audio',content=audio.read_bytes()))
assert v['kind']=='ref_video' and v['has_audio'] and u['kind']=='ref_audio'
assert TestClient(app).post('/api/h3/references?kind=video',content=video.read_bytes()).status_code==401
assert TestClient(app).get('/media/'+v['id']).status_code==401
for raw in (b'not media',audio.read_bytes()):assert c.post('/api/h3/references?kind=video',content=raw).status_code==400
j=job(ok(submit([a,v['id'],u['id']],{'mode':'reference','video_audio':[v['id']]}))['id']);j['refs']=json.loads(j['refs']);g=render['build_graph'](j,'typed')
assert g['5']['class_type']=='MiniMaxH3ReferenceToVideo'
for port,value in [('ref_videos.ref_video_0',['41',0]),('ref_video_audios.ref_video_audio_0',['41',1]),('ref_audios.ref_audio_0',['70',0])]:assert g['5']['inputs'][port]==value
assert g['40']['inputs']['file']=='fumiao/typed/1.mp4' and g['70']['inputs']['audio']=='fumiao/typed/2.wav'
for refs,options in [([v['id']],None),([v['id']],{'mode':'frames','first_frame':v['id']}),([a],{'mode':'reference','video_audio':[a]})]:assert submit(refs,options).status_code==400
with core.db(True) as con:
 uid=con.execute("INSERT INTO users(name,role) VALUES('other','member')").lastrowid;secret=core.token();con.execute('INSERT INTO sessions VALUES(?,?,?)',(core.hashed(secret),uid,core.now()+1000))
other=TestClient(app);other.cookies.set('fm_session',secret)
assert other.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'test','refs':[v['id']],'h3':{'mode':'reference'}}).status_code in (403,404)
assert other.get('/media/'+v['id']).status_code in (403,404)
project=ok(c.post('/api/canvases',json={'title':'native inputs'}));n=Node(id='native',type='video',x=0,y=0,prompt='native test',params={'model':'MiniMax H3','h3':{'mode':'frames','last_frame':b}}).model_dump()
revision=ok(c.put(f"/api/canvases/{project['id']}/document",json={'expected_revision':project['revision'],'title':project['title'],'document':{'schemaVersion':1,'nodes':[n],'edges':[]}}))['revision'];i=ok(c.post(f"/api/canvases/{project['id']}/nodes/native/runs",json={'expected_revision':revision,'uid':str(uuid.uuid4())}))['id']
assert json.loads(job(i)['h3_inputs'])['last_frame']==b
with core.db() as con:assert con.execute('SELECT 1 FROM canvas_media_refs WHERE media=?',(b,)).fetchone()
pair=ok(c.post('/api/pairs',json={}))['command'].split()[-1];worker=TestClient(app);secret=core.token();ok(worker.post('/agent/enroll',json={'code':pair,'secret':secret}));worker.headers['Authorization']='Bearer '+secret
ok(worker.post('/agent/heartbeat',json={'stage':'ready','workflow':node_models.H3_TURBO_WORKFLOW,'video_steps':[4,16,20,32,50]}));leased=ok(worker.post('/agent/claim'))['job'];assert leased['h3_inputs']['version']==1
assert worker.put(f"/agent/jobs/{leased['id']}/result",content=b'bad',headers={'X-Job-Ticket':leased['ticket'],'X-Job-Timing':'{"sampling_steps":20}'}).status_code==422
print('PASS native graphs and roles, isolation, credits, real typed-media upload, private ownership, canvas snapshot, worker and receipt gates')
