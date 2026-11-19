"""Absolute provider clock oracle; immutable Pure code and disposable SQLite only."""
import os,sys,json,sqlite3
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parents[1];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ['FUMIAO_DATA']=str(out/'runtime');sys.path.insert(0,str(root/'legacy/pure'))
import timing,muse_provider
con=sqlite3.connect(':memory:');con.row_factory=sqlite3.Row
con.execute('''CREATE TABLE job_runs(id INTEGER PRIMARY KEY,job INTEGER,run_key TEXT,attempt INTEGER,node TEXT,kind TEXT,model TEXT,features TEXT,created REAL,queued REAL,started REAL,generating REAL,finalizing REAL,uploading REAL,validating REAL,finished REAL,status TEXT,phase TEXT,step INTEGER,steps INTEGER,progress TEXT,predicted TEXT,details TEXT,valid INTEGER)''')
job=dict(id=1,created=1000.,model='muse-video',kind='video',refs=[],ratio='16:9',seconds=5,prompt='isolated timing fixture')
initial=dict(id=1,job=1,run_key='fixture',attempt=1,node=None,kind='video',model='muse-video',features=timing.features(job,con),created=1000.,queued=1000.,started=1100.,generating=None,finalizing=None,uploading=None,validating=None,finished=None,status='running',phase='preparing',step=0,steps=0,progress=[],predicted=dict(source='history',low=50,median=60,high=80),details={},valid=True)
fields=('started','generating','finalizing','uploading','validating','finished','status','phase','details')
jsons=('features','progress','predicted','details');cases=[]
def scenario(name,actions,changes=None):
 row=initial| (changes or {});con.execute('DELETE FROM job_runs');keys=list(row)
 con.execute('INSERT INTO job_runs('+','.join(keys)+') VALUES('+','.join('?' for _ in keys)+')',[json.dumps(row[k]) if k in jsons else row[k] for k in keys])
 snapshots=[]
 for stamp,remote in actions:
  with patch('muse_provider.time.time',return_value=stamp):muse_provider.sync_timing(con,job,remote)
  r=dict(con.execute('SELECT * FROM job_runs').fetchone());view={k:json.loads(r[k]) if k in jsons else r[k] for k in fields}
  snapshots.append(dict(record=view,timing=timing.elapsed_detail(r,stamp),eta=timing.remaining(r,stamp)))
 cases.append(dict(name=name,initial={k:row[k] for k in fields},actions=actions,snapshots=snapshots,predicted=row['predicted']))
scenario('queued-to-complete',[[1110,dict(status='queued',phase='queued',accepted_at=1100)],[1120,dict(status='queued',phase='queued')],[1160,dict(status='processing',started_at=1140,generating_at=1145)],[1170,dict(status='completed',phase='completed',started_at=1140,generating_at=1145,finished_at=1165,updated_at=1166,elapsed=26)]])
scenario('accepted-and-provider-queue',[[1140,dict(status='processing',started_at=1120,accepted_at=1110)]],dict(started=None,phase='queued'))
scenario('preserve-admission',[[1160,dict(status='processing',started_at=1150)],[1180,dict(status='processing',started_at=1160)]],dict(details=dict(admitted_at=1090,source='worker',generate_s=3)))
for elapsed in [0,-1,1,55.5,1000,None,'60']:
 scenario('elapsed-'+str(elapsed),[[1300,dict(status='completed',created_at=1020,updated_at=1290,elapsed=elapsed)]])
for started in [997.99,998,999.5,1000,1100,1302,1302.01,0,None,'1200',False]:
 scenario('start-bound-'+str(started),[[1300,dict(status='processing',started_at=started)]])
for status in ['queued','processing','completed','failed','done','success','other']:
 for phase in [None,'queued','preparing','generating','finalizing','completed','failed','unknown','',True,False,1,[],{'unknown':'private-sentinel'}]:
  remote=dict(status=status,started_at=1200)
  if phase is not None:remote['phase']=phase
  scenario('phase-'+status+'-'+str(phase),[[1300,remote]])
for status in ['done','failed','cancelled','interrupted']:
 scenario('terminal-'+status,[[1300,dict(status='processing',started_at=1200,phase='generating',generating_at=1210,finished_at=1250)]],dict(status=status,phase='done' if status=='done' else 'finalizing',finished=1260))
for generating in [None,0,1,1190,1200,1302,1302.01,'invalid',True,[],{'unknown':'private-sentinel'}]:
 remote=dict(status='processing',started_at=1200)
 if generating is not None:remote['generating_at']=generating
 scenario('replace-local-generation-'+str(generating),[[1300,remote]],dict(generating=1110,phase='generating'))
scenario('invalid-start-fallback',[[1300,dict(status='completed',started_at=1400,updated_at=1290,elapsed=30)]])
for started in ['invalid',True,[],{'unknown':'private-sentinel'}]:
 scenario('invalid-start-type-'+str(started),[[1300,dict(status='completed',started_at=started,updated_at=1290,elapsed=30)]])
scenario('queue-without-phase',[[1300,dict(status='queued')]])
scenario('ignore-private-fields',[[1300,dict(status='processing',started_at=1200,api_key='private-sentinel',prompt='private-sentinel',response={'token':'private-sentinel'})]])
(out/'provider-clock.json').write_text(json.dumps(cases,ensure_ascii=False));print(len(cases))
