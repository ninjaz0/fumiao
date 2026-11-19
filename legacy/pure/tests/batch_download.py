"""ZIP integrity, permissions, deduplication and bounded streaming without real assets."""
import io
import os
import sys
import tempfile
import uuid
import zipfile
from contextlib import ExitStack, closing
from pathlib import Path
from unittest.mock import patch

sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
import core
import library_api
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()


def okay(r):
    assert r.is_success,(r.status_code,r.text[:200]);return r.json()


def auth(name):
    code=core.token()
    with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'member',?)",(code,core.now()+60))
    client=TestClient(app)
    okay(client.post('/api/register',json={"nickname": name, 'name':name,'password':'test-download-strong-2026','code':code}))
    return client


def download(c,keys):return c.post('/api/assets/batch-download',json={'keys':keys})


a=auth('甲成员');b=auth('乙成员');anon=TestClient(app)
from shared_workspace import share_workspace
shared=share_workspace(a,b)
raw=io.BytesIO();Image.new('RGB',(64,32),'#abcdee').save(raw,'PNG');png=raw.getvalue()
asset=okay(a.post('/api/assets',content=png))['id']
video_key=uuid.uuid4().hex;video=b'\x00\x00\x00\x18ftypisom'+b'video-fixture'*200
with core.db(True) as con:
    uid=con.execute("SELECT id FROM users WHERE name='甲成员'").fetchone()[0]
    core.store.path(video_key).write_bytes(video)
    con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner) VALUES(?,'video',?,'video/mp4',864,480,?)",(video_key,len(video),uid))
    jid=con.execute("INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,result) VALUES(?,?,'视频下载测试','[]','16:9',480,5,1,864,480,'done',?,?,?)",(str(uuid.uuid4()),uid,core.now(),core.now(),video_key)).lastrowid
with core.db(True) as con:
    con.execute('UPDATE media SET workspace=? WHERE id=?',(shared,video_key))
    con.execute('UPDATE jobs SET workspace=? WHERE id=?',(shared,jid))
keys=['asset:'+asset,'job:'+str(jid),'asset:'+asset]
assert download(anon,keys).status_code==401
assert download(a,[]).status_code==422
assert download(a,['asset:'+asset]*201).status_code==422
assert download(a,['../secret']).status_code==400
assert download(a,['job:999999']).status_code==404
prepared=okay(download(b,keys)) # shared-library members may download one another's assets
url=prepared['url']
assert anon.get(url).status_code==401
assert a.get(url).status_code==403
response=b.get(url)
assert response.status_code==200 and response.headers['content-type']=='application/zip'
assert "filename*=UTF-8''" in response.headers['content-disposition']
with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist())==2
    assert archive.namelist()[0].endswith('.png') and archive.namelist()[1].endswith('.mp4')
    assert archive.read(archive.namelist()[0])==png
    assert archive.read(archive.namelist()[1])==video
    assert all('/' not in name and '..' not in name for name in archive.namelist())
assert b.get(url).content==response.content # same-user retry is supported
with core.db(True) as con:con.execute('UPDATE downloads SET expires=0')
assert b.get(url).status_code==410
queued=okay(a.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'还没生成'}))['id']
assert download(a,['job:'+str(queued)]).status_code==409
okay(a.post(f'/api/jobs/{queued}/cancel'))
assert download(a,['job:'+str(queued)]).status_code==409
with core.db(True) as con:con.execute("UPDATE jobs SET kind='image',result=?,status='done' WHERE id=?",(asset,queued))
canonical=okay(download(a,['job:'+str(queued),'asset:'+asset]))
with zipfile.ZipFile(io.BytesIO(a.get(canonical['url']).content)) as archive:assert len(archive.namelist())==1
# A missing source must fail before ZIP response headers are sent, closing earlier handles.
prepared=okay(download(a,keys));opened=[]
original=core.store.open
def capture(key):
    source=original(key);opened.append(source);return source
core.store.path(video_key).unlink()
with patch.object(core.store,'open',capture):assert a.get(prepared['url']).status_code==404
assert opened and all(source.closed for source in opened)
# Streaming does not read an entire file at once and closes on cancellation.
class Measured(io.BytesIO):
    def read(self,n=-1):
        assert 0 < n <= 256*1024
        return super().read(n)
source=Measured(b'x'*(1024*1024));resources=ExitStack();resources.enter_context(closing(source))
generator=library_api.zip_stream([{'name':'测试.png','size':1024*1024}],[source],resources)
next(generator);next(generator);generator.close();assert source.closed
# Disconnect before the first streamed chunk still releases all source handles.
import asyncio
source=Measured(b'x');resources=ExitStack();resources.enter_context(closing(source))
response=library_api.ArchiveResponse(iter([b'x']),resources,media_type='application/zip')
async def reject(message):raise OSError('client disconnected')
async def receive():return {'type':'http.disconnect'}
try:asyncio.run(response({'type':'http','method':'GET','asgi':{'spec_version':'2.4'}},receive,reject))
except Exception:pass
assert source.closed
assert not list(core.stage_dir.iterdir())
print('PASS ZIP CRC/content, mixed files, auth and ticket ownership, expiry, canonical deduplication, unavailable files, bounded reads and cancellation cleanup')
