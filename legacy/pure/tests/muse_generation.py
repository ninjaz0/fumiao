"""Muse admission, routing, durable polling and native output tests without cloud calls."""
import io,json,os,shutil,sys,tempfile,uuid,subprocess
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',OPENAI_API_KEY='sk-test-muse-only',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,muse_provider as muse,image_api,timing,worker_api
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()

def ok(r):assert r.is_success,(r.status_code,r.text[:250]);return r.json()
def user(name,role):
 code=core.token()
 with core.db(True) as c:c.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+60))
 client=TestClient(app);ok(client.post('/api/register',json={"nickname": name, 'name':name,'password':'muse-test-password','code':code}));return client
admin=user('管理员','admin');member=user('测试成员','member')
def submit(kind='video',**extra):
 body={'uid':str(uuid.uuid4()),'prompt':'Muse test','model':'muse-'+kind,'ratio':'16:9'}
 if kind=='video':body['seconds']=6
 body.update(extra);return ok(member.post('/api/image-jobs' if kind=='image' else '/api/jobs',json=body))['id']
def row(jid):
 with core.db() as c:return dict(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
image=submit('image');video=submit('video')
assert row(image)['quality']==0 and row(video)['seconds']==6
assert ok(member.post('/api/estimate',json={'kind':'video','model':'muse-video','ratio':'16:9','seconds':6}))['queue']['reason']=='waiting_muse'
assert ok(member.post('/api/estimate',json={'kind':'image','model':'muse-image','ratio':'16:9'}))['duration']['source']=='none'
assert member.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'bad','model':'muse-video','seconds':15}).status_code==400
# No account / backend outage: jobs stay queued with no upstream submission.
with patch.object(muse,'ready',return_value=False):muse.tick()
assert row(image)['status']==row(video)['status']=='queued'
assert row(video)['note']=='等待 Muse 就绪'
secret=core.token()
with core.db(True) as c:c.execute("INSERT INTO nodes(owner,name,key,lastseen,stage) VALUES(1,'GPU',?,?,'ready')",(core.hashed(secret),core.now()))
gpu=TestClient(app,headers={'Authorization':'Bearer '+secret});assert ok(gpu.post('/agent/claim'))['job'] is None
with patch.object(image_api,'provider_call',side_effect=AssertionError('Muse reached OpenAI')):assert image_api.run_one() is False
print('PASS offline/no-account admission persists; Muse never enters GPU/OpenAI execution')
remote={};posts=[]
def request(path,body=None,**kw):
 if body is not None:
  posts.append((path,body,kw));tid='task_'+format(len(posts),'020x');remote[tid]={'status':'queued'};return {'task_id':tid}
 return remote[path.rsplit('/',1)[-1]]
files=Path(sandbox.name)/'fixtures';files.mkdir();png=files/'native.png';Image.new('RGB',(900,600),'orange').save(png)
mp4=files/'native.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=navy:s=160x90:r=24','-t','7.25','-c:v','libx264','-pix_fmt','yuv420p',str(mp4)],check=True)
def download(url,job):
 target=core.stage_dir/'test-result';shutil.copy2(png if job['kind']=='image' else mp4,target);return target
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',side_effect=request),patch.object(muse,'download',side_effect=download):
 muse.tick();assert row(image)['status']=='running' and len(posts)==1
 tid=row(image)['provider_request'];remote[tid]={'status':'processing'};muse.tick();assert len(posts)==1
 remote[tid]={'status':'completed','url':'/v1/media/native.png'};muse.tick()
 assert row(image)['status']=='done' and row(image)['width']==900 and row(image)['height']==600
 assert row(video)['status']=='running' and len(posts)==2
 assert posts[1][1]['duration']==6 and posts[1][1]['aspect_ratio']=='16:9' and 'resolution' not in posts[1][1]
 # Persistent ticket is reused across polling cycles/restarts.
 tid=row(video)['provider_request'];remote[tid]={'status':'processing'};muse.tick();assert len(posts)==2
 remote[tid]={'status':'completed','url':'/v1/media/native.mp4'};muse.tick()
 result=row(video);actual=json.loads(result['output_metadata']);assert result['seconds']==6 and actual['duration']==7.25 and result['width']==160
 assert member.get('/media/'+result['result']).status_code==200
 assert admin.get('/media/'+result['result']).status_code==404
assert all(p[0] in ('/v1/images/tasks','/v1/videos') for p in posts)
with core.db() as c:
 f=timing.features(row(video),c);assert f['executor']=='muse-api' and f['width']==0 and f['steps']==0
 prediction=timing.Estimator(c).estimate(f);assert prediction['samples']==1
 assert timing.Estimator(c).estimate(f|{'native_ratio':'9:16'})['samples']==0
print('PASS native dimensions/duration preserved, requested duration retained, private outputs and isolated timing samples')
# Ambiguous video POST is never replayed; stored upstream IDs continue polling after outages.
unknown=submit('video')
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',side_effect=muse.TransportError()) as calls:
 muse.tick();muse.tick();assert calls.call_count==1
assert row(unknown)['status']=='failed' and '待确认' in row(unknown)['note']
with core.db(True) as c:c.execute("UPDATE jobs SET status='failed' WHERE id=?",(unknown,))
waiting=submit('video')
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',side_effect=muse.TransportError(429)):
 muse.tick()
assert row(waiting)['status']=='queued'
# Preserve the media path of each configured origin, including historical Muse task URLs.
origins = ('http://127.0.0.1:18610', muse.MUSE_PUBLIC_URL, muse.LEGACY_MUSE_PUBLIC_URL)
for base_url in (*origins, '/muse', ''):
    assert muse._media_name(base_url + '/v1/media/a.mp4', origins) == 'a.mp4'

# Reject provider-returned SSRF or path traversal before any network connection.
for url in [
    'http://169.254.169.254/v1/media/a.mp4',
    'https://backend.nvmes.com/flow/v1/media/a.mp4',
    'https://backend.nvmes.com/v1/media/a.mp4',
    'https://muse.nvmes.com/muse/v1/media/a.mp4',
    '/v1/media/../../secret',
    '/admin/accounts',
    '/v1/media/a.mp4?secret=x',
]:
 try:muse.download(url,row(waiting));raise AssertionError(url)
 except ValueError:pass
# Canvas nodes use the same Muse path and retain their private workspace.
project=ok(member.post('/api/canvases',json={'title':'Muse canvas'}))
doc={'nodes':[{'id':'image','type':'image','x':0,'y':0,'media_id':row(image)['result'],'params':{'model':'muse-image'}},{'id':'video','type':'video','x':400,'y':0,'prompt':'use source','params':{'model':'muse-video','seconds':6}}],'edges':[{'id':'reference','source':'image','target':'video'}]}
ok(member.put('/api/canvases/'+project['id']+'/document',json={'expected_revision':1,'title':project['title'],'document':doc}))
canvasjob=ok(member.post('/api/canvases/'+project['id']+'/nodes/video/runs',json={'expected_revision':2,'uid':str(uuid.uuid4())}))['id']
assert row(canvasjob)['model']=='muse-video' and row(canvasjob)['seconds']==6 and json.loads(row(canvasjob)['refs'])==[row(image)['result']]
assert admin.get('/api/canvases/'+project['id']+'/runs').status_code==404
ok(member.post('/api/jobs/'+str(canvasjob)+'/cancel',json={}))
invalid=files/'not-video';invalid.write_text('#EXTM3U\nhttp://127.0.0.1/private')
with patch.object(subprocess,'check_output',side_effect=AssertionError('untrusted playlist reached ffprobe')):
 try:muse.inspect_media(invalid,'video');raise AssertionError('playlist accepted')
 except ValueError:pass
print('PASS canvas Muse routing, private references and restricted actual video decoding')
ok(admin.put('/api/settings/openai',json={'enabled':False,'default_model':image_api.DEFAULT_MODEL}))
assert member.post('/api/image-jobs',json={'uid':str(uuid.uuid4()),'model':'muse-image','prompt':'disabled'}).status_code==403
assert 'muse-image' in ok(member.get('/api/state'))['images']['models']
print('PASS ambiguous-submit no replay, overload requeue, download URL boundaries and global image switch')
