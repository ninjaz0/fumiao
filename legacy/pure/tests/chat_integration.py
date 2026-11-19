"""Isolated chat lifecycle, authorization, credits and canvas acceptance; no external calls."""
import asyncio,os,sys,tempfile,uuid,json
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',DEEPSEEK_API_KEY='sk-test-not-real')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,chat_runtime as runtime,chat_storage,credits,model_policy
from server import app

async def fake_title(model,question,answer):return '林间日落文案'
runtime.provider_title=fake_title

def ok(r):assert r.is_success,(r.status_code,r.text[:400]);return r.json()
def user(client,name,role):
 code=core.token()
 with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+60))
 return ok(client.post('/api/register',json={'nickname':name,'name':name,'password':'chat-test-password','code':code}))

async def fake(model,messages):
 assert model=='deepseek-flash'
 for text in ['日落时分，','海风掠过树梢。']:
  yield {'text':text};await asyncio.sleep(.03)
 yield {'reason':'stop','usage':{'total_tokens':25}}
async def slow(model,messages):
 yield {'text':'未完成的草稿'};await asyncio.sleep(30)

def wait(c,cid):
 import time
 for _ in range(100):
  data=ok(c.get('/api/chats/'+cid))
  if not data['conversation']['active_turn']:return data
  time.sleep(.03)
 raise AssertionError('chat stuck')

def send(c,cid,text='写一句中文',**extra):
 data=ok(c.get('/api/chats/'+cid));cfg=ok(c.get('/api/chat/config'))
 body={'uid':str(uuid.uuid4()),'model':'deepseek-flash','text':text,'expected_revision':data['conversation']['revision'],'price_revision':cfg['pricing']['revision']}|extra
 return c.post('/api/chats/'+cid+'/messages',json=body),body

with TestClient(app) as a, TestClient(app) as b, TestClient(app) as stranger:
 user(a,'admin','admin');user(b,'member','member');user(stranger,'stranger','member')
 with core.db(True) as con:
  con.execute('UPDATE credit_accounts SET balance=50');wid=con.execute("INSERT INTO workspaces(kind,name,created) VALUES('team','chat-team',?)",(core.now(),)).lastrowid
  con.execute('INSERT INTO workspace_members VALUES(?,2)',(wid,));con.execute('UPDATE credit_accounts SET balance=50')
 own=ok(b.post('/api/chats',json={}))['conversation']['id']
 assert a.get('/api/chats/'+own).status_code==404 # Admin cannot enter another person's personal space.
 for c in (a,b,stranger):c.headers['X-Workspace-Id']=str(wid)
 assert stranger.get('/api/chats').status_code==403
 cid=ok(b.post('/api/chats',json={}))['conversation']['id'];assert ok(a.get('/api/chats/'+cid))
 with patch.object(runtime,'provider_stream',fake):
  r,body=send(b,cid);ok(r);data=wait(b,cid);assert data['messages'][-1]['content']=='日落时分，海风掠过树梢。'
  ok(b.post('/api/chats/'+cid+'/messages',json=body))
  with core.db() as con:
   assert credits.wallet(con,wid)['balance']==49 and credits.wallet(con,wid)['reserved']==0
   assert con.execute('SELECT count(*) FROM chat_turns').fetchone()[0]==1
  assert b.post('/api/chats/'+cid+'/messages',json=body|{'uid':str(uuid.uuid4())}).status_code==409
  r,_=send(a,cid,'继续');ok(r);wait(a,cid)
 with patch.object(runtime,'provider_stream',slow):
  r,body=send(b,cid);ok(r)
  assert send(a,cid)[0].status_code==409
  ok(a.post('/api/chats/'+cid+'/stop',json={}))
  data=wait(a,cid);assert data['messages'][-1]['state']=='stopped'
  with core.db() as con:assert credits.wallet(con,wid)['balance']==48 and credits.wallet(con,wid)['reserved']==0
 with patch.object(runtime,'provider_stream',fake):
  r,_=send(b,cid,'',retry=data['messages'][-1]['id']);ok(r);data=wait(b,cid)
  assert len(data['messages'])==6 and data['messages'][-1]['state']=='complete'
 p=ok(b.post('/api/canvases',json={'title':'写作测试'}));pid=p['id']
 body={'uid':str(uuid.uuid4()),'message':data['messages'][-1]['id'],'project':pid,'expected_revision':1,'mode':'new'}
 adopted=ok(b.post('/api/chats/'+cid+'/apply',json=body));nid=adopted['applied_node']
 assert adopted['document']['nodes'][0]['text']==data['messages'][-1]['content']
 assert ok(b.post('/api/chats/'+cid+'/apply',json=body))['revision']==2
 assert b.post('/api/chats/'+cid+'/apply',json=body|{'uid':str(uuid.uuid4())}).status_code==409
 assert b.post('/api/chats/'+cid+'/apply',json=body|{'uid':str(uuid.uuid4()),'expected_revision':2,'mode':'replace','node':nid,'expected_text':'outdated'}).status_code==409
 with core.db() as con:assert credits.wallet(con,wid)['balance']==47
 with patch.object(runtime,'provider_stream',fake):
  r,_=send(b,cid,'简化这段文字',context={'project':pid,'node':nid,'expected_revision':2,'writeback':True});ok(r);wait(b,cid)
 with core.db() as con:
  turn=con.execute('SELECT * FROM chat_turns ORDER BY created DESC LIMIT 1').fetchone()
  assert '<canvas_text>' in runtime.context_messages(con,turn)[-1]['content']
  assert runtime.context_messages(con,turn)[0]['content']==runtime.CANVAS_EDIT
 current=ok(b.get('/api/chats/'+cid));answer=current['messages'][-1]
 source=next(m for m in current['messages'] if m['id']==answer['reply_to'])
 assert json.loads(source['context'])['writeback'] is True
 write={'uid':str(uuid.uuid4()),'message':answer['id'],'project':pid,'expected_revision':2,'mode':'replace','node':nid,'expected_text':json.loads(source['context'])['text']}
 result=ok(b.post('/api/chats/'+cid+'/apply',json=write));assert result['revision']==3
 assert ok(b.post('/api/chats/'+cid+'/apply',json=write))['revision']==3
 with core.db() as con:assert credits.wallet(con,wid)['balance']==46

 # Workspace model switch applies before any reservation.
 with core.db(True) as con:model_policy.save_team(con,wid,'deepseek-flash',False,0)
 assert send(b,cid)[0].status_code==403
 assert 'deepseek-flash' not in ok(b.get('/api/chat/config'))['models']
 with core.db(True) as con:model_policy.save_team(con,wid,'deepseek-flash',True,1)
 # Partial/empty stream refunds, preserving failed text.
 async def partial(model,messages):yield {'text':'partial'}
 with patch.object(runtime,'provider_stream',partial):
  r,_=send(b,cid);ok(r);assert wait(b,cid)['messages'][-1]['state']=='failed'
 # Restart recovery is idempotent.
 with patch.object(runtime,'start',lambda _:None):r,_=send(b,cid);ok(r)
 runtime.recover();runtime.recover()
 assert ok(b.get('/api/chats/'+cid))['messages'][-1]['state']=='interrupted'
 with core.db() as con:assert credits.wallet(con,wid)['balance']==46 and credits.wallet(con,wid)['reserved']==0
 ok(b.delete('/api/chats/'+cid));assert a.get('/api/chats/'+cid).status_code==404
 ok(b.post('/api/chats/'+cid+'/restore',json={}))
 assert ok(a.get('/api/chats/'+cid))
 assert b.get('/api/admin/chat').status_code==403
 assert 'sk-test' not in a.get('/api/admin/chat').text
 # In-place migration twice doesn't reset flags, prices or balances.
 core.init_db();core.init_db()
 with core.db() as con:assert credits.wallet(con,wid)['balance']==46
 print('PASS: workspace privacy, shared continuation, completed billing, idempotency, concurrent turn guard, stop/refund, retry, incomplete/refund, crash recovery, canvas revision/text protection, free adoption, model policy, secret isolation and repeat migration')
