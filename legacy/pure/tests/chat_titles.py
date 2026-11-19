"""First-exchange model titles, metadata races and unchanged billing; no live API."""
import asyncio,json,os,sys,tempfile,threading,time,uuid
from pathlib import Path
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',DEEPSEEK_API_KEY='sk-test-not-real')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,chat_runtime as runtime,credits
from server import app

def ok(r):assert r.is_success,(r.status_code,r.text[:300]);return r.json()
def wait(fn):
 for _ in range(150):
  value=fn()
  if value:return value
  time.sleep(.02)
 raise AssertionError('condition not reached')
async def reply(model,messages):
 yield {'text':'女孩站在林间，镜头缓缓推近。'};yield {'reason':'stop'}
async def title(model,question,answer):
 calls.append((model,question,answer));return '林间情绪镜头'
calls=[]
with TestClient(app) as client,patch.object(runtime,'provider_stream',reply),patch.object(runtime,'provider_title',title):
 code=core.token()
 with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,'admin',core.now()+60))
 ok(client.post('/api/register',json={'nickname':'测试','name':'title-test','password':'title-test-password','code':code}))
 with core.db(True) as con:con.execute('UPDATE credit_accounts SET balance=50')
 def new():return ok(client.post('/api/chats',json={}))['conversation']['id']
 def get(cid):return ok(client.get('/api/chats/'+cid))
 def send(cid,text):
  state=get(cid);config=ok(client.get('/api/chat/config'))
  return ok(client.post('/api/chats/'+cid+'/messages',json={'uid':str(uuid.uuid4()),'model':'deepseek-flash','text':text,'expected_revision':state['conversation']['revision'],'price_revision':config['pricing']['revision']}))
 def done(cid):return wait(lambda:not get(cid)['conversation']['active_turn'] and not runtime.TASKS)
 cid=new();send(cid,'把小女孩哭泣改成视频提示词');done(cid)
 assert get(cid)['conversation']['title']=='林间情绪镜头' and len(calls)==1
 assert calls[0][1]=='把小女孩哭泣改成视频提示词' and calls[0][2].startswith('女孩站在林间')
 send(cid,'再简洁一些');done(cid);assert len(calls)==1
 state=get(cid);ok(client.patch('/api/chats/'+cid,json={'title':'手动命名','expected_revision':state['conversation']['revision']}));assert get(cid)['conversation']['title']=='手动命名'
 # An automatic result arriving after a manual rename cannot overwrite it.
 entered=threading.Event();release=threading.Event()
 async def delayed(model,question,answer):
  entered.set()
  while not release.is_set():await asyncio.sleep(.01)
  return '迟到的自动标题'
 with patch.object(runtime,'provider_title',delayed):
  race=new();send(race,'生成一个标题');wait(entered.is_set)
  state=get(race);ok(client.patch('/api/chats/'+race,json={'title':'我自己起的名字','expected_revision':state['conversation']['revision']}));release.set();done(race)
  assert get(race)['conversation']['title']=='我自己起的名字'
 async def broken(*args):raise RuntimeError('upstream naming unavailable')
 with patch.object(runtime,'provider_title',broken):
  fallback=new();send(fallback,'保留这个首条消息作为临时标题');done(fallback)
  assert get(fallback)['messages'][-1]['state']=='complete'
  assert get(fallback)['conversation']['title']=='保留这个首条消息作为临时标题'
 # A pre-named new conversation never makes the title request.
 named=new();state=get(named);ok(client.patch('/api/chats/'+named,json={'title':'事先命名','expected_revision':state['conversation']['revision']}));send(named,'你好');done(named);assert len(calls)==1
 with core.db() as con:
  assert con.execute("SELECT balance FROM credit_accounts WHERE workspace=(SELECT workspace FROM conversations WHERE id=?)",(cid,)).fetchone()[0]==45
  assert con.execute('SELECT count(*) FROM credit_chat_charges').fetchone()[0]==5
original=httpx.AsyncClient
async def wire(model):
 def handler(request):
  body=json.loads(request.content)
  assert body['stream'] is False and body['max_tokens']==64
  assert body['model']==model and body['messages'][0]['content']==runtime.TITLE_SYSTEM
  assert '首轮问题' in body['messages'][1]['content'] and '首轮回答' in body['messages'][1]['content']
  assert request.url.host==('api.deepseek.com' if model=='deepseek-flash' else 'api.openai.com')
  return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'标题：“林间镜头设计”'}}]})
 with patch.object(httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs)):
  assert await runtime.provider_title(model,'首轮问题','首轮回答')=='林间镜头设计'
asyncio.run(wire('deepseek-flash'));asyncio.run(wire('gpt-4.1'))
print('PASS first-exchange titles, no later retitling, manual rename races, naming failure fallback, unchanged five-reply billing, DeepSeek/OpenAI bounded title payloads')
