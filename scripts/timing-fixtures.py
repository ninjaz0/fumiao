"""Deterministic expected values from the immutable original timing implementation."""
import sys, os, json, sqlite3, random
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ['FUMIAO_DATA']=str(out/'runtime')
sys.path.insert(0,str(root/'legacy/pure'))
import timing
from flow_catalog import MODELS as FLOW
con=sqlite3.connect(':memory:');con.row_factory=sqlite3.Row
con.executescript('''CREATE TABLE job_runs(id INTEGER PRIMARY KEY,job INTEGER,run_key TEXT UNIQUE,attempt INTEGER,node TEXT,kind TEXT,model TEXT,features TEXT,created REAL,queued REAL,started REAL,generating REAL,finalizing REAL,uploading REAL,validating REAL,finished REAL,status TEXT,phase TEXT,step INTEGER DEFAULT 0,steps INTEGER DEFAULT 20,progress TEXT DEFAULT '[]',predicted TEXT DEFAULT '{}',details TEXT DEFAULT '{}',valid INTEGER DEFAULT 1);
CREATE TABLE media(id TEXT PRIMARY KEY,w INTEGER,h INTEGER);''')
con.execute("INSERT INTO media VALUES('ref',37,29)")
base={'kind':'video','executor':'gpu','model':'MiniMax H3','workflow':timing.WORKFLOW,'width':864,'height':480,'seconds':5,'steps':20,'video_mode':'t2v','quality':'480','refs':0,'ref_pixels':0,'hardware':'gpu-A','profile':{},'runtime_id':'boot-A','cold':False}
policy={'version':1,'geometry':'pixels','hardware':True,'scaleSteps':True,'workflowAliases':{w:'h3-native-qkv-safe' for w in [timing.WORKFLOW,'h3-v4-rocm-qkv-safe-configurable','h3-v5-rocm-qkv-safe-turbo4','h3-v6-native-inputs-turbo4']}}
def run(i,f=None,duration=100,**kw):
 r={'id':i,'job':None,'run_key':str(i),'attempt':1,'node':'A','features':dict(f or base),'created':1000.,'queued':1000.,'started':1100.,'generating':1110.,'finalizing':None,'uploading':None,'validating':None,'finished':1100.+duration,'status':'done','phase':'done','step':0,'steps':20,'progress':[],'predicted':{},'details':{},'valid':True};r.update(kw);return r
jsons=('features','progress','predicted','details')
def set_rows(rows):
 con.execute('DELETE FROM job_runs')
 for r in rows:
  keys=list(r);con.execute('INSERT INTO job_runs('+','.join(keys)+') VALUES('+','.join('?' for k in keys)+')',[json.dumps(r[k]) if k in jsons else r[k] for k in keys])
cases=[]
def estimate(name,rows,target=None,node=None,p=policy):
 target=dict(target or base);set_rows(rows)
 cases.append({'name':name,'operation':'estimate','samples':rows,'target':target,'node':node,'policy':p,'expected':timing.Estimator(con).estimate(target,node)})
for count in [0,1,3,4,5,14,15,30,40,501]:estimate('sample-count-'+str(count),[run(i+1,duration=50+i%13+.5) for i in range(count)])
for key,value in [('seconds',15),('hardware','gpu-B'),('workflow','other'),('quality','768'),('refs',1),('video_mode','i2v'),('model','unknown'),('width',4096),('height',500),('runtime_id','boot-B'),('cold',True),('steps',32)]:
 estimate('cohort-'+key,[run(i+1) for i in range(16)],base|{key:value},'A')
for stamp in [0,1,2,15]:
 estimate('calibration-'+str(stamp),[run(i+1,node='A' if i<stamp else 'B',duration=100 if i<stamp else 300) for i in range(16)],node='A')
for source,target in [(True,False),(False,True),(None,False),(False,None)]:estimate('cold-'+str(source)+'-'+str(target),[run(1,base|{'cold':source})],base|{'cold':target})
for hardware in ['', 'gpu-A']:
 for node in [None,'A','B']:estimate('unknown-hardware-'+hardware+str(node),[run(1,base|{'hardware':''})],base|{'hardware':hardware},node)
for count in [0,1,5]:
 rows=[run(1,base|{'steps':20},duration=100,details={'generate_s':80})]+[run(i+2,base|{'steps':32},duration=240) for i in range(count)]
 estimate('steps-'+str(count),rows,base|{'steps':32})
for val in [None,0,101,80]:estimate('invalid-step-duration-'+str(val),[run(1,details={'generate_s':val})],base|{'steps':32})
for status,valid in [('failed',True),('cancelled',True),('interrupted',True),('done',False),('legacy',False)]:estimate(status+str(valid),[run(1,status=status,valid=valid,started=None if status=='legacy' else 1100.)])
estimate('precise-over-legacy',[run(1,status='legacy',started=None,duration=250),run(2,duration=90)])
estimate('workflow-alias',[run(1,base|{'workflow':'h3-v4-rocm-qkv-safe-configurable'})])
estimate('tail-median',[run(1,duration=100,finalizing=1180),run(2,duration=100,uploading=1190,details={'finalize_s':5})])
for executor in ['muse-api','flow-api']:
 f=base|{'executor':executor,'width':0,'height':0,'native_ratio':'16:9','hardware':executor,'cold':None}
 for ratio in ['16:9','9:16']:estimate(executor+ratio,[run(1,f)],f|{'native_ratio':ratio},p={'version':1,'geometry':'native','hardware':False,'scaleSteps':False})
for size in [10,50,90,100,180,181,400]:
 f=base|{'kind':'audio','width':100,'height':1,'seconds':0,'steps':0,'video_mode':'tts'}
 estimate('speech-'+str(size),[run(1,f)],f|{'width':size})
rng=random.Random(2704)
for case in range(60):
 rows=[run(i+1,base|{'width':rng.choice([800,864,1000]),'cold':rng.choice([True,False,None])},duration=rng.randrange(10,700)/2,node=rng.choice(['A','B']),status=rng.choice(['done','done','legacy','failed']),valid=rng.choice([True,True,False])) for i in range(1,50)]
 estimate('mixed-'+str(case),rows,node='A' if case%2 else None)
for phase in ['preparing','generating','finalizing','uploading','validating','done']:
 for stamp in [1110,1130,1190,1800]:
  r=run(1,status='running',phase=phase,finished=None,step=3,steps=20,progress=[[0,1110],[1,1120],[2,1130],[3,1140]],predicted={'low':80,'median':100,'high':130,'source':'history','tail':25},finalizing=1150 if phase in ('finalizing','uploading','validating','done') else None)
  cases.append({'name':phase+str(stamp),'operation':'remaining','run':r,'stamp':stamp,'expected':timing.remaining(r,stamp)})
for r in [None,run(1,started=None,status='cancelled'),run(1,started=None,status='legacy'),run(1,started=None,status='running',phase='queued',finished=None),run(1,finalizing=1180,uploading=1190,validating=1195),run(1,finished=1202.5,generating=None,details={'generate_s':20.5,'prepare_s':21.5},predicted={'median':100})]:
 cases.append({'name':'elapsed-'+str(len(cases)),'operation':'elapsed','run':r,'stamp':1300,'expected':timing.elapsed_detail(r,1300)})
for valid in [True,False]:
 for phase in ['generating','finalizing']:
  r=run(1,finished=None,status='running',phase=phase,step=3,steps=20,progress=[[1,1110],[2,1120],[3,1130]],predicted={},valid=valid,finalizing=1130 if phase=='finalizing' else None)
  set_rows([])
  cases.append({'name':'planning-'+phase+str(valid),'operation':'planning','samples':[],'target':base,'node':'A','policy':policy,'runs':[r],'stamp':1140,'expected':timing.planning_prediction(timing.Estimator(con),base,'A',{1:r},1140)})
# Provider-specific feature extraction is compared separately from the platform math.
features=[]
models={'MiniMax H3':'video','breeze-tts-2':'audio','muse-image':'image','muse-video':'video','gpt-image-2.6-sunburst':'image'}|{m:s['kind'] for m,s in FLOW.items()}
for model,kind in models.items():
 variants=[{}, {'refs':['ref']},{'sampling_steps':4,'quality':768,'h3_inputs':{'mode':'frames','last_frame':'ref'},'refs':['ref']}] if model=='MiniMax H3' else [{}]
 for change in variants:
  job={'id':1,'kind':kind,'model':model,'prompt':'你好 world 😀','ratio':'16:9','quality':480,'seconds':5,'width':864,'height':480,'sampling_steps':20,'refs':[],'image_quality':'medium'}|change
  node={'id':'A','runtime_id':'boot-A','workflow':timing.WORKFLOW,'hardware':'gpu-A'}
  set_rows([])
  context={'model':model,'kind':kind,'input':{'prompt':job['prompt'],'params':job,'references':[{'id':'ref','width':37,'height':29}] if job['refs'] else []},'node':node}
  features.append({'context':context,'expected':timing.features(job,con,node)})
# Hash the float fields accepted by the original worker protocol, including GB
# values that lose their float/integer distinction in JSON and JavaScript.
for vram in [0.0,80.0,79.95,0.00001,0.0001,2048.0]:
 profile={'backend':'cuda','gpu_name':' A100 GPU 中文 ','vram_gib':vram,'used_gpus':1,'available_gpus':8,'runtime':' CUDA 12.4 ','driver':'550.0','torch_version':'2.5','precision':'BF16','attention':'SDPA','memory_mode':'Resident','cpu_cores':32,'ram_gib':256.0}
 for model,kind in [('MiniMax H3','video'),('breeze-tts-2','audio')]:
  job={'id':1,'kind':kind,'model':model,'prompt':'hello','ratio':'16:9','quality':480,'seconds':5,'width':864,'height':480,'sampling_steps':20,'refs':[]}
  node={'id':'A','runtime_id':'boot-A','profile':profile}
  set_rows([])
  context={'model':model,'kind':kind,'input':{'prompt':job['prompt'],'params':job,'references':[]},'node':node}
  features.append({'context':context,'expected':timing.features(job,con,node)})

lifecycle=[]
sequences={
 'success':[['start',1100],['start',1101],['observe',1110,{'step':0,'steps':20}],['observe',1120,{'step':1,'steps':20}],['observe',1130,{'step':2,'steps':20}],['observe',1140,{'step':2,'steps':20}],['observe',1141,{'step':1,'steps':20}],['observe',1150,{'step':10,'steps':32}],['observe',1160,{'step':20,'steps':20}],['phase',1165,'uploading'],['phase',1166,'generating'],['phase',1168,'validating'],['end',1170,'done'],['end',1171,'done']],
 'telemetry':[['start',1100],['observe',1120,{'timing':{'prepare_s':5,'generate_s':10,'finalize_s':3,'cold':False,'peak_vram_bytes':2**30}}],['observe',1121,{'timing':{'generate_s':172800,'peak_allocated_vram_bytes':1}}],['end',1140,'done']],
 'recovered':[['start',1100],['observe',1110,{'timing':{'recovered':True}}],['end',1120,'done']],
 # Worker TimingReport validates duration fields as floats before apply_telemetry.
 'telemetry-float-boundary':[['start',1100],['observe',1100,{'timing':{'prepare_s':45.0,'generate_s':2e-15,'finalize_s':2e-15}}],['end',1120,'done']],
 'interrupted-resume':[['start',1100],['end',1120,'interrupted'],['observe',1130,{'step':1,'steps':20}],['end',1150,'done']],
 'interrupted-complete':[['start',1100],['end',1120,'interrupted'],['end',1150,'done']],
 'queued-cancel':[['end',1110,'cancelled']],
 'retry-cancel':[['start',1100],['end',1120,'interrupted'],['queue',1121],['end',1130,'cancelled']],
 'retry':[['start',1100],['end',1120,'interrupted'],['queue',1121],['start',1140],['end',1150,'failed']],
}
for name,actions in sequences.items():
 set_rows([])
 job={'id':1,'node':'A','kind':'video','model':'MiniMax H3','prompt':'private prompt never in samples','ratio':'16:9','quality':480,'seconds':5,'width':864,'height':480,'sampling_steps':20,'refs':[],'created':1000.,'attempts':1,'ticket':'first','status':'queued'}
 node={'id':'A','runtime_id':'boot-A','workflow':timing.WORKFLOW,'hardware':'gpu-A'}
 snapshots=[]
 for action in actions:
  op,stamp,*args=action
  if op=='start':timing.start_run(con,job,node,stamp);job['status']='running'
  elif op=='observe':timing.observe(con,job,args[0],stamp)
  elif op=='phase':timing.mark_phase(con,job,args[0],stamp)
  elif op=='end':timing.end_run(con,job,args[0],stamp);job['status']=args[0]
  elif op=='queue':job.update(status='queued',ticket='second',attempts=2)
  rows=[]
  for row in con.execute('SELECT * FROM job_runs ORDER BY id'):
   r=dict(row)
   for key in ('id','job','run_key','node','kind','model'):r.pop(key)
   for key in jsons:r[key]=json.loads(r[key])
   r['valid']=bool(r['valid']);rows.append(r)
  snapshots.append(rows)
 lifecycle.append({'name':name,'actions':actions,'snapshots':snapshots,'node':node})
(out/'manifest.json').write_text(json.dumps({'cases':cases,'features':features,'lifecycle':lifecycle},ensure_ascii=False))
# Export checks use two disposable snapshots, never the user's SQLite database.
con.executescript("CREATE TABLE nodes(token TEXT);INSERT INTO nodes VALUES('node-secret-sentinel');CREATE TABLE settings(key TEXT,value TEXT);INSERT INTO settings VALUES('provider_key','provider-secret-sentinel');")
con.commit()
with sqlite3.connect(out/'timing.sqlite') as exported:con.backup(exported)
con.execute("UPDATE job_runs SET status='running' WHERE id=(SELECT max(id) FROM job_runs)");con.commit()
with sqlite3.connect(out/'active.sqlite') as active:con.backup(active)
print(len(cases),len(features),len(lifecycle))
