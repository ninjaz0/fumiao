"""Isolated integration tests: billing-safe retries, permissions, storage and GPU routing."""
import base64
import io
import json
import os
import secrets
import sys
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

sandbox = tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name, FUMIAO_SITE="http://testserver", OPENAI_API_KEY="sk-test-images-only")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from fastapi.testclient import TestClient
import core
import image_api
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()


def okay(response):
    assert response.is_success, (response.status_code, response.text[:300])
    return response.json()


def user(role, name):
    code = core.token()
    with core.db(True) as con:
        con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)", (code, role, core.now()+90))
    client = TestClient(app)
    okay(client.post('/api/register', json={"nickname": name, 'name':name,'password':'image-test-strong-2026','code':code}))
    return client


def body(**values):
    return dict(uid=str(uuid.uuid4()), prompt="海边灯塔", **values)


a=user('admin','图片管理员'); b=user('member','图片成员'); anon=TestClient(app)
from shared_workspace import share_workspace
shared=share_workspace(a,b)
output=io.BytesIO(); Image.new('RGB',(1536,864),'#88aabb').save(output,'PNG'); png=output.getvalue()
calls=[]

def provider(endpoint,payload=None,files=None):
    calls.append((endpoint,payload,files))
    return {'data':[{'b64_json':base64.b64encode(png).decode()}],'usage':{'total_tokens':123}}, 'req-example'

assert anon.post('/api/image-jobs',json=body()).status_code==401
assert b.put('/api/settings/openai',json={'enabled':False,'default_model':image_api.DEFAULT_MODEL}).status_code==403
assert b.post('/api/settings/openai/check').status_code==403
assert a.post('/api/image-jobs',json=body(model='other')).status_code==422
assert a.post('/api/image-jobs',json=body(ratio='auto')).status_code==400
s=okay(a.get('/api/state'))
assert s['images']['configured'] and 'sk-test' not in json.dumps(s)
request=body(); jid=okay(b.post('/api/image-jobs',json=request))['id']
assert okay(b.post('/api/image-jobs',json=request))['id']==jid
# A real GPU handshake must never pick up an image request.
pair=okay(a.post('/api/pairs',json={'name':'路由验收'}))['command'].split()[-1]
key=core.token();okay(anon.post('/agent/enroll',json={'code':pair,'secret':key}))
gpu=TestClient(app,headers={'Authorization':'Bearer '+key})
okay(gpu.post('/agent/heartbeat',json={'stage':'ready'}))
assert okay(gpu.post('/agent/claim'))['job'] is None
with patch.object(image_api,'provider_call',provider):
    assert image_api.run_one()
s=okay(a.get('/api/state')); job=next(j for j in s['jobs'] if j['id']==jid)
assert job['status']=='done' and job['kind']=='image'
assert job['timing']['source']=='measured' and job['timing']['elapsed']>=0
assert all(job['timing'].get(k,0)>=0 for k in ('prepare','generation','finalize'))
asset=job['result'];assert any(x['id']==asset for x in s['assets'])
assert a.get('/media/'+asset).content==png
assert anon.get('/media/'+asset).status_code==401
assert '.png' in a.get('/media/'+asset+'?download=true').headers['content-disposition']
assert calls[0][0]=='images/generations' and calls[0][1]['n']==1
assert '图片成员' not in json.dumps(calls[0][1])
# Images can become video references, and remain protected while referenced.
video=okay(b.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'海浪轻轻流动','refs':[asset]}))['id']
assert b.delete('/api/jobs/'+str(jid)).status_code==409
assert okay(gpu.post('/agent/claim'))['job']['id']==video
editid=okay(a.post('/api/image-jobs',json={**body(refs=[asset]),'prompt':'保留 <Picture 1>，改成夜景'}))['id']
assert b.delete('/api/jobs/'+str(editid)).status_code==403
with patch.object(image_api,'provider_call',provider): image_api.run_one()
assert calls[-1][0]=='images/edits' and calls[-1][2][0]==(png,'image/png')
assert '参考图片1' in calls[-1][1]['prompt']
# No automatic retry after an ambiguous, possibly billed failure.
failed=okay(a.post('/api/image-jobs',json=body()))['id']
with patch.object(image_api,'provider_call',side_effect=image_api.ProviderError('连接中断，结果未确认')) as mock:
    image_api.run_one();assert not image_api.run_one();assert mock.call_count==1
assert next(j for j in okay(a.get('/api/state'))['jobs'] if j['id']==failed)['status']=='failed'
with patch.object(image_api,'provider_call',return_value=({'data':[{'b64_json':'invalid'}]},'')):
    invalid=okay(a.post('/api/image-jobs',json=body()))['id'];image_api.run_one()
assert next(j for j in okay(a.get('/api/state'))['jobs'] if j['id']==invalid)['status']=='failed'
okay(a.put('/api/settings/openai',json={'enabled':False,'default_model':image_api.DEFAULT_MODEL}))
assert a.post('/api/image-jobs',json=body()).status_code==403
okay(a.put('/api/settings/openai',json={'enabled':True,'default_model':image_api.DEFAULT_MODEL}))
# Quota includes images waiting in the queue, with idempotent submissions.
with patch.object(core,'QUOTA',1): assert a.post('/api/image-jobs',json=body()).status_code==507
cancel=okay(a.post('/api/image-jobs',json=body()))['id'];okay(a.post(f'/api/jobs/{cancel}/cancel'))
with patch.object(image_api,'provider_call',provider):assert not image_api.run_one()
# Verify actual HTTP JSON/multipart encoding without calling OpenAI.
class Response:
    headers={'x-request-id':'req-http'}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,*args):return b'{"data":[]}'
http=[]
def urlopen(request,**kwargs):http.append(request);return Response()
with patch('urllib.request.urlopen',urlopen):
    image_api.provider_call('images/generations',{'model':image_api.DEFAULT_MODEL,'prompt':'测试'})
    image_api.provider_call('images/edits',{'model':image_api.DEFAULT_MODEL,'prompt':'参考图'},[(png,'image/png')])
assert http[0].full_url=='https://api.openai.com/v1/images/generations'
assert json.loads(http[0].data)['prompt']=='测试'
assert b'name="image[]"' in http[1].data and png in http[1].data
assert http[1].headers['Content-type'].startswith('multipart/form-data; boundary=')
# Restart must not replay in-flight image work.
with core.db(True) as con:con.execute("UPDATE jobs SET status='running' WHERE id=?",(failed,))
with patch.object(image_api,'provider_call',provider):
    with TestClient(app):pass
assert next(j for j in okay(a.get('/api/state'))['jobs'] if j['id']==failed)['status']=='failed'
with core.db() as con:assert not list(con.execute('PRAGMA foreign_key_check'))
print('PASS: image generation/editing, private media, admin settings, quota, idempotency, GPU isolation and no billed-request replay')
