"""Pinned Flow queue/stream oracle: private SQLite, fake HTTP and synthetic output."""
import base64, html, io, json, os, sys, urllib.error, urllib.request, uuid
from pathlib import Path
out=Path(sys.argv[1]); out.mkdir(parents=True,exist_ok=True)
os.environ['FUMIAO_DATA']=str(out/'runtime')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core, credits, timing, flow_provider as flow, muse_provider
core.init_db()
flow.ready=lambda:True
flow.config=lambda:('http://127.0.0.1:18000','local-fixture','https://public.example/flow')
models={kind:next(k for k,s in flow.MODELS.items() if s['kind']==kind and s['min_refs']==0 and (True if kind=='image' else s.get('family','')=='flow:veo-3.1-quality')) for kind in ('image','video')}
# Exercise historical image execution as well; product defaults remain unchanged.
with core.db(True) as con:
    policy=json.loads(con.execute("SELECT value FROM settings WHERE key='model_policy'").fetchone()[0])
    policy['enabled'].update({model:True for model in models.values()})
    con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(policy),))
current={}; requests=[]; downloaded=[]; generated=None
generic='Flow 生成或保存失败，请从后台检查结果后重试'
def media(path,kind):return ('image/png' if kind=='image' else 'video/mp4',dict(width=8,height=6,**({} if kind=='image' else dict(duration=1,fps='30/1'))))
muse_provider.inspect_media=media
def download(url,job):
    downloaded.append(url)
    if current.get('downloadError'):raise OSError('private-sentinel')
    path=core.stage_dir/'synthetic';path.write_bytes(b'synthetic-file');return path
flow.download=download
original_generate=flow.generate
def generate(job,inputs):
    global generated
    generated=original_generate(job,inputs)
    return generated
flow.generate=generate
def raw_case(c):
    if 'repeat' in c:return b'x'*c['repeat']
    if 'hex' in c:return bytes.fromhex(c['hex'])
    return c.get('raw','').encode('utf-8')
class Opener:
    def open(self,req,timeout):
        requests.append(dict(path=req.selector,headers=dict(req.header_items()),body=json.loads(req.data),timeout=timeout))
        if current.get('disconnect'):raise OSError('private-sentinel')
        raw=raw_case(current)
        if current.get('status',200)!=200:raise urllib.error.HTTPError(req.full_url,current['status'],'fixture',{},io.BytesIO(raw))
        return io.BytesIO(raw)
urllib.request.build_opener=lambda *args:Opener()
cases=[]
def event(value):return 'data: '+json.dumps(value,ensure_ascii=False)+'\n'
def chunk(text,reason=None):return event({'choices':[{'delta':{'content':text,**({'reasoning_content':reason} if reason is not None else {})}}]})
success=chunk('![result](https://public.example/flow/tmp/result)')+'data: [DONE]\n'
def scenario(name, wire, kind='image', missing=False, refs=False, source=False):
    global current,generated
    current=wire;generated=None;requests.clear();downloaded.clear()
    with core.db(True) as con:
        uid=con.execute("INSERT INTO users(name,salt,pw,role,nickname,avatar) VALUES(?,'fixture','fixture','admin','Fixture','')",(uuid.uuid4().hex,)).lastrowid
        wid=con.execute('SELECT default_workspace FROM users WHERE id=?',(uid,)).fetchone()[0]
        con.execute('UPDATE credit_accounts SET balance=10000 WHERE workspace=?',(wid,));con.execute('UPDATE credit_prices SET amount=2')
        references=['missing'] if missing else []
        if refs:
            key=uuid.uuid4().hex;path=core.stage_dir/'reference';path.write_bytes(b'private-reference');core.store.put(path,key)
            con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,'ref',17,'image/png',8,6,?,?)",(key,uid,wid));references=[key]
        model=models[kind];spec=flow.MODELS[model]
        jid=con.execute("""INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,image_quality,workspace,output_metadata)
          VALUES(?,?,?,?,?,0,?,0,0,0,'queued',?,?,?,?,'native',?,?)""",(uuid.uuid4().hex,uid,'图 <Picture 1> / 多行\n生成',json.dumps(references),spec['ratio'],spec['seconds'],core.now(),core.now(),kind,model,wid,json.dumps({'flow_source_job':71} if source else {}))).lastrowid
        con.execute('INSERT INTO flow_tasks(job,input_json) VALUES(?,?)',(jid,json.dumps({'source_media_id':'project/source:1' if source else None})))
        credits.reserve(con,jid)
    flow.tick()
    with core.db() as con:
        j=dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone());r=timing.current_run(con,jid);wallet=credits.wallet(con,wid)
        snapshot=dict(state=j['status'],note=j['note'],attempts=j['attempts'],uncertain=False,held=wallet['reserved'],balance=wallet['balance'],runStatus=r['status'] if r else None,phase=r['phase'] if r else None,actual=json.loads(j['output_metadata']))
    cases.append(dict(name=name,wire=wire,kind=kind,model=model,missing=missing,refs=refs,source=source,expected=snapshot,requests=list(requests),downloads=list(downloaded),result=generated))

for status in [302,400,401,403,404,408,413,422,429,500,502,503]:scenario('http-'+str(status),dict(status=status,raw='private-sentinel'))
for error in ['PUBLIC_ERROR_UNUSUAL_ACTIVITY','captcha','no available token','quota','SAFETY','private-sentinel',{'message':'captcha'},{'message':None},{},[],True,123]:scenario('error-'+str(len(cases)),dict(raw=event({'error':error})+success))
for value in [None,[],True,0,'invalid',{}, {'choices':None},{'choices':{}},{'choices':''},{'choices':0},{'choices':[None]},{'choices':[{'delta':None}]},{'choices':[{'delta':{},'message':{'content':'ignored'}}]},{'choices':[{'delta':{'content':3}}]}, {'choices':[{'message':{'content':'![x](https://public.example/flow/tmp/a)'}}]}]:scenario('event-'+str(len(cases)),dict(raw=event(value)+success))
for kind in ['image','video']:
    for text in ['![x](https://public.example/flow/tmp/a)','<video src="https://public.example/flow/tmp/a" data-media-id="project/id:123">',
                 '<video src="https://public.example/flow/tmp/v"> ![x](https://public.example/flow/tmp/i)',
                 'https://public.example/flow/tmp/a https://public.example/flow/tmp/b',
                 '<video src="https://public.example/flow/tmp/a&amp;x=1&#x2f;&NotEqualTilde;">',
                 '![x](https://public.example/flow/tmp/a&amp;b)', 'https://public.example/flow/tmp/a&amp;b',
                 '<video界 src="https://public.example/flow/tmp/a"> https://public.example/flow/tmp/b',
                 '![x](https://public.example/flow/tmp/a\u0085bad) https://public.example/flow/tmp/b',
                 '<VIDEO SRC="https://public.example/flow/tmp/a"> https://public.example/flow/tmp/b','']:
        scenario('result-'+str(len(cases)),dict(raw=chunk(text)),kind)
scenario('malformed-ignored',dict(raw='event: message\n: comment\ndata: {bad}\ndata:\n'+success))
scenario('done-stops',dict(raw=success+event({'error':'captcha'})+'x'*10000))
scenario('done-first',dict(raw='data: [DONE]\n'+success))
scenario('unterminated-line',dict(raw=success.split('\ndata: [DONE]')[0]))
scenario('multibyte',dict(raw=chunk('说明中文')+chunk('![图](https://public.example/flow/tmp/a)')))
scenario('non-ASCII-prefix',dict(hex=(bytes([228,225,244,225,186])+b'{}\n'+success.encode()).hex()))
scenario('BOM-json',dict(hex=(b'data: \xef\xbb\xbf'+json.dumps({'choices':[{'delta':{'content':'https://public.example/flow/tmp/a'}}]}).encode()+b'\n').hex()))
scenario('malformed-utf8-ignored',dict(hex=(b'data: "\xff"\n'+success.encode()).hex()))
scenario('diagnostics',dict(raw=chunk('no result','quota exceeded')))
scenario('network-error',dict(disconnect=True))
scenario('oversize',dict(repeat=8*1024*1024+1))
scenario('missing-ref',dict(raw=success),missing=True)
scenario('reference-payload',dict(raw=success),refs=True)
scenario('extend-payload',dict(raw=chunk('<video src="https://public.example/flow/tmp/a" data-media-id="project/result">')),kind='video',source=True)
scenario('download-error',dict(raw=success,downloadError=True))
safe=[dict(status=status,text=text,expected=flow.safe_error(status,text)) for status in [200,302,400,401,403,404,422,429,500,502] for text in ['','CAPTCHA','recaptcha','public_error_unusual_activity quota captcha','no available','no valid token','没有可用','无可用','token is expired','quota','credit','余额','额度','safety','policy','sensitive','unsafe','违规','private-sentinel','captcha quota','quota safety']]
entities=[dict(text='a&'+key+'z',expected=html.unescape('a&'+key+'z')) for key in html.entities.html5]
entities += [dict(text='&#'+str(n)+'; / &#x'+hex(n)[2:]+';',expected=html.unescape('&#'+str(n)+'; / &#x'+hex(n)[2:]+';')) for n in list(range(0,161))+[0xd800,0xdfff,0xfdd0,0xfdef,0xfffe,0xffff,0x10ffff,0x110000]]
print(json.dumps(dict(cases=cases,safe=safe,entities=entities),ensure_ascii=True))
