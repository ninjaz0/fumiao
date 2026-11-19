"""Quiescent original canvas history and post-import behavior, no real providers."""
import copy,importlib.util,json,os,sqlite3,sys,uuid
from pathlib import Path
from fastapi.testclient import TestClient
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
fixtures=Path(sys.argv[2]) if len(sys.argv)>2 else None
for key in list(os.environ):
    if key.startswith("FUMIAO_"):
        del os.environ[key]
os.environ.update(FUMIAO_DATA=str(out/'runtime'),FUMIAO_SITE='http://localhost:3000',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,canvas_api as api,credits,storyboard_export as exports,model_policy
from server import app
stamp=1800000000;api.now=exports.now=lambda:stamp
clients=[]
for name,role in [('admin','admin'),('member','member')]:
    code=core.token()
    with core.db(True) as con:con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',(code,role,core.now()+90))
    c=TestClient(app,raise_server_exceptions=False)
    r=c.post('/api/register',json=dict(name=name,nickname=name,password='canvas-import-fixture',code=code));assert r.status_code==200,r.text
    clients.append(c)
def request(method,path,body=None,user=0,workspace=None):
    global stamp
    stamp+=1
    r=clients[user].request(method,path,headers={'X-Workspace-Id':str(workspace)} if workspace else {},**({'json':body} if body is not None else {}))
    assert r.status_code==200,(path,r.status_code,r.text)
    return r.json()
def key(n):return f'{n:032x}'
(core.DATA/'media').mkdir(exist_ok=True)
for wid in [1,2,3]:request('POST','/api/admin/credits/adjust',dict(workspace=wid,amount=100,note='导入验证',uid=str(uuid.uuid4())))
with core.db(True) as con:
    con.execute('INSERT INTO workspace_members(workspace,user) VALUES(1,2)')
    con.execute("UPDATE credit_prices SET amount=9 WHERE key LIKE 'MiniMax H3|%'")
    pricing=credits.prices(con);flags=model_policy.read(con)['enabled']
    for i,kind,wid,owner in [(1,'ref',2,1),(2,'video',2,1),(3,'audio',2,1),(4,'ref',3,2),(5,'ref',1,2),(6,'video',2,1)]:
        media=(fixtures/{'ref':'ref.png','video':'shot.mp4','audio':'voice.wav'}[kind]).read_bytes() if fixtures else b''
        con.execute('INSERT INTO media(id,kind,owner,workspace,size,mime) VALUES(?,?,?,?,?,?)',(key(i),kind,owner,wid,len(media),{'ref':'image/png','video':'video/mp4','audio':'audio/wav'}[kind]))
        (core.DATA/'media'/key(i)).write_bytes(media)
    con.execute("INSERT INTO asset_packs(id,workspace,owner,name,purpose,description,updated) VALUES(?,1,2,'历史包','subject','',?)",(key(8),stamp))
    con.execute('INSERT INTO asset_pack_media VALUES(?,?,0)',(key(8),key(5)))
def node(id,kind='video',**values):return dict(id=id,type=kind,x=0,y=0,**values)
def canvas(title,user=0,workspace=None):return request('POST','/api/canvases',{'title':title},user,workspace)['id']
def save(pid,doc,user=0,title='原画布😀\u0000'):
    with core.db() as con:revision=con.execute('SELECT revision FROM canvas_projects WHERE id=?',(pid,)).fetchone()[0]
    return request('PUT','/api/canvases/'+pid+'/document',dict(title=title,document=doc,expected_revision=revision),user)
pid=canvas('主画布');team=canvas('团队',1,1);private=canvas('私有',1);gone=canvas('将被删除')
save(team,{'nodes':[node('img','image',media_id=key(5),asset_packs=[dict(id=key(8),revision=1)])]},1,'原成员画布')
doc={'nodes':[node('v',prompt='历史画面',narration_text='旁白'),node('old',prompt='两候选'),node('text','text',text='原文\u0000 /media/'+key(1))],'edges':[],'shots':['v']}
save(pid,doc)
requests={}
def run(path,body=None):
    draft=dict(uid=str(uuid.uuid4()),expected_revision=2,price_revision=pricing['revision'],**(body or {}));requests[path]=draft
    return request('POST','/api/canvases/'+pid+'/nodes/'+path,draft)
batch=run('old/candidates',{'count':2});video=run('v/runs')['id'];voice=run('v/narration')['id']
with core.db(True) as con:
    # Only completion is synthetic. Source triggers settle the real reservations.
    for jid,result,state in [(batch['ids'][0],None,'failed'),(batch['ids'][1],None,'cancelled'),(video,key(2),'done'),(voice,key(3),'done')]:
        con.execute('UPDATE jobs SET status=?,result=?,updated=? WHERE id=?',(state,result,stamp,jid))
    con.execute('DELETE FROM jobs WHERE id=?',(batch['ids'][1],))
    con.execute('UPDATE canvas_job_links SET id=id+100')
    con.execute('UPDATE canvas_job_links SET inputs=? WHERE job=?',('{ "text":"旁白\\u0000 /media/'+key(1)+'", "revision":2 }',voice))
doc['nodes']=[n for n in doc['nodes'] if n['id']!='old'];doc['nodes'][0].update(active_job=video,narration_job=voice)
save(pid,doc)
# Create original composition snapshots via the real endpoint. Workers never start.
for project,state in [(pid,'done'),(pid,'failed'),(gone,'done')]:
    if project==gone:save(project,{'nodes':[node('shot',media_id=key(2))],'shots':['shot']},title='将被删除')
    with core.db() as con:revision=con.execute('SELECT revision FROM canvas_projects WHERE id=?',(project,)).fetchone()[0]
    e=request('POST','/api/canvases/'+project+'/exports',dict(uid=str(uuid.uuid4()),expected_revision=revision))
    with core.db(True) as con:
        con.execute('UPDATE storyboard_exports SET state=?,result=?,subtitles=?,error=?,updated=? WHERE id=?',(state,key(6) if state=='done' else None,'1\n00:00:00,000 --> 00:00:01,000\n字幕\u0000😀\n','失败\u0000' if state=='failed' else '',stamp,e['id']))
        con.execute('DELETE FROM storyboard_export_refs WHERE export=?',(e['id'],))
request('DELETE','/api/canvases/'+gone)
with core.db(True) as con:
    con.execute('UPDATE storyboard_exports SET rowid=rowid+100')
    con.execute('DELETE FROM workspace_members WHERE workspace=1 AND user=2')
spec=importlib.util.spec_from_file_location('exporter',str(Path(__file__).resolve().parent/'export-legacy.py'));exporter=importlib.util.module_from_spec(spec);spec.loader.exec_module(exporter)
exporter.export(core.DATA/'studio.sqlite',out/'export.json','canvas-import-oracle',True)
initial=json.loads((out/'export.json').read_text());initial_uids={l['uid'] for l in initial['tables']['canvas_job_links']}
guards=[]
for name,sql,expected in [('active-export',"UPDATE storyboard_exports SET state='queued' WHERE rowid=(SELECT min(rowid) FROM storyboard_exports)",'未结算任务'),('missing-batches','DROP TABLE canvas_run_batches','画布表不完整'),('missing-export-refs','DROP TABLE storyboard_export_refs','画布表不完整')]:
    target=out/(name+'.sqlite')
    with sqlite3.connect(core.DATA/'studio.sqlite') as src,sqlite3.connect(target) as dst:src.backup(dst);dst.execute(sql);dst.commit()
    try:exporter.export(target,out/(name+'.json'),'invalid-canvas',True)
    except SystemExit as e:assert expected in str(e),(name,str(e));assert not (out/(name+'.json')).exists();guards.append(name)
    else:raise AssertionError('accepted '+name)
aliases={};cases=[]
def normalize(v):
    if isinstance(v,str):return aliases.get(v,v)
    if isinstance(v,list):return [normalize(x) for x in v]
    if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
    return v
def snapshot():
    with core.db() as con:
        result={name:[dict(r) for r in con.execute('SELECT '+('rowid AS original_order,*' if name=='storyboard_exports' else '*')+' FROM '+name)] for name in ['canvas_projects','canvas_media_refs','canvas_job_links','canvas_run_batches','storyboard_exports','storyboard_export_refs']}
    for row in result['canvas_projects']:row['document']=json.loads(row['document'])
    for row in result['canvas_job_links']:
        if row['uid'] not in initial_uids:row['uid']='$new-link-'+str(row['id'])
    return normalize(result)
def case(action,project=None,user=0,workspace=None,body=None,node=""):
    global stamp
    stamp+=1
    op=dict(action=action,project=normalize(project),user=user,workspace=workspace,body=copy.deepcopy(body),node=node)
    if action=='save' and body['expected_revision']=='current':
        with core.db() as con:body['expected_revision']=con.execute('SELECT revision FROM canvas_projects WHERE id=?',(project,)).fetchone()[0]
        op['body']=copy.deepcopy(body)
    path='/api/canvases'+('/'+project if project else '')+{'save':'/document','duplicate':'/duplicate','runs':'/runs','candidates':'/nodes/'+node+'/candidates','generate':'/nodes/'+node+'/runs','narrate':'/nodes/'+node+'/narration'}.get(action,'')
    r=clients[user].request({'get':'GET','list':'GET','runs':'GET','save':'PUT','duplicate':'POST','candidates':'POST','generate':'POST','narrate':'POST','remove':'DELETE'}[action],path,headers={'X-Workspace-Id':str(workspace)} if workspace else {},**({'json':body} if body is not None else {}))
    value=r.json()
    if action=='duplicate' and r.status_code==200:aliases[value['id']]='$copy'+str(len(aliases)+1)
    cases.append(dict(operation=op,stamp=stamp,status=r.status_code,expected=normalize(value),state=snapshot()))
    return value
for user in [0,1]:
    case('list',user=user);case('list',user=user,workspace=1)
    for p in [pid,private,team,gone]:case('get',p,user=user)
case('get',pid,workspace=3)
case('runs',pid);case('runs',pid,user=1);case('runs',team);case('runs',gone)
case('candidates',pid,node='old',body=requests['old/candidates']|{'expected_revision':1,'price_revision':999})
case('generate',pid,node='v',body=requests['v/runs']|{'expected_revision':1,'price_revision':999})
case('narrate',pid,node='v',body=requests['v/narration']|{'expected_revision':1,'price_revision':999})
missing=next(l for l in initial['tables']['canvas_job_links'] if l['job'] is None)
case('generate',pid,node='old',body=dict(uid=missing['uid'],expected_revision=1))
copy1=case('duplicate',pid)['id'];case('get',copy1)
case('save',pid,body=dict(expected_revision=2,title='冲突',document={}))
case('save',pid,body=dict(expected_revision='current',title='跨空间失败',document={'nodes':[node('foreign','image',media_id=key(4))]}))
case('save',pid,body=dict(expected_revision='current',title='导入后修改',document={'nodes':[node('text','text',text='保持\u0000 /media/'+key(1))]}))
case('duplicate',pid)
case('remove',pid,user=1);case('remove',pid);case('get',pid);case('get',copy1);case('remove',copy1)
case('duplicate',team,user=1);case('duplicate',team);case('list',workspace=1)
case('list')
(out/'manifest.json').write_text(json.dumps(dict(cases=cases,guards=guards,flags=flags),ensure_ascii=True))
for c in clients:c.close()
