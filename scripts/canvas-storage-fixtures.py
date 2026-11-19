"""Real original canvas API snapshots with isolated SQLite data and no providers."""
import copy,json,os,sys,uuid
from pathlib import Path
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,canvas_api as api,model_policy
from server import app
stamp=1800000000;api.now=lambda:stamp
clients=[]
for name,role in [('admin','admin'),('member','member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    c=TestClient(app,raise_server_exceptions=False)
    r=c.post('/api/register',json=dict(name=name,nickname=name,password='canvas-storage-fixture',code=code));assert r.status_code==200,r.text
    clients.append(c)
def key(n):return f'{n:032x}'
with core.db(True) as con:
    con.execute('INSERT INTO workspace_members(workspace,user) VALUES(1,2)')
    flags=model_policy.read(con)['enabled']
    for i,kind,wid,owner in [(1,'ref',2,1),(2,'video',2,1),(3,'audio',2,1),(4,'ref',3,2),(5,'ref',1,2)]:
        con.execute('INSERT INTO media(id,kind,owner,workspace,size,mime) VALUES(?,?,?,?,0,?)',(key(i),kind,owner,wid,{'ref':'image/png','video':'video/mp4','audio':'audio/wav'}[kind]))
    for i,kind,state,result in [(1,'video','done',key(2)),(2,'video','queued',None),(3,'audio','done',key(3)),(4,'image','done',key(1)),(5,'audio','queued',None)]:
        con.execute('INSERT INTO jobs(id,uid,owner,kind,status,result,workspace,created,updated) VALUES(?,?,1,?,?,?,2,?,?)',(i,str(uuid.uuid4()),kind,state,result,stamp,stamp))
    con.execute("INSERT INTO asset_packs(id,workspace,owner,name,purpose,description,updated) VALUES(?,2,1,'包','subject','',?)",(key(8),stamp))
    con.execute('INSERT INTO asset_pack_media VALUES(?,?,0)',(key(8),key(1)))
aliases={};counter=0;cases=[]
def alias(value):
    if isinstance(value,str):return aliases.get(value,value)
    if isinstance(value,list):return [alias(x) for x in value]
    if isinstance(value,dict):return {k:alias(v) for k,v in value.items()}
    return value
def resolve(value):
    if isinstance(value,str):return next((k for k,v in aliases.items() if v==value),value)
    if isinstance(value,list):return [resolve(x) for x in value]
    if isinstance(value,dict):return {k:resolve(v) for k,v in value.items()}
    return value
def register(value):
    global counter
    counter+=1;aliases[value]='$c'+str(counter)
    return aliases[value]
def snapshot():
    with core.db() as con:
        projects=[]
        for r in con.execute('SELECT * FROM canvas_projects'):
            p=dict(r);p['document']=json.loads(p['document']);projects.append(alias(p))
        refs=[alias(dict(r)) for r in con.execute('SELECT * FROM canvas_media_refs')]
        links=[]
        for r in con.execute('SELECT * FROM canvas_job_links'):
            p=alias(dict(r));p['uid']='$link-uid'+str(p['id']);links.append(p)
    return dict(projects=sorted(projects,key=lambda p:p['id']),refs=sorted(refs,key=lambda r:(r['project'],r['node'],r['media'])),links=sorted(links,key=lambda r:r['id']))
def call(name,action,project=None,body=None,user=1,workspace=None):
    global stamp
    stamp+=1
    operation=dict(action=action,project=project,body=copy.deepcopy(body),user=user,workspace=workspace)
    path='/api/canvases'+('/'+resolve(project) if project else '')
    method={'create':'POST','list':'GET','get':'GET','save':'PUT','duplicate':'POST','remove':'DELETE'}.get(action)
    if action=='save':path+='/document'
    if action=='duplicate':path+='/duplicate'
    if method:
        r=clients[user-1].request(method,path,headers={'X-Workspace-Id':str(workspace)} if workspace is not None else {},**({'json':resolve(body)} if body is not None else {}))
        status=r.status_code
        try:value=r.json()
        except Exception:value=r.text
        if status==200 and action in ('create','duplicate'):register(value['id'])
    elif action=='links':
        with core.db(True) as con:
            for item in body:con.execute('INSERT INTO canvas_job_links(project,node,job,owner,uid,inputs,created) VALUES(?,?,?,?,?,?,?)',(resolve(project),item['node'],item['job'],user,str(uuid.uuid4()),item.get('inputs','{}'),stamp))
        status=200;value={'ok':True}
    elif action=='flags':
        with core.db(True) as con:
            policy=model_policy.read(con);policy['enabled']=body
            con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(policy),))
        status=200;value={'ok':True}
    elif action=='fill':
        while sum(p['workspace']==2 for p in snapshot()['projects'])<200:
            r=clients[0].post('/api/canvases',json={});assert r.status_code==200,r.text;register(r.json()['id'])
        status=200;value={'ok':True}
    else:raise ValueError(action)
    cases.append(dict(name=name,operation=operation,stamp=stamp,status=status,expected=alias(value),state=snapshot()))
    return alias(value)
def node(id='n',kind='text',**values):return dict(id=id,type=kind,x=0,y=0,**values)
call('empty-list','list')
p=call('create-default','create',body={})['id']
call('read-default','get',p)
call('save-raw-text','save',p,dict(expected_revision=1,title='\u001c 原画布😀\u0000 \u3000',document={'nodes':[node(text='原文\u0000 /media/'+key(1))]}))
call('stale-save','save',p,dict(expected_revision=1,title='stale',document={}))
call('foreign-personal','get',p,user=2)
call('get-ignores-selected','get',p,workspace=3)
call('empty-title-precedes-missing','save','f'*32,dict(expected_revision=1,title='\u001c\u3000',document={}))
call('invalid-body-precedes-missing','save','f'*32,dict(expected_revision=1,title='ok',document={'nodes':[{}]}))
call('missing-get','get','invalid')
call('blank-create-precedes-workspace','create',body={'title':' '},workspace='bad')
call('bad-workspace','create',body={},workspace='bad')
call('foreign-workspace','create',body={},workspace=3)
for i,body in enumerate([{'template':'event'},{'template':'product','ratio':'9:16'},{'template':'portrait','title':' 自定义 '},{'template':'event','title':' '},{'title':'\ufeff'},{'title':'😀'*80}]):call('create-variation-'+str(i),'create',body=body)
long='$c6'
call('duplicate-unicode-title','duplicate',long)
team=call('team-create','create',body={'title':'团队'},workspace=1)['id']
call('team-member-edit','save',team,dict(expected_revision=1,title='团队编辑',document={'nodes':[node(text='团队文字')]}),user=2)
call('team-member-get','get',team,user=2)
teamcopy=call('team-member-duplicate','duplicate',team,user=2)['id']
call('team-member-delete-denied','remove',team,user=2)
call('team-copy-owner-delete','remove',teamcopy,user=2)
call('team-list','list',user=2,workspace=1)
private=call('member-personal','create',body={},user=2)['id']
call('admin-cannot-read-personal','get',private)
call('member-list','list',user=2)
call('remove-private','remove',private,user=2)
call('remove-private-again','remove',private,user=2)
call('no-models','flags',body={})
call('disabled-template','create',body={'template':'event'})
call('muse-only','flags',body={'muse-video':True})
call('muse-template','create',body={'template':'product'})
call('all-models','flags',body=flags)
call('save-reference-pack','save',p,dict(expected_revision=2,title='引用',document={'nodes':[node('img','image',media_id=key(1),asset_packs=[{'id':key(8),'revision':999}])]}))
call('duplicate-ref-rollback','save',p,dict(expected_revision=3,title='不能提交',document={'nodes':[node('img','image',media_id=key(1),params={'h3_refs':[key(1)]})]}))
call('cross-space-rollback','save',p,dict(expected_revision=3,title='不能提交',document={'nodes':[node('img','image',media_id=key(4))]}))
call('failed-save-retains-state','get',p)
video=call('video-canvas','create',body={'title':'镜头'})['id']
doc={'nodes':[node('v','video'),node('img','image',media_id=key(1)),node('v2','video',media_id=key(2)),node('v3','video',media_id=key(2)),node('v4','video',media_id=key(2))],'shots':['v','v2']}
call('save-video','save',video,dict(expected_revision=1,title='镜头',document=doc))
call('seed-links','links',video,[{'node':'v','job':1},{'node':'v','job':2},{'node':'voice:v','job':3,'inputs':'{"raw":"\\u0000 /media/'+key(1)+'"}'},{'node':'voice:v','job':5},{'node':'img','job':4}])
call('pending-latest-cover','list')
pendingcopy=call('duplicate-pending-latest','duplicate',video)['id']
doc['nodes'][0].update(active_job=1,narration_job=5,narration_pending=3)
call('select-version-and-voice','save',video,dict(expected_revision=2,title='旁白',document=doc))
call('selected-version-cover','list')
copied=call('duplicate-selected-voice','duplicate',video)['id']
call('copied-voice-get','get',copied)
call('remove-original-with-links','remove',video)
call('copy-survives-original','get',copied)
call('remove-copy','remove',copied)
call('remove-pending-copy','remove',pendingcopy)
call('list-after-deletion','list')
call('fill-limit','fill')
call('create-at-limit','create',body={})
call('duplicate-at-limit','duplicate',p)
call('delete-frees-slot','remove',p)
call('create-after-delete','create',body={})
call('final-limit','create',body={})
voice_values=[None,*range(1,65),127,255,1024,1000000007,1000000015,2**53-1]
voice_orders=[dict(current=a,pending=b,expected=list({a,b}-{None})) for a in voice_values for b in voice_values]
(out/'manifest.json').write_text(json.dumps(dict(initial_flags=flags,cases=cases,voice_orders=voice_orders),ensure_ascii=True))
for c in clients:c.close()
