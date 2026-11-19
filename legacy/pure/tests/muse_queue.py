"""Two-sided Muse scheduling, upstream phase times, slot reuse and ETA lanes."""
import os,sys,tempfile,time,uuid,json
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
home=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=home.name,FUMIAO_MUSE_AUTOSTART='0',FUMIAO_SITE='http://testserver')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,muse_provider as muse,timing,credits
from server import app
with core.db(True) as c:
 c.execute("INSERT INTO users(name,role) VALUES('queue-test','admin')");c.execute('UPDATE credit_accounts SET balance=100');c.execute('UPDATE credit_prices SET amount=1');key=core.token();c.execute('INSERT INTO sessions VALUES(?,1,?)',(core.hashed(key),core.now()+600))
client=TestClient(app);client.cookies.set('fm_session',key)
def submit():
 r=client.post('/api/jobs',json={'uid':str(uuid.uuid4()),'prompt':'queue test','model':'muse-video','seconds':6});assert r.is_success,r.text;return r.json()['id']
def row(jid):
 with core.db() as c:return dict(c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
ids=[submit() for _ in range(3)];remote={};posts=[]
def request(path,body=None,**kwargs):
 if body is not None:
  tid='task_'+format(len(posts)+1,'020x');posts.append(tid);remote[tid]={'id':tid,'status':'queued','phase':'queued'};return remote[tid]
 return remote[path.rsplit('/',1)[1]]
def complete(job,remote):
 with core.db(True) as c:
  c.execute("UPDATE jobs SET status='done' WHERE id=?",(job['id'],));timing.end_run(c,job,'done')
muse.SCHEDULER.update(capacity=2,maintenance=0,tasks=[])
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',side_effect=request),patch.object(muse,'complete',side_effect=complete):
 muse.tick();assert len(posts)==2;assert [row(i)['status'] for i in ids]==['running','running','queued']
 with core.db() as c:assert all(timing.current_run(c,i)['started'] is None for i in ids[:2])
 stamp=time.time()
 for tid in posts:remote[tid].update(status='processing',phase='generating',started_at=stamp,generating_at=stamp)
 muse.tick();assert len(posts)==2
 remote[posts[0]].update(status='completed',phase='completed',finished_at=time.time())
 muse.tick();assert len(posts)==3 and row(ids[2])['status']=='running' # same tick, not an extra sleep
 assert row(ids[0])['status']=='done'
 with core.db() as c:
  r=timing.current_run(c,ids[0]);assert r['started']==stamp and r['generating']==stamp
  assert json.loads(r['details'])['source']=='provider'
 remote[posts[1]].update(status='completed',phase='completed',finished_at=time.time());remote[posts[2]].update(status='completed',started_at=time.time(),finished_at=time.time())
 muse.tick()
 assert all(row(i)['status']=='done' for i in ids)
# Queued external tasks and maintenance occupy their own capacity; no blind burst.
fourth=submit();muse.SCHEDULER.update(capacity=2,maintenance=1,tasks=[{'id':'external','status':'processing'}])
with patch.object(muse,'ready',return_value=True),patch.object(muse,'request',side_effect=AssertionError('overdispatch')):muse.tick()
assert row(fourth)['status']=='queued'
# Pure virtual scheduling: 2 ready lanes, 3 queued jobs -> 0,0,60, not 0,60,120.
class Estimates:
 def estimate(self,*args):return {'low':60,'median':60,'high':60,'source':'measured','samples':3}
with core.db(True) as c:
 wid=row(fourth)['workspace'];c.execute("UPDATE settings SET value=? WHERE key='muse_health'",(json.dumps({'ready':True,'checked':time.time(),'capacity':2}),))
 samples=[row(fourth)|{'id':100+i} for i in range(3)]
 plans=timing.queue_estimates(c,samples,[],{},Estimates(),time.time())
 assert [plans[i]['median'] for i in (100,101,102)]==[0,0,60],plans
 # Historical provider elapsed corrects backend queue previously mislabelled as prepare.
 j=row(ids[0]);r=timing.current_run(c,ids[0]);c.execute('UPDATE jobs SET created=? WHERE id=?',(stamp-300,j['id']));j['created']=stamp-300
 c.execute('UPDATE job_runs SET queued=?,created=? WHERE id=?',(stamp-300,stamp-300,r['id']))
 muse.sync_timing(c,j,{'status':'completed','created_at':stamp-300,'updated_at':stamp,'elapsed':60})
 r=timing.current_run(c,j['id']);assert abs(r['started']-(stamp-60))<.01
 assert timing.elapsed_detail(dict(r),time.time())['queue']==240
print('PASS two slots, FIFO overflow, immediate refill, no repeated POST, external/maintenance admission, exact phases, parallel ETA and historical wait correction')
