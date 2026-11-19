"""Original chat settings HTTP oracle, with a private temporary key file and fake HTTP."""
import json, os, sys
from pathlib import Path
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
for name in ['DEEPSEEK_API_KEY','OPENAI_CHAT_API_KEY']:os.environ.pop(name,None)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,chat_runtime as runtime,image_api,model_policy,credits
from server import app
clients=[]
for role,name in [('admin','admin'),('member','member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    client=TestClient(app,raise_server_exceptions=False)
    r=client.post('/api/register',json=dict(name=name,nickname=name,password='chat-settings-fixture',code=code));assert r.status_code==200,r.text
    clients.append(client)
clients.append(TestClient(app,raise_server_exceptions=False))
with core.db() as con:initial=model_policy.read(con);pricing=credits.prices(con)
original=httpx.AsyncClient
cases=[];current={};requests=[]
image_api.api_key=lambda:current.get('fallback','')
def handler(req):
    requests.append(dict(method=req.method,path=req.url.path,authorization=req.headers['authorization'],acceptEncoding=req.headers.get('accept-encoding'),body=json.loads(req.content) if req.content else None))
    wire=current.get('wire',{})
    if wire.get('disconnect'):raise httpx.ConnectError('fixture')
    return httpx.Response(wire.get('status',200),content=wire.get('raw','{"data":[{"id":"deepseek-flash"},{"id":"gpt-4.1"}]}').encode(),headers={'content-type':'application/json'})
def scenario(name,**spec):
    global current
    current=spec;requests.clear();(core.DATA/'chat.env').unlink(missing_ok=True)
    for provider,key in spec.get('keys',{}).items():runtime.save_key(provider,key)
    flags={**initial['enabled'],**spec.get('flags',{})}
    with core.db(True) as con:
        con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps({**initial,'enabled':flags}),))
        con.execute('UPDATE credit_accounts SET balance=23,reserved=3')
    headers={'content-type':spec.get('type','application/json'),'origin':spec.get('origin','http://localhost:3000')}
    raw=bytes.fromhex(spec['hex']) if 'hex' in spec else spec['raw'].encode() if 'raw' in spec else json.dumps(spec['body']).encode() if 'body' in spec else None
    path=spec.get('path','/api/admin/chat/deepseek');method=spec.get('method','PUT')
    with patch.object(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw)):
        r=clients[spec.get('actor',0)].request(method,path,content=raw,headers=headers)
    try:body=r.json()
    except ValueError:body=r.text
    if isinstance(body,dict) and 'credits' in body:body['credits']['workspace']='fixture-workspace'
    configured={p:bool(runtime.key(p)) for p in runtime.PROVIDERS}
    with core.db() as con:policy=model_policy.read(con)
    cases.append(dict({'name':name,**spec,'method':method,'path':path},expected=dict(status=r.status_code,body=body,contentType=r.headers.get('content-type'),allow=r.headers.get('allow')),requests=list(requests),configured=configured,policy=policy))
key='sk-abcdefghijklmnop'
for i,body in enumerate([None,[],False,1,'text',{}, {'key':None},{'key':1},{'key':True},{'key':[]},{'key':'sk-short'},{'key':key+'\n'},{'key':' '+key},{'key':key+' '},{'key':key,'extra':True},{'key':'sk-'+('x'*512)},{'key':'sk-'+('x'*513)},{'key':'sk-'+('x'*15)},{'key':'sk-12345678_-abcdef'}, {'key':key}]):scenario('key-body-'+str(i),body=body)
for raw in ['', 'invalid','{"key":','NaN','\ufeff'+json.dumps({'key':key}),'{"key":"bad","key":"'+key+'"}']:scenario('key-json-'+str(len(cases)),raw=raw)
scenario('utf16-body',hex=json.dumps({'key':key}).encode('utf-16').hex())
scenario('text-content-type',body={'key':key},type='text/plain')
for actor in [1,2]:
    scenario('actor-invalid-'+str(actor),actor=actor,raw='invalid')
    scenario('actor-valid-'+str(actor),actor=actor,body={'key':key})
    scenario('actor-read-'+str(actor),actor=actor,path='/api/admin/chat',method='GET')
    scenario('actor-probe-'+str(actor),actor=actor,path='/api/admin/chat/deepseek/test',method='POST',raw='invalid')
scenario('csrf',body={'key':key},origin='https://foreign.example')
scenario('unknown-invalid',path='/api/admin/chat/unknown',body={})
scenario('unknown-valid',path='/api/admin/chat/unknown',body={'key':key})
scenario('unknown-probe',path='/api/admin/chat/unknown/test',method='POST')
for method,path in [('POST','/api/chat/config'),('POST','/api/admin/chat'),('GET','/api/admin/chat/deepseek'),('PUT','/api/admin/chat/deepseek/test'),('HEAD','/api/admin/chat')]:scenario('method-'+str(len(cases)),method=method,path=path,raw='invalid')
for keys,fallback in [({},''),({'deepseek':key},''),({'openai':key},''),({},key),({'openai':' \u3000'},key),({'deepseek':'legacy-key','openai':key},'')]:
    scenario('read-'+str(len(cases)),method='GET',path='/api/admin/chat',keys=keys,fallback=fallback)
    scenario('config-'+str(len(cases)),method='GET',path='/api/chat/config',keys=keys,fallback=fallback)
scenario('config-member',method='GET',path='/api/chat/config',actor=1,keys={'deepseek':key})
scenario('config-anonymous',method='GET',path='/api/chat/config',actor=2)
scenario('config-disabled',method='GET',path='/api/chat/config',keys={'deepseek':key,'openai':key},flags={'deepseek-flash':False})
for provider in ['deepseek','openai']:
    scenario('probe-unconfigured-'+provider,method='POST',path='/api/admin/chat/'+provider+'/test')
    scenario('probe-'+provider,method='POST',path='/api/admin/chat/'+provider+'/test',keys={provider:key},raw='invalid')
scenario('probe-fallback',method='POST',path='/api/admin/chat/openai/test',fallback=key)
for raw in ['{}','[]','null','NaN','invalid','{"data":[]}','{"data":[{"id":"unknown"}]}','{"data":[{}]}','{"data":{}}','{"data":[{"id":[]}]}']:
    scenario('probe-wire-'+str(len(cases)),method='POST',path='/api/admin/chat/deepseek/test',keys={'deepseek':key},wire={'raw':raw})
for status in [201,301,401,429,500]:scenario('probe-status-'+str(status),method='POST',path='/api/admin/chat/deepseek/test',keys={'deepseek':key},wire={'status':status})
scenario('probe-disconnect',method='POST',path='/api/admin/chat/deepseek/test',keys={'deepseek':key},wire={'disconnect':True})
(out/'manifest.json').write_text(json.dumps(dict(initial=initial,pricing=pricing,cases=cases),ensure_ascii=True))
print(json.dumps(dict(scenarios=len(cases))))
