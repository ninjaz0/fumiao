"""Original canvas submission oracle with real ledger transactions, no provider workers."""
import copy,importlib.util,json,os,sys,uuid
from pathlib import Path
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0',FUMIAO_MUSE_URL='http://127.0.0.1:9',FUMIAO_MUSE_KEY='fixture-unused',FUMIAO_FLOW_URL='http://127.0.0.1:9',FUMIAO_FLOW_KEY='fixture-unused',OPENAI_API_KEY='sk-fixture-unused')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,canvas_api as api,credits,model_policy,flow_catalog
from server import app
stamp=1800000000;api.now=lambda:stamp
clients=[]
for name,role in [('admin','admin'),('member','member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    c=TestClient(app,raise_server_exceptions=False);r=c.post('/api/register',json=dict(name=name,nickname=name,password='canvas-runs-fixture',code=code));assert r.status_code==200,r.text;clients.append(c)
def key(i):return f'{i:032x}'
(core.DATA/'media').mkdir(exist_ok=True)
with core.db(True) as con:
    con.execute('INSERT INTO workspace_members(workspace,user) VALUES(1,2)')
    con.execute('UPDATE credit_prices SET amount=2')
    for wid in [1,2,3]:credits.adjust(con,wid,1000,'fixture',str(uuid.uuid4()),1)
    for i,wid,owner,kind in [(1,2,1,'ref'),(2,2,1,'ref'),(3,3,2,'ref')]:
        con.execute("INSERT INTO media(id,kind,owner,workspace,mime,size,w,h) VALUES(?,?,?,?,'image/png',0,16,16)",(key(i),kind,owner,wid));(core.DATA/'media'/key(i)).write_bytes(b'')
    con.execute("INSERT INTO asset_packs(id,workspace,owner,name,purpose,description,updated) VALUES(?,2,1,'包','subject','包说明',?)",(key(8),stamp));con.execute('INSERT INTO asset_pack_media VALUES(?,?,0)',(key(8),key(2)))
    pricing=credits.prices(con);initial_flags=model_policy.read(con)["enabled"]
spec=importlib.util.spec_from_file_location('exporter',str(Path(__file__).resolve().parent/'export-legacy.py'));exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
exporter.export(core.DATA/'studio.sqlite',out/'export.json','canvas-runs-oracle',True)
cases=[];aliases={};links={}
def normalize(v,k=None):
    if isinstance(v,str):return aliases.get(v,v)
    if isinstance(v,list):return [normalize(x) for x in v]
    if isinstance(v,dict):return {key:normalize(x,key) for key,x in v.items()}
    return v
# Job and link numbers can have PostgreSQL rollback gaps. Match successful objects
# by allocation order; existing imported identities remain literal.
def register_jobs():
    with core.db() as con:
        for row in con.execute('SELECT id FROM jobs ORDER BY id'):
            aliases.setdefault('job:'+str(row['id']),'$job'+str(sum(k.startswith('job:') for k in aliases)+1))
        for row in con.execute('SELECT id FROM canvas_job_links ORDER BY id'):
            links.setdefault(row['id'],'$link'+str(len(links)+1))
def job_id(value):return aliases.get('job:'+str(value),value) if value is not None else None
def response(value):
    v=copy.deepcopy(value)
    if isinstance(v,dict):
        if 'id' in v and isinstance(v['id'],int):v['id']=job_id(v['id'])
        if 'ids' in v:v['ids']=[job_id(i) for i in v['ids']]
    return normalize(v)
def snapshot():
    with core.db() as con:
        jobs=[dict(r) for r in con.execute('SELECT id,owner,workspace,kind,model,prompt,refs,ratio,quality,seconds,sampling_steps,seed,width,height,image_quality,audio_settings,h3_inputs,reference_packs,status FROM jobs ORDER BY id')]
        runs=[dict(r) for r in con.execute('SELECT id,project,node,job,owner,uid,inputs FROM canvas_job_links ORDER BY id')]
        batches=[dict(r) for r in con.execute('SELECT * FROM canvas_run_batches')]
        wallets=[dict(r) for r in con.execute('SELECT * FROM credit_accounts ORDER BY workspace')]
    for j in jobs:
        j['id']=job_id(j['id'])
        for k in ['refs','audio_settings','h3_inputs','reference_packs']:j[k]=json.loads(j[k])
        if j['kind']=='audio':j['seed']='$random-audio-seed'
        # H3 freezes an expiry-free native fingerprint; IDs already public.
    for r in runs:r['id']=links[r['id']];r['job']=job_id(r['job']);r['inputs']=json.loads(r['inputs'])
    for b in batches:b['result']=response(json.loads(b['result']))
    return normalize(dict(jobs=jobs,links=runs,batches=batches,wallets=wallets))
def call(name,action,p=None,n=None,body=None,user=0,workspace=None):
    global stamp
    stamp+=1
    op=dict(action=action,project=normalize(p),node=n,body=copy.deepcopy(body),user=user,workspace=workspace)
    if action in ['create','save','generate','candidates','narrate','list']:
        path='/api/canvases'+('/'+p if p else '')+({'save':'/document','generate':'/nodes/'+str(n)+'/runs','candidates':'/nodes/'+str(n)+'/candidates','narrate':'/nodes/'+str(n)+'/narration','list':'/runs'}.get(action,''))
        r=clients[user].request({'create':'POST','save':'PUT','generate':'POST','candidates':'POST','narrate':'POST','list':'GET'}[action],path,headers={'X-Workspace-Id':str(workspace)} if workspace else {},**({'json':body} if body is not None else {}));status=r.status_code;value=r.json() if status!=500 else 'Internal Server Error'
        if action=='create' and status==200:aliases[value['id']]='$canvas'+str(sum(not k.startswith('job:') for k in aliases)+1)
    elif action=='finish':
        with core.db(True) as con:con.execute("UPDATE jobs SET status='failed' WHERE status='queued'")
        status=200;value={'ok':True}
    elif action=='balance':
        with core.db(True) as con:con.execute('UPDATE credit_accounts SET balance=? WHERE workspace=2',(body,))
        status=200;value={'ok':True}
    elif action=='flags':
        with core.db(True) as con:con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(dict(revision=1,enabled=body)),))
        status=200;value={'ok':True}
    else:raise ValueError(action)
    register_jobs()
    if action!='list':cases.append(dict(name=name,operation=op,stamp=stamp,status=status,expected=response(value),state=snapshot()))
    else:
        # Public runs compare all stable fields; clocks/forecast observations are
        # separately checked for shape and compared with equal persisted jobs.
        if status==200:
            for r in value['runs']:r['id']=job_id(r['id']);r['link_id']=links[r['link_id']]
        cases.append(dict(name=name,operation=op,stamp=stamp,status=status,expected=value))
    return value

def node(id='v',kind='video',**data):return dict(id=id,type=kind,x=0,y=0,**data)
def project(nodes=None,edges=None,user=0,workspace=None):
    p=call('create','create',body={'title':'生成'},user=user,workspace=workspace)['id']
    call('save','save',p,body=dict(title='生成',expected_revision=1,document={'nodes':nodes or [node(prompt='画面',params={'seed':42})],'edges':edges or []}),user=user)
    return p
def run(name,p,n='v',action='generate',**body):return call(name,action,p,n,dict(uid=str(uuid.uuid4()),expected_revision=2,price_revision=pricing['revision'])|body)
p=project([node('t','text',text='\u001c 参考 😀 \u3000'),node('i','image',media_id=key(1)),node(prompt=' 画面 ',params={'seed':2**53-1,'fast_mode':True})],[dict(id='t-v',source='t',target='v'),dict(id='i-v',source='i',target='v')])
uid=str(uuid.uuid4());run('candidate-pair',p,action='candidates',count=2,uid=uid)
run('candidate-replay',p,action='candidates',count=2,uid=uid,expected_revision=1,price_revision=999)
run('candidate-count-conflict',p,action='candidates',count=1,uid=uid)
run('busy',p);call('runs-queued','list',p);call('disable-models','flags',body={});call('runs-disabled-notes','list',p);call('restore-models','flags',body=initial_flags);call('finish','finish');call('runs-terminal','list',p)
run('stale-revision',p,expected_revision=1)
run('ordinary',p);call('finish','finish')
# Native frames ignore connected references; reference mode keeps their order.
for mode in ['frames','reference']:
    p=project([node('i','image',media_id=key(1)),node(prompt='模式',params={'seed':42,'h3_refs':[key(2),key(1)],'h3':{'mode':mode,'first_frame':key(2) if mode=='frames' else None,'last_frame':key(2) if mode=='frames' else None}})],[dict(id='e',source='i',target='v')]);run('h3-'+mode,p);call('finish','finish')
# Muse ignores the fast toggle and pins its supported sampling steps.
for kind,model,params in [('video','muse-video',{'seconds':6,'fast_mode':True,'sampling_steps':50,'seed':42}),('image','muse-image',{}),('image','',{}),('video',next(k for k,v in flow_catalog.MODELS.items() if v['kind']=='video' and v.get('mode')=='t2v'),{'seconds':8,'seed':42})]:
    p=project([node(kind=kind,prompt='插件画面',params=dict(model=model,**params))]);run('plugin-'+(model or 'default-image'),p);call('runs-plugin','list',p);call('finish','finish')
p=project([node(prompt='包画面',params={'seed':42},asset_packs=[dict(id=key(8),revision=1)])]);run('pack-expand',p);call('finish','finish')
p=project([node(prompt='包已变',params={'seed':42},asset_packs=[dict(id=key(8),revision=999)])]);run('pack-stale',p)
p=project([node(narration_text=' 旁白 ',narration_instruction=' 自然 ')])
voiceuid=str(uuid.uuid4());run('voice',p,action='narrate',uid=voiceuid);run('voice-replay',p,action='narrate',uid=voiceuid,expected_revision=1);run('voice-busy',p,action='narrate');call('voice-runs','list',p);call('finish','finish')
run('missing-voice-node',p,n='gone',action='narrate')
p=project();call('balance','balance',body=3);run('atomic-insufficient',p,action='candidates',count=2);call('balance','balance',body=1000);run('after-rollback',p,action='candidates',count=2);call('finish','finish')
for kind in ['text','sticky']:
    q=project([node(kind=kind,text='文字')]);run('wrong-kind-'+kind,q)
q=project([node('t','text',text='   '),node(prompt='提示')],[dict(id='e',source='t',target='v')]);run('empty-source',q)
q=project([node('i','image'),node(prompt='提示')],[dict(id='e',source='i',target='v')]);run('missing-reference',q)
q=project([node(prompt=' ')]);run('empty-prompt',q)
q=project([node(prompt='x'*12000),node('t','text',text='😀')],[dict(id='e',source='t',target='v')]);run('long-prompt',q)
q=project();call('private-denied','generate',q,'v',dict(uid=str(uuid.uuid4()),expected_revision=2),user=1)
team=project(user=1,workspace=1);call('team-run','generate',team,'v',dict(uid=str(uuid.uuid4()),expected_revision=2),user=0,workspace=3)
for body in [{},{'uid':'bad','expected_revision':0},{'uid':str(uuid.uuid4()),'expected_revision':2,'extra':1},{'uid':str(uuid.uuid4()),'expected_revision':2,'count':3}]:
    call('invalid-input','candidates',p,'v',body)
call('all-finish','finish');call('final-runs','list',team)
(out/'manifest.json').write_text(json.dumps(dict(cases=cases),ensure_ascii=True))
for c in clients:c.close()
