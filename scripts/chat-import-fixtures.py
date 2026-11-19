"""Build a quiescent original chat history through real APIs; no real providers."""
import json,os,sys,uuid,importlib.util,sqlite3
from pathlib import Path
from types import SimpleNamespace
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,chat_api as api,chat_runtime as runtime,chat_storage as storage,credits
from server import app
stamp=1800000000.25
clock=SimpleNamespace(time=lambda:stamp)
api.time=storage.time=clock
runtime.start=lambda _:None;runtime.key=lambda _: 'sk-fixture-native-chat'
clients=[]
for role,name,nickname in [('admin','admin','管理员'),('member','member','成员')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    c=TestClient(app,raise_server_exceptions=False)
    r=c.post('/api/register',json=dict(name=name,nickname=nickname,password='chat-import-fixture',code=code));assert r.status_code==200,r.text
    clients.append(c)
def request(method,path,body=None,user=0,workspace=None):
    global stamp
    stamp+=.25
    headers={'X-Workspace-Id':str(workspace)} if workspace else {}
    r=clients[user].request(method,path,headers=headers,**({'json':body} if body is not None else {}))
    assert r.status_code==200,(path,r.status_code,r.text)
    return r.json()
for wid in [1,2,3]:request('POST','/api/admin/credits/adjust',dict(workspace=wid,amount=100,note='迁移测试余额',uid=str(uuid.uuid4())))
with core.db(True) as con:
    con.execute('INSERT INTO workspace_members(workspace,user) VALUES(1,2)')
    con.execute("INSERT INTO sqlite_sequence(name,seq) VALUES('chat_messages',40)")
    pricing=credits.prices(con)
def create(user=0,workspace=None,context=None):return request('POST','/api/chats',{'context':context},user,workspace)['conversation']['id']
def send(cid,text='问题',user=0,workspace=None,retry=None):
    view=request('GET','/api/chats/'+cid,user=user,workspace=workspace)
    body=dict(uid=str(uuid.uuid4()),model='deepseek-flash',text=text,expected_revision=view['conversation']['revision'],price_revision=pricing['revision'],retry=retry)
    return request('POST','/api/chats/'+cid+'/messages',body,user,workspace)
def finish(view,state='complete',text='完整回答😀',error='',reason='stop',usage=None):
    global stamp
    stamp+=.25
    with core.db(True) as con:
        tid=view['conversation']['active_turn'];con.execute('UPDATE chat_turns SET started=?,first_token=?,request_id=? WHERE id=?',(stamp-.2,stamp-.1,'历史请求\u0000',tid))
        assert storage.finish(con,tid,state,text,error,usage or {'total_tokens':9007199254740993},reason)
def canvas():
    p=request('POST','/api/canvases',{'title':'采用画布'})
    doc=p['document'];doc['nodes']=[dict(id='text-node',type='text',title='原节点',text='原文',x=0,y=0)]
    request('PUT','/api/canvases/'+p['id']+'/document',dict(title=p['title'],document=doc,expected_revision=1))
    return p['id']
live=canvas();deleted_canvas=canvas()
c1=create(context=dict(project=live,node='text-node',expected_revision=2,writeback=True))
a=send(c1,'用户原文😀\u0000 /media/'+'a'*32);finish(a)
apply1=request('POST','/api/chats/'+c1+'/apply',dict(uid=str(uuid.uuid4()),message=a['messages'][-1]['id'],project=live,expected_revision=2,mode='replace',node='text-node',expected_text='原文'))
apply2=request('POST','/api/chats/'+c1+'/apply',dict(uid=str(uuid.uuid4()),message=a['messages'][-1]['id'],project=live,expected_revision=3,mode='new',node='text-node'))
b=send(c1,'第二条');finish(b,'failed','未完成\u0000回复','历史错误\u0000','length')
c=send(c1,retry=b['messages'][-1]['id']);finish(c)
d=send(c1,'第三条');request('POST','/api/chats/'+c1+'/stop')
c2=create();a2=send(c2);finish(a2)
request('POST','/api/chats/'+c2+'/apply',dict(uid=str(uuid.uuid4()),message=a2['messages'][-1]['id'],project=deleted_canvas,expected_revision=2,mode='new'))
request('DELETE','/api/canvases/'+deleted_canvas)
v=request('GET','/api/chats/'+c2);request('PATCH','/api/chats/'+c2,dict(title='已删除标题😀\u0000',expected_revision=v['conversation']['revision']))
request('DELETE','/api/chats/'+c2)
team=create(user=1,workspace=1);t=send(team,user=0,workspace=1);finish(t,'failed','团队失败','可重试','')
t=send(team,user=1,workspace=1,retry=t['messages'][-1]['id']);finish(t)
private=create(user=1);p=send(private,user=1);request('POST','/api/chats/'+private+'/stop',user=1)
empty=create()
# Node deletion retains its old conversation link and adoption audit.
project=request('GET','/api/canvases/'+live);project['document']['nodes']=[n for n in project['document']['nodes'] if n['id']!='text-node']
request('PUT','/api/canvases/'+live+'/document',dict(title=project['title'],document=project['document'],expected_revision=project['revision']))
# Explicitly sparse ordinals exercise allocation without changing the original IDs.
with core.db(True) as con:con.execute('UPDATE conversations SET rowid=rowid+100')
spec=importlib.util.spec_from_file_location('exporter',str(Path(__file__).resolve().parent/'export-legacy.py'));exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
exporter.export(core.DATA/'studio.sqlite',out/'export.json','chat-import-oracle',True)
cases=[]
def case(action,cid=None,user=0,workspace=None,body=None,project='',node=''):
    global stamp
    stamp+=.25
    path='/api/chats'+('/'+cid if cid else '')+({'stop':'/stop','restore':'/restore','send':'/messages'}.get(action,''))
    method={'list':'GET','get':'GET','stop':'POST','restore':'POST','rename':'PATCH','send':'POST','delete':'DELETE'}[action]
    if action in ['rename','send'] and isinstance(body,dict) and body.get('expected_revision')=='current':
        with core.db() as con:body['expected_revision']=con.execute('SELECT revision FROM conversations WHERE id=?',(cid,)).fetchone()[0]
    r=clients[user].request(method,path,headers={'X-Workspace-Id':str(workspace)} if workspace else {},params={'project':project,'node':node} if action=='list' else {},**({'json':body} if body is not None else {}))
    cases.append(dict(action=action,chat=cid,user=user,workspace=workspace,body=body,project=project,node=node,stamp=stamp,status=r.status_code,expected=r.json()))
for actor in [0,1]:
    case('list',user=actor);case('list',user=actor,workspace=1)
    for cid,wid in [(c1,None),(c2,None),(team,1),(private,None),(empty,None)]:case('get',cid,user=actor,workspace=wid)
case('list',project=live,node='text-node')
case('list',project=deleted_canvas,node='text-node')
# Replaying all historical UIDs is a read of the current conversation, never a charge.
with core.db() as con:turns=[dict(r) for r in con.execute('SELECT t.*,m.content FROM chat_turns t JOIN chat_messages m ON m.id=t.user_message')]
for turn in turns:
    if turn['conversation']==c2:continue
    case('send',turn['conversation'],user=turn['owner']-1,workspace=1 if turn['conversation']==team else None,body=dict(uid=turn['uid'],model=turn['model'],text=turn['content'],expected_revision=1,price_revision=1))
case('restore',c2)
case('rename',c2,body=dict(title='恢复后仍保留\u0000',expected_revision='current'))
case('stop',c1)
case('send',c1,body=dict(uid=str(uuid.uuid4()),model='deepseek-flash',text='忽略重试新文字',expected_revision='current',price_revision=pricing['revision'],retry=d['messages'][-1]['id']))
case('stop',c1)
case('delete',c1);case('restore',c1)
guards=[]
for name,mutation,expected in [
    ('running',"UPDATE chat_turns SET state='running' WHERE id=(SELECT id FROM chat_turns LIMIT 1)",'未结算任务'),
    ('held-with-zero-wallet',"UPDATE credit_chat_charges SET state='held' WHERE turn=(SELECT turn FROM credit_chat_charges LIMIT 1)",'未结算对话费用'),
    ('missing-table','DROP TABLE chat_turns','对话表不完整'),
    ('reserved',"UPDATE credit_accounts SET reserved=1 WHERE workspace=2",'冻结积分'),
]:
    target=out/(name+'.sqlite')
    with sqlite3.connect(core.DATA/'studio.sqlite') as src,sqlite3.connect(target) as dst:
        src.backup(dst);dst.execute(mutation);dst.commit()
    try:exporter.export(target,out/(name+'.json'),'invalid-chat-fixture',True)
    except SystemExit as error:
        assert expected in str(error),(name,str(error));assert not (out/(name+'.json')).exists();guards.append(name)
    else:raise AssertionError('Exporter accepted '+name)
for client in clients:client.close()
(out/'manifest.json').write_text(json.dumps(dict(cases=cases,guards=guards,live=live,deletedCanvas=deleted_canvas,empty=empty),ensure_ascii=True))
