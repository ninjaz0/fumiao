"""Real unmodified FastAPI/SQLite adoption oracle, isolated data and no workers."""
import json,os,runpy,sys,uuid,importlib.util
from pathlib import Path
from types import SimpleNamespace
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
scripts=Path(__file__).resolve().parent
pinned_app,_=runpy.run_path(str(scripts/'preview-original.py'))['prepare'](out/'original')
for key in list(os.environ):
    if key.startswith('FUMIAO_') or key == 'OPENAI_API_KEY':
        del os.environ[key]
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_STATIC_DIR=str(pinned_app/'static'),FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(pinned_app))
import core,canvas_api,chat_api
from server import app
canvas_api.now=chat_api.now=lambda:1800000000
chat_api.time=SimpleNamespace(time=lambda:1800000000)
clients=[]
for name,role in [('admin','admin'),('member','member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    c=TestClient(app,raise_server_exceptions=False);r=c.post('/api/register',json=dict(name=name,nickname=name,password='adoption-fixture',code=code));assert r.status_code==200,r.text;clients.append(c)
with core.db(True) as con:con.execute('INSERT INTO workspace_members(workspace,user) VALUES(1,2)')
media='a'*32
(core.DATA/'media').mkdir(exist_ok=True);(core.DATA/'media'/media).write_bytes(b'')
with core.db(True) as con:con.execute("INSERT INTO media(id,kind,owner,workspace,mime,size,w,h) VALUES(?,'ref',1,2,'image/png',0,16,16)",(media,))
p=clients[0].post('/api/canvases',json={'title':'原画布'}).json()
r=clients[0].put('/api/canvases/'+p['id']+'/document',json={'title':'原画布','expected_revision':p['revision'],'document':{'nodes':[{'id':'text','type':'text','text':'旧\0😀','x':100,'y':20},{'id':'sticky','type':'sticky','text':'便签','x':0,'y':0},{'id':'image','type':'image','x':98000,'y':0,'media_id':media,'use_media':True}], 'edges':[{'id':'edge','source':'text','target':'image'}]}});assert r.status_code==200,r.text
p=r.json()
project=clients[0].get('/api/canvases').json()['projects'][0]['id']
cid=clients[0].post('/api/chats',json={}).json()['conversation']['id']
team=clients[0].post('/api/chats',json={},headers={'X-Workspace-Id':'1'}).json()['conversation']['id']
teamproject=clients[0].post('/api/canvases',json={'title':'团队画布'},headers={'X-Workspace-Id':'1'}).json()['id']
with core.db(True) as con:
    for i,(role,state,text,hidden,chat) in enumerate([('assistant','complete','新\0😀汉字',0,cid),('assistant','complete','😀'*12000,1,cid),('assistant','complete','😀'*12001,0,cid),('assistant','failed','等待',0,cid),('user','complete','问题',0,cid),('assistant','complete','团队',0,team)],1):
        con.execute('INSERT INTO chat_messages(id,conversation,role,content,state,created,superseded) VALUES(?,?,?,?,?,?,?)',(i,chat,role,text,state,1800000000,hidden))
spec=importlib.util.spec_from_file_location('exporter',str(Path(__file__).resolve().parent/'export-legacy.py'));exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
exporter.export(core.DATA/'studio.sqlite',out/'export.json','adoption-oracle',True)
cases=[]
def call(name,patch={},user=0,chat=cid,workspace=None,uid=None):
    current=clients[0].get('/api/canvases/'+project).json()
    body=dict(uid=uid or str(uuid.uuid4()),message=1,project=project,expected_revision=current['revision'],**{})
    body.update(patch)
    r=clients[user].post('/api/chats/'+chat+'/apply',json=body,headers={'X-Workspace-Id':str(workspace)} if workspace else {})
    cases.append(dict(name=name,body=body,user=user,chat=chat,workspace=workspace,status=r.status_code,result=r.json() if r.headers.get('content-type','').startswith('application/json') else r.text))
    return body
call('invalid mode before permissions',dict(mode='bad'),user=1)
call('invalid message input',dict(message=0))
call('unknown input',dict(extra=True))
call('missing project with NUL',dict(project='missing\0project'))
call('replace',dict(mode='replace',node='text',expected_text='旧\0😀'))
b=call('new adjacent',dict(node='text'))
call('uid replay ignores stale revision and text',dict(expected_revision=1,mode='new',node='missing'),uid=b['uid'])
call('uid conflict before revision',dict(message=2,expected_revision=1),uid=b['uid'])
call('revision before message',dict(message=999,expected_revision=1))
for m in [999,3,4,5,6]:call('invalid message '+str(m),dict(message=m))
for state in ['running','stopped','interrupted','complete']:
    with core.db(True) as con:con.execute('UPDATE chat_messages SET state=? WHERE id=4',(state,))
    cases.append(dict(name='message state '+state,action='state',state=state))
    call('message eligibility '+state,dict(message=4))
teamapply=call('team member adoption',dict(project=teamproject,expected_revision=1,message=6),user=1,chat=team,workspace=1)
call('team uid owner mismatch',dict(project=teamproject,expected_revision=1,message=6),chat=team,workspace=1,uid=teamapply['uid'])
call('uid conversation mismatch',dict(project=teamproject,expected_revision=1,message=6),chat=team,workspace=1,uid=b['uid'])
call('missing replace',dict(mode='replace',node='gone'))
call('image replace',dict(mode='replace',node='image'))
call('expected text',dict(mode='replace',node='text',expected_text='旧'))
call('sticky replace',dict(mode='replace',node='sticky',expected_text='便签'))
call('hidden complete at unicode limit',dict(message=2))
call('capped adjacent',dict(node='image'))
call('missing anchor appends at maximum',dict(node='gone'))
current=clients[0].get('/api/canvases/'+project).json()
save=dict(title=current['title'],expected_revision=current['revision'],document={'nodes':[],'edges':[]})
r=clients[0].put('/api/canvases/'+project+'/document',json=save);assert r.status_code==200,r.text
cases.append(dict(name='delete all nodes',action='save',body=save,project=project,result=r.json(),status=200))
call('uid replay after target deletion',dict(expected_revision=1),uid=b['uid'])
call('deleted target replace',dict(mode='replace',node='text',expected_text='新\0😀汉字'))
call('new on empty canvas')
call('private isolation',user=1)
call('cross workspace',chat=team,workspace=1)
current=clients[0].get('/api/canvases/'+project).json()
save=dict(title=current['title'],expected_revision=current['revision'],document={'nodes':[{'id':f'text-{i}','type':'text','x':0,'y':0} for i in range(200)],'edges':[]})
r=clients[0].put('/api/canvases/'+project+'/document',json=save);assert r.status_code==200,r.text
cases.append(dict(name='fill canvas',action='save',body=save,project=project,result=r.json(),status=200))
full=call('new exceeds stored document limit')
call('replace on a full canvas with the same UID',dict(mode='replace',node='text-0'),uid=full['uid'])
current=clients[0].get('/api/canvases/'+project).json()
save=dict(title=current['title'],expected_revision=current['revision'],document={'nodes':[],'edges':[]})
r=clients[0].put('/api/canvases/'+project+'/document',json=save);assert r.status_code==200,r.text
cases.append(dict(name='clear full canvas',action='save',body=save,project=project,result=r.json(),status=200))
r=clients[0].delete('/api/chats/'+cid);assert r.status_code==200,r.text
call('deleted conversation')
exporter.export(core.DATA/'studio.sqlite',out/'final.json','adoption-final',True)
(out/'cases.json').write_text(json.dumps(cases,ensure_ascii=False))
