"""Pinned canvas validator against an isolated real Pure SQLite database; no providers."""
import copy, json, os, sys
from pathlib import Path
from fastapi import HTTPException
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
os.environ.update(FUMIAO_DATA=str(out/'runtime'), FUMIAO_SITE='http://localhost:3000', FUMIAO_MUSE_AUTOSTART='0', FUMIAO_FLOW_AUTOSTART='0', FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core
from canvas_api import Document, validate_document, FLOW_MODELS
pid = 'f'*32
def key(n): return f'{n:032x}'
with core.db(True) as con:
    con.executemany('INSERT INTO users(id,name,role) VALUES(?,?,?)', [(1,'admin','admin'),(2,'member','member')])
    private = con.execute("SELECT id FROM workspaces WHERE kind='personal' AND owner=1").fetchone()[0]
    other = con.execute("SELECT id FROM workspaces WHERE kind='personal' AND owner=2").fetchone()[0]
    team = con.execute("SELECT id FROM workspaces WHERE kind='team'").fetchone()[0]
    con.execute('INSERT INTO workspace_members(workspace,user) VALUES(?,2)', (team,))
    con.execute('INSERT INTO canvas_projects(id,title,owner,last_editor,created,updated,workspace) VALUES(?,?,1,1,1,1,?)',(pid,'测试',private))
    for i,kind in enumerate(['ref','ref_video','ref_audio','video','audio'],1):
        con.execute('INSERT INTO media(id,kind,owner,workspace) VALUES(?,?,1,?)',(key(i),kind,private))
    con.executemany("INSERT INTO media(id,kind,owner,workspace) VALUES(?,'ref',?,?)",[(key(6),2,other),(key(7),2,team)])
    for i,wid in [(8,private),(9,other),(10,team)]:
        con.execute("INSERT INTO asset_packs(id,workspace,owner,name,purpose,description,updated) VALUES(?,?,1,'包','subject','',1)",(key(i),wid))
    for i,kind,state,result,wid,node in [(1,'video','done',key(4),private,'n'),(2,'audio','done',key(5),private,'voice:n'),(3,'audio','queued',None,private,'voice:n'),(4,'video','queued',None,private,'n'),(5,'audio','done',key(5),other,'voice:n'),(6,'video','done',key(4),other,'n'),(7,'audio','done',key(5),private,'voice:other'),(8,'image','done',key(1),private,'n'),(9,'video','done',None,private,'n')]:
        con.execute('INSERT INTO jobs(id,owner,kind,status,result,workspace) VALUES(?,1,?,?,?,?)',(i,kind,state,result,wid))
        con.execute("INSERT INTO canvas_job_links(project,node,job,owner,uid,inputs,created) VALUES(?,?,?,1,?,'{}',1)",(pid,node,i,str(i)))
    snapshot = {table:[dict(r) for r in con.execute('SELECT * FROM '+table)] for table in ['users','workspaces','workspace_members','media','jobs','canvas_job_links','asset_packs']}
cases=[]
def node(kind='video',id='n',**values): return dict(id=id,type=kind,x=0,y=0,**values)
def case(name,nodes=None,edges=None,shots=None,user=1,workspace=private):
    value={'nodes':nodes or [],'edges':edges or []}
    if shots is not None: value['shots']=shots
    doc=Document.model_validate(value)
    with core.db() as con:
        actor=con.execute('SELECT * FROM users WHERE id=?',(user,)).fetchone()
        try:
            refs=validate_document(con,pid,doc,actor,workspace)
            status=200; result=sorted([{'node':n,'media':m} for _,n,m in refs],key=lambda r:(r['node'],r['media']))
        except HTTPException as e: status=e.status_code;result={'detail':e.detail}
    cases.append(dict(name=name,document=value,user=user,workspace=workspace,status=status,expected=result))
case('empty')
models=['','gpt-image-2.6-sunburst','muse-image','muse-video','MiniMax H3',*FLOW_MODELS,'unknown']
for model in models:
    for kind in ['image','video']:
        for ratio in ['16:9','9:16','1:1','4:3','3:4','21:9']:
            for seconds in ([0,5,6,15] if model in FLOW_MODELS else range(16)):
                case(f'model:{model}:{kind}:{ratio}:{seconds}',[node(kind,params=dict(model=model,ratio=ratio,seconds=seconds))])
for kind in ['text','sticky']:
    case('non-generation-model-'+kind,[node(kind,params=dict(model='unknown',seconds=0))])
for kind in ['text','image','video','sticky']:
    for target in ['text','image','video','sticky']:
        case('edge-'+kind+'-'+target,[node(kind,'a'),node(target,'b')],[dict(id='e',source='a',target='b')])
case('duplicate-node',[node(),node()],shots=['absent'])
case('duplicate-edge-id',[node('image','a'),node('image','b')],[dict(id='e',source='a',target='b'),dict(id='e',source='b',target='a')])
case('duplicate-edge-pair',[node('image','a'),node('image','b')],[dict(id='e1',source='a',target='b'),dict(id='e2',source='a',target='b')])
case('self-edge',[node('image')],[dict(id='e',source='n',target='n')])
case('missing-source',[node('image')],[dict(id='e',source='',target='n')])
case('missing-target',[node('image')],[dict(id='e',source='n',target='__proto__')])
case('cycle',[node('image','a'),node('image','b')],[dict(id='e1',source='a',target='b'),dict(id='e2',source='b',target='a')])
case('disconnected-cycle',[node('text','unconnected'),node('image','a'),node('image','b')],[dict(id='e1',source='a',target='b'),dict(id='e2',source='b',target='a')])
for count in [9,10]:
    case('image-inputs-'+str(count),[node('image','i'+str(i)) for i in range(count)]+[node()], [dict(id='e'+str(i),source='i'+str(i),target='n') for i in range(count)])
case('text-inputs-unlimited',[node('text','t'+str(i)) for i in range(199)]+[node()], [dict(id='e'+str(i),source='t'+str(i),target='n') for i in range(199)])
case('dag-diamond',[node('image',n) for n in ['a','b','c','d']], [dict(id=str(i),source=a,target=b) for i,(a,b) in enumerate([('a','b'),('a','c'),('b','d'),('c','d')])])
case('prototype-node-names',[node('text','__proto__'),node('image','constructor')],[dict(id='e',source='__proto__',target='constructor')])
for shots in [[],['n'],['n','n'],['other']]:case('shots-'+str(shots),[node()],shots=shots)
case('shots-text-before-invalid-model',[node('text'),node('image','i',params={'model':'unknown'})],shots=['n'])
for i in range(1,8):
    case('reference-'+str(i),[node(params={'h3_refs':[key(i)]})])
    case('node-media-'+str(i),[node(media_id=key(i))])
    case('image-media-'+str(i),[node('image',media_id=key(i))])
case('missing-reference',[node(params={'h3_refs':[key(99)]})])
case('missing-node-media',[node(media_id=key(99))])
case('text-node-media',[node('text',media_id=key(1))])
case('deduplicate-attached',[node(params={'h3_refs':[key(1)]*3,'h3':{'mode':'frames','first_frame':key(1),'last_frame':key(1)}})])
case('video-audio-is-not-a-save-reference',[node(params={'h3':{'mode':'reference','video_audio':[key(99)]}})])
case('retain-cross-role-duplicate',[node('image',media_id=key(1),params={'h3_refs':[key(1)]})])
case('resource-before-model',[node(params={'model':'unknown','h3_refs':[key(99)]})])
for i in [8,9,10,99]:case('pack-'+str(i),[node(asset_packs=[{'id':key(i),'revision':999}])])
case('pack-before-model',[node(asset_packs=[{'id':key(99),'revision':1}],params={'model':'unknown'})])
for i in range(1,11):
    case('narration-'+str(i),[node(narration_job=i)])
    case('active-'+str(i),[node(active_job=i)])
case('pending-voice',[node(narration_pending=3)])
case('duplicate-voice',[node(narration_job=2,narration_pending=2)])
case('text-voice',[node('text',narration_job=2)])
case('voice-before-node-media',[node(narration_job=99,media_id=key(99))])
case('media-before-active',[node(media_id=key(99),active_job=99)])
case('model-before-voice',[node(params={'model':'unknown'},narration_job=99)])
case('reference-before-edge',[node(params={'h3_refs':[key(99)]})],[dict(id='e',source='missing',target='missing')])
case('team-admin',[node('image',media_id=key(7))],workspace=team)
case('team-member',[node('image',media_id=key(7))],user=2,workspace=team)
case('other-personal-member',[node('image',media_id=key(6))],user=2,workspace=other)
case('personal-admin-denied',[node('image',media_id=key(6))],workspace=other)
case('personal-nonowner-denied',[node('image',media_id=key(1))],user=2)
case('wrong-selected-space',[node('image',media_id=key(7))],user=2,workspace=other)
template_models=['MiniMax H3','muse-video',*(k for k,v in FLOW_MODELS.items() if v['kind']=='video' and v['mode'] in ('t2v','omni'))]
templates=[]
for i in range(len(template_models)+1):
    flags={name:index>=i for index,name in enumerate(template_models)}
    templates.append(dict(flags=flags,expected=next((name for name in template_models if flags.get(name)),'')))
(out/'manifest.json').write_text(json.dumps(dict(cases=cases,templates=templates,resources=snapshot,project=pid),ensure_ascii=True))
