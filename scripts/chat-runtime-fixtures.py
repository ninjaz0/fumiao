"""Untouched original runtime/storage driven by deterministic local provider events."""
import asyncio,json,os,sys,uuid
from pathlib import Path
from types import SimpleNamespace
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,chat_api as api,chat_runtime as runtime,chat_storage as storage,credits
from server import app
stamp=1800000000.25;mono=10
clock=SimpleNamespace(time=lambda:stamp,monotonic=lambda:mono)
api.time=runtime.time=storage.time=clock
runtime.start=lambda _:None;runtime.key=lambda _: 'sk-fixture-native-chat'
with core.db(True) as con:
    code=core.token();con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,'admin',core.now()+90))
client=TestClient(app,raise_server_exceptions=False)
r=client.post('/api/register',json=dict(name='admin',nickname='Admin',password='chat-runtime-fixture',code=code));assert r.status_code==200,r.text
with core.db() as con:pricing=credits.prices(con)
def event(item,at=.25,mono=10):return dict(item=item,at=at,mono=mono)
cases=[
 dict(name='complete-title',events=[event({'request_id':'request-id'},.01,10),event({'text':'第一段😀\u0000'},.1,10.1),event({'text':'第二段','reason':'stop','usage':{'total_tokens':17}},.2,10.2)],title='自动标题'),
 dict(name='usage-kept-empty',events=[event({'text':'答','usage':{'prompt_tokens':3}},.1,10),event({'text':'复','reason':'stop','usage':{}},.2,10.01)],title=''),
 dict(name='first-token-throttle',events=[event({'request_id':'first'},.01,10),event({'text':'A'},.05,10.05),event({'text':'B'},.1,10.1),event({'text':'C'},.2,10.2),event({'reason':'stop','request_id':'last'},.3,10.21)]),
 dict(name='incomplete',events=[event({'text':'不完整'})]),
 dict(name='no-events',events=[]),
 dict(name='whitespace-only',events=[event({'text':'\u3000\n','reason':'stop'})]),
 dict(name='length',events=[event({'text':'部分','reason':'length'})]),
 dict(name='generic-exception',events=[event({'text':'部分'}),dict(raise_='generic',at=.5)]),
 dict(name='provider-exception',events=[dict(raise_='runtime',at=.5,message='服务凭据不可用，请联系管理员')]),
 dict(name='cancel',events=[event({'text':'最后完整内存文本'},.1,0.01),dict(raise_='cancel',at=.5)]),
 dict(name='text-object',events=[event({'text':{'bad':True},'reason':'stop'})]),
 dict(name='text-empty-containers',events=[event({'text':[]}),event({'text':{},'reason':False})]),
 dict(name='text-boolean',events=[event({'text':True})]),
 dict(name='reason-object',events=[event({'text':'保留部分','reason':{'bad':1}})],recover=True),
 dict(name='reason-list',events=[event({'text':'保留部分','reason':['bad']})],recover=True),
 dict(name='reason-integer',events=[event({'text':'回复','reason':1})]),
 dict(name='reason-boolean',events=[event({'text':'回复','reason':True})]),
 dict(name='reason-empty-does-not-clear',events=[event({'text':'回复','reason':'stop'}),event({'reason':[]})]),
 dict(name='exact-unicode-limit',events=[event({'text':'😀'*50000,'reason':'stop'})]),
 dict(name='exceeds-unicode-limit',events=[event({'text':'😀'*50001,'reason':'stop'})]),
 dict(name='title-empty',events=[event({'text':'完整','reason':'stop'})],title=''),
 dict(name='title-failure',events=[event({'text':'完整','reason':'stop'})],titleFailure=True),
 dict(name='title-rename-race',events=[event({'text':'完整','reason':'stop'})],title='不要覆盖手动标题',titleMutation='rename'),
 dict(name='title-delete-race',events=[event({'text':'完整','reason':'stop'})],title='不要覆盖已删除',titleMutation='delete'),
 dict(name='custom-title',events=[event({'text':'完整','reason':'stop'})],title='不要覆盖',custom=True),
 dict(name='stop-between-chunks',events=[event({'text':'已显示'},.1,10),dict(stop=True,at=.2,mono=10.3,item={'text':'迟到文本','reason':'stop'})]),
]
results=[]
for index,spec in enumerate(cases):
    base=1800000000.25+index*100;stamp=base;mono=10
    with core.db(True) as con:con.execute('UPDATE credit_accounts SET balance=100,reserved=0')
    r=client.post('/api/chats',json={});assert r.status_code==200,r.text
    cid=r.json()['conversation']['id'];revision=1
    if spec.get('custom'):
        r=client.patch('/api/chats/'+cid,json={'title':'用户标题','expected_revision':1});assert r.status_code==200,r.text
        revision=2
    body=dict(uid=str(uuid.uuid4()),model='deepseek-flash',text='第一轮问题',expected_revision=revision,price_revision=pricing['revision'])
    r=client.post('/api/chats/'+cid+'/messages',json=body);assert r.status_code==200,r.text
    tid=r.json()['conversation']['active_turn'];trace=[];requests=[];titles=[]
    def snapshot():
        with core.db() as con:
            user=con.execute('SELECT * FROM users WHERE id=1').fetchone();chat=con.execute('SELECT * FROM conversations WHERE id=?',(cid,)).fetchone()
            view=api.snapshot(con,chat,user);view['conversation']['id']='$c';view['conversation']['active_turn']='$t' if view['conversation']['active_turn'] else None
            for i,m in enumerate(view['messages']):m['id']='$m'+str(i+1);m['reply_to']='$m1' if m['reply_to'] else None;m['turn']='$t' if m['turn'] else None
            turn=dict(con.execute('SELECT * FROM chat_turns WHERE id=?',(tid,)).fetchone())
            turn={k:turn[k] for k in ['state','created','started','first_token','finished','updated','usage','error','request_id','finish_reason']}
            wallet=dict(con.execute('SELECT balance,reserved FROM credit_accounts WHERE workspace=2').fetchone())
            charge=dict(con.execute('SELECT amount,state FROM credit_chat_charges WHERE turn=?',(tid,)).fetchone())
            ledger=[dict(row) for row in con.execute('SELECT action,amount,balance,reserved,note,created FROM credit_ledger WHERE chat_turn=? ORDER BY id',(tid,))]
        return dict(view=view,turn=turn,wallet=wallet,charge=charge,ledger=ledger)
    async def stream(model,messages):
        global stamp,mono
        requests.append(dict(model=model,messages=messages))
        for e in spec['events']:
            stamp=base+e.get('at',.25);mono=e.get('mono',10)
            if e.get('stop'):client.post('/api/chats/'+cid+'/stop')
            if e.get('raise_')=='generic':raise ValueError('private detail')
            if e.get('raise_')=='runtime':raise RuntimeError(e['message'])
            if e.get('raise_')=='cancel':raise asyncio.CancelledError()
            yield e['item']
            trace.append(snapshot())
    async def title(model,question,answer):
        global stamp
        stamp=base+2;titles.append(dict(model=model,question=question,answer=answer))
        if spec.get('titleFailure'):raise ValueError('private title error')
        if spec.get('titleMutation')=='rename':
            with core.db() as con:revision=con.execute('SELECT revision FROM conversations WHERE id=?',(cid,)).fetchone()[0]
            client.patch('/api/chats/'+cid,json=dict(title='用户改名',expected_revision=revision))
        if spec.get('titleMutation')=='delete':client.delete('/api/chats/'+cid)
        return spec.get('title','')
    runtime.provider_stream=stream;runtime.provider_title=title
    rejected=False
    try:asyncio.run(runtime.run(tid))
    except BaseException:rejected=True
    final=snapshot();recovered=None
    if spec.get('recover'):
        stamp=base+61;runtime.recover();recovered=snapshot()
    results.append(dict(**spec,base=base,body=body,trace=trace,requests=requests,titles=titles,rejected=rejected,final=final,recovered=recovered))
client.close()
(out/'manifest.json').write_text(json.dumps(dict(cases=results),ensure_ascii=True))
