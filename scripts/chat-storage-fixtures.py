"""Original conversation/storage oracle. Real FastAPI/SQLite, no provider tasks."""
import json, os, sys, time, uuid
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,chat_runtime as runtime,chat_storage as storage,model_policy,credits
from server import app
stamp=1800000000.25
clock=patch.object(time,'time',lambda:stamp);clock.start()
clients=[];key_enabled=True
runtime.start=lambda _:None
runtime.key=lambda _: 'sk-fixture-native-chat' if key_enabled else ''
for role,name,nickname in [('admin','admin','Admin'),('member','member','Member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    c=TestClient(app,raise_server_exceptions=False)
    r=c.post('/api/register',json=dict(name=name,nickname=nickname,password='chat-storage-fixture',code=code));assert r.status_code==200,r.text
    clients.append(c)
with core.db(True) as con:
    con.execute('UPDATE credit_accounts SET balance=100,reserved=0')
    initial=model_policy.read(con);pricing=credits.prices(con)
canvas='a'*32;foreign='b'*32
node=dict(id='text-node',type='text',title='原节点',text='保留原文😀')
for index,pid in enumerate([canvas,foreign]):
    r=clients[index].post('/api/canvases',json={'title':'画布'});assert r.status_code==200,r.text
    old=r.json()['id']
    with core.db(True) as con:con.execute('UPDATE canvas_projects SET id=?,document=? WHERE id=?',(pid,json.dumps({'schemaVersion':1,'nodes':[node],'edges':[]},ensure_ascii=False),old))
cases=[]
def maps(con):
    conv={r['id']:'$c'+str(i+1) for i,r in enumerate(con.execute('SELECT id FROM conversations ORDER BY rowid'))}
    msg={r['id']:'$m'+str(i+1) for i,r in enumerate(con.execute('SELECT id FROM chat_messages ORDER BY id'))}
    turns={r['id']:'$t'+str(i+1) for i,r in enumerate(con.execute('SELECT id FROM chat_turns ORDER BY assistant_message'))}
    return conv,msg,turns

def resolve(value):
    with core.db() as con:
        a,b,c=maps(con);mapping={v:k for group in [a,b,c] for k,v in group.items()}
    def walk(v):
        if isinstance(v,str):return mapping.get(v,v)
        if isinstance(v,list):return [walk(x) for x in v]
        if isinstance(v,dict):return {k:walk(x) for k,x in v.items()}
        return v
    return walk(value)
def normalize(value,con):
    chats,msgs,turns=maps(con)
    def walk(v):
        if isinstance(v,str):return chats.get(v,turns.get(v,v))
        if isinstance(v,list):return [walk(x) for x in v]
        if isinstance(v,dict):
            result={k:walk(x) for k,x in v.items()}
            if 'role' in v and 'id' in v:result['id']=msgs.get(v['id'],v['id'])
            for key in ['reply_to','user_message','assistant_message']:
                if key in v:result[key]=msgs.get(v[key],v[key])
            return result
        return v
    return walk(value)
def state(con):
    conv=[dict(r) for r in con.execute('SELECT * FROM conversations ORDER BY rowid')]
    msg=[dict(r) for r in con.execute('SELECT * FROM chat_messages ORDER BY id')]
    turns=[dict(r) for r in con.execute('SELECT * FROM chat_turns ORDER BY assistant_message')]
    charges=[dict(r) for r in con.execute('SELECT c.* FROM credit_chat_charges c JOIN chat_turns t ON t.id=c.turn ORDER BY t.assistant_message')]
    ledger=[dict(r) for r in con.execute('SELECT workspace,actor,chat_turn,action,amount,balance,reserved,note,created FROM credit_ledger WHERE chat_turn IS NOT NULL ORDER BY id')]
    wallet=[dict(r) for r in con.execute('SELECT * FROM credit_accounts ORDER BY workspace')]
    links=[dict(r) for r in con.execute('SELECT * FROM canvas_chat_links ORDER BY project,node,conversation')]
    return normalize(dict(conversations=conv,messages=msg,turns=turns,charges=charges,ledger=ledger,wallets=wallet,links=links),con)
def case(name,action='get',chat='$c1',**spec):
    global stamp,key_enabled
    stamp=1800000000.25+len(cases)*.25
    c=dict(name=name,action=action,chat=chat,stamp=stamp,**spec)
    value=resolve(c);cid=value['chat'];body=value.get('body')
    if action in ['rename','send'] and isinstance(body,dict) and body.get('expected_revision')=='current':
        with core.db() as con:body['expected_revision']=con.execute('SELECT revision FROM conversations WHERE id=?',(cid,)).fetchone()[0]
        c['body']=dict(c['body'],expected_revision=body['expected_revision'])
    if action=='send' and isinstance(body,dict):
        body.setdefault('uid',str(uuid.uuid5(uuid.NAMESPACE_DNS,'chat-case-'+str(len(cases)))))
        body.setdefault('model','deepseek-flash');body.setdefault('price_revision',pricing['revision'])
        c['body']=dict(c['body'],uid=body['uid'],model=body['model'],price_revision=body['price_revision'])
    result=None
    if action=='finish':
        kw={k:value[k] for k in ['text','error','usage','reason'] if k in value}
        if 'usageBig' in value:kw['usage']={'total_tokens':int(value['usageBig'])}
        with core.db(True) as con:result={'status':200,'body':storage.finish(con,resolve(spec['turn']),spec['state'],**kw)}
    elif action=='mutate':
        with core.db(True) as con:
            if 'configured' in spec:key_enabled=spec['configured']
            if 'flag' in spec:
                policy=model_policy.read(con);policy['enabled']['deepseek-flash']=spec['flag'];con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(policy),))
            if 'price' in spec:con.execute("UPDATE credit_prices SET amount=? WHERE key='deepseek-flash|reply'",(spec['price'],))
            if 'balance' in spec:con.execute('UPDATE credit_accounts SET balance=? WHERE workspace=2',(spec['balance'],))
            if 'canvasText' in spec:con.execute('UPDATE canvas_projects SET document=?,revision=revision+1 WHERE id=?',(json.dumps({'schemaVersion':1,'nodes':[dict(node,text=spec['canvasText'])],'edges':[]},ensure_ascii=False),canvas))
            if 'teamMember' in spec:
                if spec['teamMember']:con.execute('INSERT OR IGNORE INTO workspace_members VALUES(1,2)')
                else:con.execute('DELETE FROM workspace_members WHERE workspace=1 AND user=2')
        result={'status':200,'body':{'ok':True}}
    else:
        path={'create':'/api/chats','list':'/api/chats','get':'/api/chats/'+cid,'rename':'/api/chats/'+cid,'delete':'/api/chats/'+cid,'restore':'/api/chats/'+cid+'/restore','send':'/api/chats/'+cid+'/messages','stop':'/api/chats/'+cid+'/stop'}[action]
        method={'create':'POST','list':'GET','get':'GET','rename':'PATCH','delete':'DELETE','restore':'POST','send':'POST','stop':'POST'}[action]
        headers={'origin':'http://localhost:3000','content-type':'application/json'}
        if 'workspace' in spec:headers['x-workspace-id']=str(spec['workspace'])
        params=spec.get('query',{})
        r=clients[spec.get('actor',0)].request(method,path,params=params,headers=headers,content=json.dumps(body,ensure_ascii=True) if 'body' in spec else None)
        try:payload=r.json()
        except ValueError:payload=r.text
        result={'status':r.status_code,'body':payload}
    with core.db() as con:c['expected']=normalize(result,con);c['storage']=state(con)
    cases.append(c)
case('create','create',body={})
case('get');case('list','list')
for i,b in enumerate([None,[],False,{}, {'title':'','expected_revision':1},{'title':'\u0085\u3000','expected_revision':1},{'title':'标题','expected_revision':9},{'title':'标题','expected_revision':1,'extra':True}]):case('rename-validation-'+str(i),'rename',body=b)
case('rename','rename',body={'title':'\u3000手工名字\u3000','expected_revision':1})
case('stale-send','send',body={'text':'hello','expected_revision':1})
case('unknown-send','send',body={'text':'hello','expected_revision':'current','model':'unknown'})
case('disabled','mutate',flag=False)
case('disabled-send','send',body={'text':'hello','expected_revision':'current'})
case('enabled','mutate',flag=True,configured=False)
case('unconfigured-send','send',body={'text':'hello','expected_revision':'current'})
case('configured','mutate',configured=True)
for i,b in enumerate([None,[],False,{'text':'hello','expected_revision':1,'extra':True},{'text':' \u3000','expected_revision':'current'},{'text':'hello','expected_revision':'current','retry':0}]):case('send-validation-'+str(i),'send',body=b)
case('send','send',body={'text':'\u3000首条😀\u0000文字\n 第二行\u3000','expected_revision':'current'})
uid=cases[-1]['body']['uid']
case('send-duplicate','send',body={'uid':uid,'text':'首条😀\u0000文字\n 第二行','expected_revision':999,'price_revision':999})
case('send-uid-conflict','send',body={'uid':uid,'text':'different','expected_revision':999})
case('send-idempotent-retry','send',body={'uid':uid,'text':'ignored','retry':9999,'expected_revision':999})
case('send-busy','send',body={'text':'hello','expected_revision':'current'})
case('delete-running','delete');case('stop','stop');case('stop-again','stop')
case('late-complete','finish',turn='$t1',state='complete',text='late',reason='stop')
case('retry-wrong','send',body={'retry':999,'expected_revision':'current'})
case('price-null','mutate',price=None)
case('retry-no-price','send',body={'retry':'$m2','expected_revision':'current'})
case('price-reset','mutate',price=1)
case('retry-stale-price','send',body={'retry':'$m2','price_revision':999,'expected_revision':'current'})
case('wallet-empty','mutate',balance=0)
case('retry-insufficient','send',body={'retry':'$m2','expected_revision':'current'})
case('wallet-reset','mutate',balance=100)
case('retry','send',body={'retry':'$m2','text':'ignored','expected_revision':'current'})
case('finish','finish',turn='$t2',state='complete',text='完整回复😀\u0000',usageBig='9007199254740993',reason='stop')
case('finish-again','finish',turn='$t2',state='failed',text='late')
case('complete-get');case('delete','delete');case('get-deleted');case('list-deleted','list');case('restore','restore');case('restore-again','restore')
case('private-create','create',actor=1,body={})
case('private-other-get',chat='$c2');case('private-explicit-get',chat='$c2',workspace=3)
case('team-add','mutate',teamMember=True)
case('team-create','create',workspace=1,body={})
case('team-member-rename','rename',chat='$c3',actor=1,workspace=1,body={'title':'共同编辑','expected_revision':1})
case('team-member-send','send',chat='$c3',actor=1,workspace=1,body={'text':'成员消息','expected_revision':'current'})
case('team-member-delete','delete',chat='$c3',actor=1,workspace=1)
case('team-admin-stop','stop',chat='$c3',workspace=1)
case('team-admin-delete','delete',chat='$c3',workspace=1)
case('team-member-restore','restore',chat='$c3',actor=1,workspace=1)
case('team-admin-restore','restore',chat='$c3',workspace=1)
case('team-remove','mutate',teamMember=False)
case('team-revoked','get',chat='$c3',actor=1,workspace=1)
context=dict(project=canvas,node='text-node',expected_revision=1,writeback=True)
case('context-create','create',body={'context':context})
case('context-list','list',query={'project':canvas,'node':'text-node'})
case('context-send','send',chat='$c4',body={'context':context,'text':'修改','expected_revision':'current'})
case('context-fail','finish',turn='$t4',state='failed',text='废弃片段',error='失败')
case('context-edit','mutate',canvasText='新的材料')
case('context-stale-retry','send',chat='$c4',body={'retry':'$m7','context':context,'expected_revision':'current'})
case('context-valid-retry','send',chat='$c4',body={'retry':'$m7','context':dict(context,expected_revision=2),'expected_revision':'current'})
case('context-stop','stop',chat='$c4')
case('context-private','create',body={'context':dict(context,project=foreign)})
case('context-missing','create',body={'context':dict(context,project='missing')})
case('context-missing-node','create',body={'context':dict(context,expected_revision=2,node='missing')})
case('context-extra','create',body={'context':dict(context,extra=True)})
case('unicode-create','create',body={})
case('unicode-title','send',chat='$c5',body={'text':'\u0085😀\u0000文本\n 新行'+('😀'*40),'expected_revision':'current'})
case('unicode-stop','stop',chat='$c5')
for i,b in enumerate([None,[],False,{'model':None},{'model':'unknown'},{'extra':True}]):case('create-validation-'+str(i),'create',body=b)
(out/'manifest.json').write_text(json.dumps(dict(initial=initial,pricing=pricing,canvas=canvas,foreign=foreign,node=node,cases=cases),ensure_ascii=True))
clock.stop();print(json.dumps(dict(scenarios=len(cases))))
