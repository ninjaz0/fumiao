"""Pinned original chat transport/title/context oracle. Temporary SQLite and fake HTTP only."""
import asyncio, base64, gzip, json, math, os, sys, zlib
from pathlib import Path
from unittest.mock import patch
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import chat_runtime as runtime, chat_api, httpx
from fastapi import HTTPException
original=httpx.AsyncClient
cases=[]
models=['deepseek-flash','gpt-4.1']
messages=[{'role':'system','content':'规则'}, {'role':'user','content':'测试😀'}]
def normalize(v):
    if type(v) is float and not math.isfinite(v):return {'$number':'NaN' if math.isnan(v) else 'Infinity' if v>0 else '-Infinity'}
    if type(v) is int and abs(v)>9007199254740991:return {'$integer':str(v)}
    if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
    if isinstance(v,list):return [normalize(x) for x in v]
    return v
def raw(wire):
    if 'hex' in wire:return bytes.fromhex(wire['hex'])
    return wire.get('raw','{}').encode('utf-8')
class Stream(httpx.AsyncByteStream):
    def __init__(self,wire):self.wire=wire
    async def __aiter__(self):
        w=self.wire
        if w.get('hang'):raise httpx.ReadTimeout('fixture')
        value=raw(w)
        if 'chunks' in w:
            for n in w['chunks']:
                yield value[:n];value=value[n:]
        if value:yield value
        if w.get('interrupt'):raise httpx.ReadError('fixture')
async def scenario(name,kind='stream',model='deepseek-flash',**spec):
    wire=spec.get('wire',{});requests=[]
    def handle(req):
        requests.append(dict(method=req.method,path=req.url.path,authorization=req.headers['authorization'],acceptEncoding=req.headers.get('accept-encoding'),body=json.loads(req.content) if req.content else None))
        if wire.get('disconnect'):raise httpx.ConnectError('private-fixture')
        return httpx.Response(wire.get('status',200),headers={'content-type':wire.get('type','text/event-stream' if kind=='stream' else 'application/json'),'x-request-id':wire.get('requestId','fixture-request'),**wire.get('headers',{})},stream=Stream(wire))
    result={}
    with patch.object(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handle),**kw)),patch.object(runtime,'key',lambda _: 'sk-local-chat-fixture'),patch.object(chat_api,'admin',lambda _:None):
        try:
            if kind=='stream':
                result['chunks']=[]
                async for item in runtime.provider_stream(model,messages):result['chunks'].append(item)
            elif kind=='title':result['title']=await runtime.provider_title(model,spec.get('question','首轮问题😀'),spec.get('answer','首轮回答😀'))
            elif kind=='probe':result['probe']=await chat_api.test_provider(runtime.CHAT_MODELS[model]['provider'],None)
        except Exception as error:
            result['error']={'kind':'reply','message':str(error)} if isinstance(error,RuntimeError) else {'kind':'probe','message':error.detail} if isinstance(error,HTTPException) else {'kind':'generic'}
    cases.append(dict(name=name,kind=kind,model=model,**spec,expected=normalize(result),requests=requests))
def event(value):return 'data: '+json.dumps(value,ensure_ascii=False)+'\n\n'
async def main():
    complete=event({'choices':[{'delta':{'reasoning_content':'PRIVATE_REASONING','content':'你好😀'},'finish_reason':None}]})+event({'choices':[{'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':2,'completion_tokens':3,'total_tokens':5,'secret':'hidden'}})+'data: [DONE]\n\n'
    for model in models:
        await scenario('complete-'+model,model=model,wire={'raw':complete})
        await scenario('chunked-'+model,model=model,wire={'raw':complete,'chunks':[1]*250})
        for status in [201,204,301,302,307,400,401,403,404,429,500]:await scenario('status-'+model+'-'+str(status),model=model,wire={'status':status,'headers':{'location':'/must-not-follow'},'raw':'private response'})
    values=[{},[],None,True,1,'text',{'error':{}},{'error':[]},{'error':False},{'error':True},{'choices':[]},{'choices':{}},{'choices':''},{'choices':True},{'choices':'x'},{'choices':[None]},{'choices':[[]]},{'choices':[{}]},{'choices':[{'delta':[]} ]},{'choices':[{'delta':True}]},{'usage':[]},{'usage':None},{'usage':[{}]},{'usage':'x'},{'choices':[{'delta':{'reasoning_content':'PRIVATE_REASONING'}}]}]
    for value in [None,False,0,'',[],{},True,1,['text'],{'x':'y'},'正常😀']:
        values.append({'choices':[{'delta':{'content':value},'finish_reason':value}]})
    for i,v in enumerate(values):await scenario('shape-'+str(i),wire={'raw':event(v)})
    wires=['',': keepalive\n\n','event: ping\ndata: {}\n\n',' data: invalid\n','Data: invalid\n','data: [DONE]\ndata: invalid\n','data:\n','data: invalid\n','data: {"choices":\n','data: NaN\n','data: {"error":NaN}\n','data: \ufeff{}\n','\ufeffdata: {}\n','data: {}\ndata: invalid\n', 'data: {"usage":{"prompt_tokens":1.0,"completion_tokens":2e0,"total_tokens":3,"prompt_cache_hit_tokens":true,"prompt_cache_miss_tokens":-2}}\n','data: {"usage":{"prompt_tokens":1,"prompt_tokens":2.0,"total_tokens":9007199254740993}}\n','data: {"usage":{"prompt_tokens":NaN,"total_tokens":Infinity,"completion_tokens":-Infinity,"prompt_cache_hit_tokens":-0}}\n','data: {"usage":{"prompt_tokens":1e999,"total_tokens":1e-999}}\n','data: {"usage":{"prompt_tokens":'+('1'*4301)+'}}\n']
    for i,v in enumerate(wires):await scenario('wire-'+str(i),wire={'raw':v})
    for separator in ['\n','\r','\r\n','\v','\f','\x1c','\x1d','\x1e','\x85','\u2028','\u2029']:
        await scenario('separator-'+separator.encode().hex(),wire={'raw':'data: {}'+separator+'data: [DONE]'+separator,'chunks':[1]*100})
    for enc in ['utf-8','utf-8-sig','utf-16','utf-16-le','utf-16-be','utf-32','utf-32-le','utf-32-be','iso-8859-1','latin_1','ascii','invalid-charset']:
        b=('data: '+json.dumps({'choices':[{'delta':{'content':'café' if enc!='ascii' else 'cafe'}}]},ensure_ascii=False)+'\n').encode(enc if enc!='invalid-charset' else 'utf-8')
        await scenario('charset-'+enc,wire={'hex':b.hex(),'type':'text/event-stream; charset='+enc,'chunks':[1]*20})
    for codec,compress in [('gzip',gzip.compress),('deflate',zlib.compress),('deflate-raw',lambda b:zlib.compress(b,wbits=-15))]:
        value=compress(complete.encode());coding=codec.split('-')[0]
        await scenario('compression-'+codec,wire={'hex':value.hex(),'headers':{'content-encoding':coding}})
    for size in [1024*1024,1024*1024+1]:
        await scenario('long-comment-'+str(size),wire={'raw':':'+('x'*(size-1))+'\n'})
    await scenario('long-unicode',wire={'raw':':'+('😀'*(1024*1024))+'\n'})
    await scenario('long-incomplete-disconnect',wire={'raw':'x'*(1024*1024+1),'interrupt':True})
    for field in ['disconnect','interrupt','hang']:await scenario(field,wire={field:True,'raw':'data: {}\n'})
    await scenario('header-limit',wire={'raw':'data: [DONE]\n','requestId':'x'*250})
    title=lambda v:dict(choices=[dict(finish_reason='stop',message={'content':v})])
    titles=['标题：“林间镜头设计”',' TiTLE : ## An   exact\ttitle ## ','TİTLE：正文','tıtle:正文','标题：\x1c“文本”','\ufeff标题：保留BOM','标题：中文'+'😀'*45,'','\x00bad','a\x7fb','`###`',None,True,{},[],42]
    for i,t in enumerate(titles):await scenario('title-'+str(i),kind='title',wire={'raw':json.dumps(title(t),ensure_ascii=False)})
    for i,v in enumerate([{},[],None,{'choices':[]},{'choices':{}},{'choices':True},{'choices':[None]},{'choices':[{'finish_reason':'length','message':{'content':'bad'}}]},{'choices':[{'finish_reason':'stop','message':None}]},{'choices':[{'finish_reason':'stop'}]}]):await scenario('title-shape-'+str(i),kind='title',wire={'raw':json.dumps(v)})
    for model in models:await scenario('title-payload-'+model,kind='title',model=model,question='😀'*4100+'\u2028\u0001',answer='答复\n"'*1500,wire={'raw':json.dumps(title('主题'))})
    for status in [201,204,302,401,500]:await scenario('title-status-'+str(status),kind='title',wire={'status':status,'raw':'' if status==204 else json.dumps(title('标题'))})
    for model in models:
        await scenario('probe-ok-'+model,kind='probe',model=model,wire={'raw':json.dumps({'data':[{'id':model}]})})
        await scenario('probe-wrong-model-'+model,kind='probe',model=model,wire={'raw':'{"data":[{"id":"unknown"}]}'})
    probe=[{},[],None,{'data':[]},{'data':{}},{'data':''},{'data':None},{'data':True},{'data':[None]},{'data':['id']},{'data':[{}]},{'data':[{'id':None}]},{'data':[{'id':1}]},{'data':[{'id':[]}]},{'data':[{'id':{}}]}]
    for i,v in enumerate(probe):await scenario('probe-shape-'+str(i),kind='probe',wire={'raw':json.dumps(v)})
    for status in [201,204,301,302,307,401,429,500]:await scenario('probe-status-'+str(status),kind='probe',wire={'status':status,'raw':'{"data":[{"id":"deepseek-flash"}]}','headers':{'location':'/must-not-follow'}})
    for field in ['disconnect','interrupt','hang']:await scenario('probe-'+field,kind='probe',wire={field:True,'raw':'{}'})
    for v in ['invalid','NaN','\ufeff{"data":[{"id":"deepseek-flash"}]}']:
        await scenario('probe-json-'+str(len(cases)),kind='probe',wire={'raw':v})
asyncio.run(main())
contexts=[]
class Rows:
    def __init__(self,rows):self.rows=rows
    def execute(self,*args):return self
    def fetchall(self):return self.rows
def row(role='user',content='消息',state='complete',context=None):return dict(role=role,content=content,state=state,context=json.dumps(context if context is not None else {},ensure_ascii=False))
def context(name,rows):
    try:expected={'messages':runtime.context_messages(Rows(rows),{'conversation':'fixture','user_message':999})}
    except Exception:expected={'error':{'kind':'generic'}}
    contexts.append(dict(name=name,rows=rows,expected=expected))
context('empty',[])
context('system',[row()])
context('writeback',[row(context={'text':'原始文本😀','writeback':True})])
context('failed-history',[row(),row('assistant','弃用片段','failed'),row(content='重试')])
context('complete-history',[row(),row('assistant','完整回答'),row(content='继续')])
context('twenty-groups',sum(([row(content=str(i)),row('assistant','回复')] for i in range(25)),[])+[row(content='当前')])
context('unicode-budget',[row(content='😀'*20000),row('assistant','😀'*20000),row(content='😀'*10000)])
context('over-budget',[row(content='a'*25000),row('assistant','b'*25000),row(content='当前')])
context('budget-before-incomplete-skip',[row(),row('assistant','保留？'),row(content='x'*50001),row('assistant','失败','failed'),row(content='当前')])
context('latest-oversize',[row(content='😀'*50001)])
context('malformed-multiple-assistants',[row(),row('assistant'),row('assistant'),row(content='当前')])
context('initial-assistant',[row('assistant','无用户'),row()])
for value in [None,False,0,'',[],{},True,1,['x'],{'text':1}]:
    context('context-text-'+str(len(contexts)),[row(context={'text':value,'writeback':value})])
for raw in ['null','[]','false','NaN','invalid','\ufeff{}','{"writeback":NaN}','{"text":NaN}']:
    context('context-json-'+str(len(contexts)),[dict(row(),context=raw)])
(out/'manifest.json').write_text(json.dumps(dict(messages=messages,cases=cases,contexts=contexts),ensure_ascii=True))
print(json.dumps(dict(scenarios=len(cases),contexts=len(contexts))))
