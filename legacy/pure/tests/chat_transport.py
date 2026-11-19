"""Official SSE wire formats and secret boundaries without real provider requests."""
import asyncio,json,os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,DEEPSEEK_API_KEY='sk-transport-test',OPENAI_CHAT_API_KEY='sk-openai-test')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,chat_runtime as runtime,httpx
original=httpx.AsyncClient
async def check(model):
 def handle(request):
  payload=json.loads(request.content)
  assert payload['stream'] and payload['max_tokens']==4096 and payload['stream_options']['include_usage']
  assert payload.get('thinking')==({'type':'disabled'} if model=='deepseek-flash' else None)
  assert request.url.host==('api.deepseek.com' if model=='deepseek-flash' else 'api.openai.com')
  content='data: '+json.dumps({'choices':[{'delta':{'reasoning_content':'PRIVATE_REASONING','content':'你好'},'finish_reason':None}]})+'\n\n'
  content+='data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':12,'completion_tokens':2,'total_tokens':14,'internal_secret':'do not persist'}})+'\n\n'
  content+='data: [DONE]\n\n'
  return httpx.Response(200,text=content,headers={'content-type':'text/event-stream','x-request-id':'test-request'})
 with patch.object(httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handle),**kwargs)):
  result=[row async for row in runtime.provider_stream(model,[{'role':'user','content':'测试'}])]
 assert ''.join(r.get('text','') for r in result)=='你好'
 assert any(r.get('reason')=='stop' for r in result)
 assert 'PRIVATE_REASONING' not in str(result) and 'internal_secret' not in str(result)
 assert any(r.get('usage',{}).get('total_tokens')==14 for r in result)
asyncio.run(check('deepseek-flash'));asyncio.run(check('gpt-4.1'))
print('PASS DeepSeek and OpenAI request routing, bounded non-thinking SSE, usage parsing, hidden reasoning and secret exclusion')
