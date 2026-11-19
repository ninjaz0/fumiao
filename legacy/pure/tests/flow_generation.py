"""Flow catalog admission, ownership, billing and queue recovery without cloud calls."""
import io,json,os,shutil,sys,tempfile,uuid,subprocess
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,flow_provider as flow,flow_catalog,model_policy,credits,timing,image_api
from server import app
from credit_fixtures import fund_test_accounts
# Exercise the full transport catalog, including historical models that are
# hidden in production. Product admission is tested by flow_visibility.py.
for spec in flow_catalog.MODELS.values():spec['hidden']=False
with core.db(True) as c:
 flags=model_policy.read(c)['enabled']
 flags.update({key:True for key in flow_catalog.MODELS})
 model_policy.save(c,flags)
fund_test_accounts()
def ok(r):assert r.is_success,(r.status_code,r.text[:300]);return r.json()
def user(name,role):
 code=core.token()
 with core.db(True) as c:c.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+60))
 client=TestClient(app);ok(client.post('/api/register',json={'nickname':name,'name':name,'password':'flow-test-password','code':code}));return client
admin=user('Flow管理员','admin');member=user('Flow成员','member');other=user('其他成员','member')
def row(jid):
 with core.db() as c:return dict(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
def submit(model,client=member,**fields):
 spec=flow_catalog.MODELS[model];body={'uid':str(uuid.uuid4()),'prompt':'Flow integration test','model':model,**fields}
 return client.post('/api/image-jobs' if spec['kind']=='image' else '/api/jobs',json=body)
image_model='flow:gemini-3.1-flash-image-square';video_model='flow:veo-3.1-lite-4s-landscape'
image=ok(submit(image_model))['id'];video=ok(submit(video_model))['id']
assert row(image)['ratio']=='1:1' and row(video)['seconds']==4
assert ok(member.post('/api/estimate',json={'kind':'video','model':video_model}))['queue']['reason']=='waiting_flow'
with patch.object(flow,'ready',return_value=False):flow.tick()
assert row(image)['status']==row(video)['status']=='queued'
files=Path(sandbox.name)/'fixtures';files.mkdir();png=files/'out.png';Image.new('RGB',(600,600),'navy').save(png)
mp4=files/'out.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=navy:s=160x90:r=24','-t','4','-c:v','libx264','-pix_fmt','yuv420p',str(mp4)],check=True)
def download(url,job):
 p=core.stage_dir/'fake-flow';shutil.copy2(png if job['kind']=='image' else mp4,p);return p
calls=[]
def generate(job,inputs):calls.append(flow.payload(job,inputs));return {'url':'https://backend.nvmes.com/flow/tmp/fixture.mp4','media_id':'flow-media-example'}
with patch.object(flow,'ready',return_value=True),patch.object(flow,'generate',side_effect=generate),patch.object(flow,'download',side_effect=download):flow.tick();flow.tick()
assert row(image)['status']==row(video)['status']=='done'
assert json.loads(row(video)['output_metadata'])['duration']==4
assert member.get('/media/'+row(video)['result']).status_code==200 and other.get('/media/'+row(video)['result']).status_code==404
assert calls[0]['model']=='gemini-3.1-flash-image-square' and calls[1]['model']=='veo-3.1-lite-4s-landscape'
refs=[]
for i in range(3):
 b=io.BytesIO();Image.new('RGB',(128,128),(20+i,80,90)).save(b,format='PNG');refs.append(ok(member.post('/api/assets',content=b.getvalue(),headers={'Content-Type':'image/png'}))['id'])
for model,spec in flow_catalog.MODELS.items():
 extra={'refs':refs[:spec['min_refs']]}
 if spec['mode']=='extend':
  with core.db(True) as c:c.execute('UPDATE jobs SET ratio=? WHERE id=?',(spec['ratio'],video))
  extra['flow_source_job']=video
 jid=ok(submit(model,**extra))['id'];job=row(jid)
 assert job['ratio']==spec['ratio'] and job['seconds']==spec['seconds']
 with core.db() as c:inputs=json.loads(c.execute('SELECT input_json FROM flow_tasks WHERE job=?',(jid,)).fetchone()[0]);assert credits.price_key(job)==model+'|native'
 request=flow.payload(job,inputs);assert request['model']==spec['upstream']
 if spec['mode']=='extend':assert request['messages'][0]['content'][-1]['image_url']['url']=='extend://flow-media-example'
 ok(member.post('/api/jobs/'+str(jid)+'/cancel',json={}))
print('PASS all 104 public variants, source video, reference counts, native parameters and credit tiers')
assert submit('flow:veo-3.1-lite-i2v-4s-landscape').status_code==400
assert submit(video_model,refs=refs[:1]).status_code==400
assert submit('flow:veo-3.1-lite-extend-8s-portrait',client=other,flow_source_job=video).status_code==404
state=ok(admin.get('/api/state'));rev=state['model_policy']['revision']
ok(admin.patch('/api/settings/models',json={'model':image_model,'enabled':False,'expected_revision':rev}))
assert submit(image_model).status_code==403
assert member.patch('/api/settings/models',json={'model':video_model,'enabled':False,'expected_revision':rev+1}).status_code==403
assert submit(video_model,client=other,refs=refs[:1]).status_code==400
jid=ok(submit(video_model))['id']
with patch.object(flow,'ready',return_value=True),patch.object(flow,'generate',side_effect=flow.FlowError('连接中断，结果未确认')) as g:
 flow.tick();flow.tick();assert g.call_count==1
assert row(jid)['status']=='failed'
with core.db() as c:assert c.execute('SELECT state FROM credit_charges WHERE job=?',(jid,)).fetchone()[0]=='refunded'
jid=ok(submit(video_model))['id']
with core.db(True) as c:c.execute("UPDATE jobs SET status='running' WHERE id=?",(jid,));c.execute("UPDATE flow_tasks SET state='dispatching' WHERE job=?",(jid,))
flow.recover();assert row(jid)['status']=='failed'
for url in ['http://169.254.169.254/meta','https://backend.nvmes.com/flow/admin/config','http://127.0.0.1:22/tmp/x.mp4','https://backend.nvmes.com/flow/tmp/../admin','https://storage.googleapis.com.evil.test/file.mp4']:
 try:flow.download(url,row(jid));raise AssertionError(url)
 except flow.FlowError:pass
print('PASS admin-only switches, isolation, no duplicate uncertain generation, refunds, restart recovery and safe media URLs')
# Completion parsing uses streamed media metadata required for video extension.
stream=b'data: '+json.dumps({'choices':[{'delta':{'content':"<video src='https://backend.nvmes.com/flow/tmp/out.mp4' data-media-id='media-123'></video>"}}]}).encode()+b'\n\ndata: [DONE]\n'
class Reply(io.BytesIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
with patch.object(flow,'payload',return_value={}),patch.object(flow.urllib.request,'build_opener') as opener:
 opener.return_value.open.return_value=Reply(stream)
 result=flow.generate(row(video),{});assert result['media_id']=='media-123' and result['url'].endswith('/tmp/out.mp4')
print('PASS real SSE framing, output URL and source media identity')

# Readiness must reflect usable accounts rather than only a public model catalog.
for active in [False,True]:
 with patch.object(flow,'config',return_value=('http://127.0.0.1:18611','test-key','https://backend.nvmes.com/flow')),patch.object(flow.urllib.request,'build_opener') as opener:
  opener.return_value.open.side_effect=[Reply(json.dumps({'data':[{'id':'model'}]}).encode()),Reply(json.dumps({'backend_running':True,'has_active_tokens':active}).encode())]
  assert flow.ready() is active
assert '异常活动检查' in flow.safe_error(503,'PUBLIC_ERROR_UNUSUAL_ACTIVITY')
assert '启用状态' in flow.safe_error(503,'没有可用的Token进行视频生成')
print('PASS readiness checks active accounts and explains upstream rejection')

with patch.object(flow,'config',return_value=('http://127.0.0.1:18611','private-test-key','https://backend.nvmes.com/flow')),patch.object(flow.urllib.request,'build_opener') as opener:
 opener.return_value.open.return_value=Reply(b'generated-video-content')
 downloaded=flow.download('https://flow-content.google/video/test-video?signature=example',row(video))
 assert downloaded.read_bytes()==b'generated-video-content';downloaded.unlink()
 sent=opener.return_value.open.call_args.args[0]
 assert sent.get_header('Authorization') is None
print('PASS current Google media domain without leaking provider API key')

# Flow image nodes have no duration; video nodes still keep their declared fixed duration.
project=ok(member.post('/api/canvases',json={'title':'Flow canvas regression'}))
image_key='flow:gemini-3.1-flash-lite-image-square'
document={'nodes':[{'id':'fi','type':'image','x':0,'y':0,'prompt':'Flow canvas image','params':{'model':image_key,'ratio':'1:1','seconds':0}}, {'id':'fv','type':'video','x':400,'y':0,'prompt':'Flow canvas video','params':{'model':video_model,'ratio':'16:9','seconds':4}}]}
ok(member.put('/api/canvases/'+project['id']+'/document',json={'expected_revision':1,'title':project['title'],'document':document}))
for nid,model in [('fi',image_key),('fv',video_model)]:
 jid=ok(member.post('/api/canvases/'+project['id']+'/nodes/'+nid+'/runs',json={'expected_revision':2,'uid':str(uuid.uuid4())}))['id']
 assert row(jid)['model']==model
 ok(member.post('/api/jobs/'+str(jid)+'/cancel',json={}))
assert other.get('/api/canvases/'+project['id']+'/runs').status_code==404
print('PASS studio and canvas share Flow image/video submission and private workspaces')
