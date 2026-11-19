"""Original HTTP image settings/probe oracle, isolated data and fake provider I/O."""
import io, json, os, sys, urllib.error, urllib.request
from pathlib import Path
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,image_api as images,model_policy
from server import app
clients=[]
for role,name in [('admin','admin'),('member','member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    client=TestClient(app,raise_server_exceptions=False)
    result=client.post('/api/register',json=dict(name=name,nickname=name,password='image-settings-fixture',code=code));assert result.status_code==200,result.text
    clients.append(client)
clients.append(TestClient(app,raise_server_exceptions=False))
with core.db() as con:initial=model_policy.read(con)
current={};requests=[];cases=[]
images.api_key=lambda:'sk-local-fixture' if current.get('configured',True) else ''
def urlopen(req,timeout):
    requests.append(dict(path=req.selector,method=req.get_method(),authorization=req.headers.get('Authorization'),body=req.headers.get('Content-length')))
    wire=current.get('wire',{})
    if wire.get('disconnect'):raise OSError('private-sentinel')
    raw=b'x'*wire['repeat'] if 'repeat' in wire else bytes.fromhex(wire['hex']) if 'hex' in wire else wire.get('raw','{}').encode()
    if wire.get('status',200)>=300:raise urllib.error.HTTPError(req.full_url,wire['status'],'fixture',{},io.BytesIO(raw))
    response=io.BytesIO(raw);response.headers={};return response
urllib.request.urlopen=urlopen
def scenario(name,**c):
    global current
    current=c;requests.clear()
    with core.db(True) as con:
        con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(initial),))
        con.execute("INSERT INTO settings VALUES('openai_images',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps({'enabled':True,'default_model':images.DEFAULT_MODEL}),))
        con.execute("INSERT INTO settings VALUES('hidden_model_ids',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(c.get('hidden',[])),))
    path=c.get('path','/api/settings/openai/check' if c.get('probe') else '/api/settings/openai')
    method=c.get('method','POST' if c.get('probe') else 'PUT')
    headers={'origin':c.get('origin','http://localhost:3000'),'content-type':'application/json'}
    response=clients[c.get('actor',0)].request(method,path,content=json.dumps(c['body']) if 'body' in c else None,headers=headers)
    try:body=response.json()
    except ValueError:body=response.text
    with core.db() as con:policy=model_policy.read(con);enabled=images.configuration(con)['enabled']
    cases.append(dict({'name':name,**c,'method':method,'path':path},expected=dict(status=response.status_code,body=body,contentType=response.headers.get('content-type'),allow=response.headers.get('allow')),policy=policy,enabled=enabled,requests=list(requests)))
valid={'enabled':True,'default_model':images.DEFAULT_MODEL}
for value in [None,[],True,{}, {'enabled':True},{'default_model':images.DEFAULT_MODEL},dict(valid,default_model='wrong'),dict(valid,enabled='false'),dict(valid,enabled=0),dict(valid,enabled=1),dict(valid,enabled='yes'),dict(valid,enabled='TRUE'),dict(valid,enabled='maybe'),dict(valid,enabled=None),dict(valid,enabled=[]),dict(valid,enabled=2),dict(valid,extra='ignored'),dict(valid,enabled=False),valid]:scenario('body-'+str(len(cases)),body=value)
scenario('missing-body')
for actor in [1,2]:
    scenario('unauthorized-'+str(actor),actor=actor,body=valid)
    scenario('validate-before-auth-'+str(actor),actor=actor,body={})
    scenario('probe-unauthorized-'+str(actor),actor=actor,probe=True)
scenario('csrf',body=valid,origin='https://foreign.example')
scenario('probe-csrf',probe=True,origin='https://foreign.example')
scenario('wrong-method',method='POST',body=valid)
scenario('probe-wrong-method',probe=True,method='PUT',body={})
scenario('hidden-model',hidden=['muse-image'],body=valid)
scenario('all-hidden',hidden=['muse-image',images.DEFAULT_MODEL],body=valid)
scenario('unconfigured-save',configured=False,body=valid)
scenario('unconfigured-probe',configured=False,probe=True)
for value in [{},[],None,True,0,'text']:scenario('probe-json-'+str(len(cases)),probe=True,wire={'raw':json.dumps(value)})
for raw in ['NaN','Infinity','-Infinity','invalid','{"x":','\ufeff{}']:scenario('probe-wire-'+str(len(cases)),probe=True,wire={'raw':raw})
for status in [400,401,403,404,429,500]:
    for error in [{},{'code':'insufficient_quota'},{'message':'verify safety'},{'message':'SAFETY'},None,[]]:scenario('probe-error-'+str(len(cases)),probe=True,wire={'status':status,'raw':json.dumps({'error':error})})
scenario('probe-disconnect',probe=True,wire={'disconnect':True})
scenario('probe-oversize',probe=True,wire={'repeat':64*1024**2+1})
(out/'manifest.json').write_text(json.dumps(dict(initial=initial,cases=cases),ensure_ascii=False))
print(json.dumps(dict(scenarios=len(cases))))
