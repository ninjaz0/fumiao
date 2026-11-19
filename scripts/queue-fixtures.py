"""Queue oracle from immutable Pure code, using only temporary SQLite data."""
import os,sys,json,sqlite3,random
from pathlib import Path
root=Path(__file__).resolve().parents[1];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ['FUMIAO_DATA']=str(out/'runtime');sys.path.insert(0,str(root/'legacy/pure'))
import timing,model_policy
from flow_catalog import MODELS as FLOW
con=sqlite3.connect(':memory:');con.row_factory=sqlite3.Row
con.executescript('''CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE workspace_model_policy(workspace INTEGER,flags TEXT,revision INTEGER);
CREATE TABLE media(id TEXT PRIMARY KEY,w INTEGER,h INTEGER);CREATE TABLE jobs(id INTEGER,status TEXT,model TEXT);CREATE TABLE provider_tasks(job INTEGER,task_id TEXT);
CREATE TABLE job_runs(id INTEGER PRIMARY KEY,job INTEGER,node INTEGER,kind TEXT,model TEXT,features TEXT,created REAL,queued REAL,started REAL,generating REAL,finalizing REAL,uploading REAL,validating REAL,finished REAL,status TEXT,phase TEXT,step INTEGER,steps INTEGER,progress TEXT,predicted TEXT,details TEXT,valid INTEGER);''')
con.execute("INSERT INTO media VALUES('ref',37,29)");con.execute("INSERT INTO media VALUES('ref2',50,40)")
stamp=10000.
def node(i,**kw):return dict(id=i,hardware=f'gpu-{i}',workflow=timing.WORKFLOW,runtime_id='boot',lastseen=stamp,stage='ready',control='active')|kw
def job(i,**kw):return dict(id=i,node=None,status='queued',kind='video',model='MiniMax H3',refs=[],prompt='queue fixture',width=864,height=480,seconds=5,quality=480,ratio='16:9',sampling_steps=20,workspace=1,created=9000.)|kw
def run(j,n=None,remaining=30,**kw):
 f=timing.features(j,con,n);f['cold']=True if n else None
 return dict(id=j['id'],job=j['id'],node=j['node'],kind=j['kind'],model=j['model'],features=f,created=9000.,queued=9000.,started=9900.,generating=9901.,finalizing=None,uploading=None,validating=None,finished=None,status='running',phase='generating',step=0,steps=f['steps'],progress=[],predicted=dict(source='history',low=100+remaining,median=100+remaining,high=100+remaining),details={},valid=True)|kw
class Fixed:
 def __init__(self,costs):self.costs=costs
 def estimate(self,f,node_id=None):
  entry=self.costs.get(str(node_id),self.costs.get('*'))
  if entry is None:return dict(source='none',samples=0)
  if isinstance(entry,dict):
   if 'cold' in entry:value=entry['cold' if f.get('cold') else 'warm']
   else:value=entry.get(str(f['seconds']))
  else:value=entry
  if value is None:return dict(source='none',samples=0)
  return dict(source='history',samples=8,confidence='medium',low=value,median=value,high=value)
cases=[]
def scenario(name,jobs,nodes=None,runs=None,history=None,costs=None,muse=None,flow=None,images=True,disabled=None,historical=False):
 nodes=nodes or [];runs=runs or {};history=history or [];costs=costs or {};muse=muse or {};flow=flow or {}
 con.executescript('DELETE FROM job_runs;DELETE FROM settings;DELETE FROM workspace_model_policy;DELETE FROM jobs;DELETE FROM provider_tasks;')
 flags={m:not s.get('hidden',False) for m,s in model_policy.MODELS.items()};flags.update({m:False for m in (disabled or [])})
 for key,value in [('model_policy',dict(revision=1,enabled=flags)),('openai_images',dict(enabled=images)),('muse_health',muse),('flow_health',flow)]:con.execute('INSERT INTO settings VALUES(?,?)',(key,json.dumps(value)))
 for r in history+list(runs.values()):
  keys=list(r);con.execute('INSERT INTO job_runs('+','.join(keys)+') VALUES('+','.join('?' for k in keys)+')',[json.dumps(r[k]) if k in ('features','progress','predicted','details') else r[k] for k in keys])
 for j in jobs:
  con.execute('INSERT INTO jobs VALUES(?,?,?)',(j['id'],j['status'],j['model']))
  if j.get('remoteId'):con.execute('INSERT INTO provider_tasks VALUES(?,?)',(j['id'],j['remoteId']))
 expected=timing.queue_estimates(con,jobs,nodes,runs,timing.Estimator(con) if historical else Fixed(costs),stamp)
 sdk_jobs=[]
 for j in jobs:
  refs=[dict(id=k,width=37 if k=='ref' else 50,height=29 if k=='ref' else 40) for k in j['refs']]
  sdk_jobs.append(dict(id=j['id'],node=j['node'],status=j['status'],model=j['model'],kind=j['kind'],remoteId=j.get('remoteId'),enabled=model_policy.enabled(con,j['model'],j['workspace']),input=dict(prompt=j['prompt'],params=j,references=refs)))
 sdk_nodes=[]
 for n in nodes:
  n=dict(n)
  for k in ('ready_models','video_steps','execution_plan','profile','model_profiles'):
   if isinstance(n.get(k),str):n[k]=json.loads(n[k])
  sdk_nodes.append(n)
 cases.append(dict(name=name,jobs=sdk_jobs,nodes=sdk_nodes,runs=runs,history=sorted(history,key=lambda r:r['id'],reverse=True),stamp=stamp,costs=costs,muse=muse,flow=flow,imageEnabled=images,historical=historical,expected=expected))
pending=[job(i) for i in range(1,9)]
scenario('single',pending,[node(1)],costs={'1':100})
scenario('heterogeneous',pending,[node(1),node(2)],costs={'1':100,'2':400})
scenario('unknown',pending,[node(1)],costs={})
scenario('known-and-unknown',pending,[node(1),node(2)],costs={'1':100})
scenario('inactive',pending,[node(1,lastseen=stamp-76),node(2,control='paused'),node(3,control='draining')],costs={'*':100})
scenario('mixed-lengths',[job(i,seconds=5 if i%2 else 10) for i in range(1,9)],[node(1),node(2)],costs={'1':{'5':80,'10':250},'2':{'5':180,'10':90}})
scenario('cancelled',[job(1,status='cancelled'),*pending[1:]],[node(1)],costs={'1':100})
scenario('paused-model',pending,[node(1)],costs={'1':100},disabled=['MiniMax H3'])
scenario('100-jobs-8-workers',[job(i,seconds=5 if i%2 else 10,refs=['ref'] if i%3 else []) for i in range(1,101)],[node(i) for i in range(1,9)],costs={str(i):{'cold':100*i,'warm':60*i} for i in range(1,9)})
for phase in ['generating','finalizing','uploading','validating']:
 active=job(1,status='running',node=1);r=run(active,node(1),phase=phase,finalizing=stamp-5 if phase!='generating' else None,predicted={} if phase!='generating' else dict(low=130,median=140,high=150,source='history'))
 scenario('busy-'+phase,[active,*pending[1:]],[node(1,stage='busy')],runs={1:r},costs={'1':100})
for state in ['overdue','no-forecast','live-progress','stale-live','invalid-live']:
 active=job(1,status='running',node=1);r=run(active,node(1),predicted={},step=3,progress=[[1,stamp-60],[2,stamp-50],[3,stamp-40]])
 if state=='overdue':r.update(predicted=dict(low=1,median=1,high=1,source='history'),progress=[])
 if state=='no-forecast':r.update(progress=[])
 if state=='invalid-live':r.update(valid=False)
 scenario(state,[active,*pending[1:]],[node(1,stage='busy',lastseen=stamp-76 if state=='stale-live' else stamp)],runs={1:r})
for mode in ['t2v','i2v','r2v']:
 done=job(50,status='done',node=1,refs=[] if mode=='t2v' else ['ref'] if mode=='i2v' else ['ref','ref2']);old=run(done,node(1),finished=stamp-1,status='done')
 scenario('cache-'+mode,[job(1),job(2),job(3,refs=['ref']),job(4,refs=['ref','ref2'])],[node(1)],history=[old],costs={'1':{'cold':200,'warm':50}})
for stage,lastseen in [('busy',stamp-2),('busy',stamp+1),('ready',stamp)]:
 done=job(50,status='done',node=1);old=run(done,node(1),finished=stamp-1,status='done')
 scenario('idle-after-finish-'+stage+str(lastseen),pending,[node(1,stage=stage,lastseen=lastseen)],history=[old],costs={'1':100})
for workflow,steps in [(timing.WORKFLOW,[20]),('h3-v3-rocm-qkv-safe-fast4-i2v768',[4]),('h3-v5-rocm-qkv-safe-turbo4',[4,20]),('h3-v6-native-inputs-turbo4',[4,20,32,50])]:
 scenario('worker-versions-'+workflow,[job(1,sampling_steps=20),job(2,sampling_steps=4),job(3,sampling_steps=32),job(4,h3_inputs={'mode':'frames','last_frame':'ref'},refs=['ref'])],[node(1,workflow=workflow,video_steps=json.dumps(steps))],costs={'1':{'cold':200,'warm':50}})
for accept,stale in [(True,False),(False,False),(True,True)]:
 lanes=[dict(model=m,stage='ready',lastseen=stamp-(76 if stale and m=='breeze-tts-2' else 0),runtime_id='boot',can_accept=accept) for m in ['MiniMax H3','breeze-tts-2']]
 scenario('parallel-'+str(accept)+str(stale),[job(1),job(2,kind='audio',model='breeze-tts-2'),job(3),job(4,kind='audio',model='breeze-tts-2')],[node(1,execution_plan={'mode':'parallel'},lanes=lanes)],costs={'1':100})
for enabled in [True,False]:
 active=job(1,kind='image',model='gpt-image-2.6-sunburst',status='running');r=run(active,remaining=40)
 scenario('image-slot-'+str(enabled),[active,job(2,kind='image',model=active['model']),job(3)],[node(1)],runs={1:r},images=enabled,costs={'None':60,'1':100})
flow_model=next(m for m,s in FLOW.items() if not s.get('hidden') and s['kind']=='video')
remote=[job(i,model='muse-video',seconds=6) for i in range(1,5)]
for capacity in [0,1,2,16,20]:
 for checked in [stamp,stamp-89,stamp-90]:scenario('muse-capacity-'+str(capacity)+'-'+str(checked),remote,muse=dict(ready=True,checked=checked,capacity=capacity),costs={'None':60})
for maintenance,external in [(0,0),(1,0),(0,1),(1,1),(0,3)]:
 active=job(10,status='running',model='muse-video',remoteId='ours');r=run(active,remaining=50)
 scenario('muse-external-'+str(maintenance)+str(external),[active,*remote],runs={10:r},muse=dict(ready=True,checked=stamp,capacity=2,maintenance=maintenance,tasks=[dict(id='ours')]+[dict(id='outside-'+str(i)) for i in range(external)]),costs={'None':60})
for phase in ['queued','generating','finalizing']:
 active=job(10,status='running',model='muse-video',remoteId='ours');r=run(active,remaining=50,phase=phase,started=None if phase=='queued' else 9900.)
 scenario('muse-'+phase,[active,*remote],runs={10:r},muse=dict(ready=True,checked=stamp,capacity=2),costs={'None':60})
scenario('muse-image-paused',[job(1,kind='image',model='muse-image'),*remote[1:]],images=False,muse=dict(ready=True,checked=stamp,capacity=2),costs={'None':60})
for busy in [False,True]:
 for ready in [False,True]:
  scenario('flow-'+str(busy)+str(ready),([job(10,model=flow_model,status='running')] if busy else [])+[job(1,model=flow_model),job(2,model=flow_model)],flow=dict(ready=ready,checked=stamp),costs={'None':60})
scenario('mixed-providers',[job(1),job(2,model='muse-video'),job(3,model=flow_model),job(4,kind='image',model='gpt-image-2.6-sunburst'),job(5,kind='audio',model='breeze-tts-2')],[node(1,ready_models=json.dumps(['MiniMax H3','breeze-tts-2']))],muse=dict(ready=True,checked=stamp,capacity=2),flow=dict(ready=True,checked=stamp),costs={'None':60,'1':100})
rng=random.Random(173)
for case in range(35):
 ns=[node(i,lastseen=stamp-rng.choice([0,50,76]),stage=rng.choice(['ready','busy']),control=rng.choice(['active','active','paused'])) for i in range(1,rng.randint(2,6))]
 js=[job(i,seconds=rng.choice([5,10,15]),refs=rng.choice([[],['ref'],['ref','ref2']])) for i in range(1,rng.randint(5,25))]
 scenario('seeded-'+str(case),js,ns,costs={str(n['id']):rng.choice([None,20.125,80.675,140.5,400.0]) for n in ns})
for count in [1,2,8]:
 ns=[node(i) for i in range(1,count+1)];history=[]
 for n in ns:
  for refs in [[],['ref']]:
   for cold in [False,True,True,True]:
    old=job(1000+len(history),node=n['id'],status='done',refs=refs)
    r=run(old,n,status='done',finished=9900.+(200 if cold else 50)*n['id']);r['features']['cold']=cold;history.append(r)
 scenario('historical-'+str(count),[job(i,refs=[] if i%2 else ['ref']) for i in range(1,40)],ns,history=history,historical=True)
rounds=[dict(value=v,expected=round(v,2)) for v in [0.,-0.,2.675,1.005,1.015,-2.675,1e-6,1e20,80.675,15.125,15.375]]
(out/'queue.json').write_text(json.dumps(dict(cases=cases,rounds=rounds),ensure_ascii=False));print(len(cases))
