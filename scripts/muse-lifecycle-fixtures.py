"""Run pinned Muse dispatch/poll against fresh SQLite and fake HTTP only."""
import json, os, sys, urllib.error, urllib.request, uuid
from pathlib import Path
root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
os.environ['FUMIAO_DATA'] = str(out / 'runtime')
sys.path.insert(0, str(root / 'legacy/pure'))
import core, credits, timing, muse_provider as muse
core.init_db()
muse.config = lambda: ('http://127.0.0.1:18000', 'local-fixture', 'http://127.0.0.1:18000')
task = 'task_' + 'a' * 32
ack = dict(id=task, status='queued', phase='queued')
current = {}; requests = []; downloads = []
class Response:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, count):
        if 'raw' in current: return current['raw'].encode(current.get('encoding', 'utf-8'))[:count]
        return json.dumps(current.get('body'), ensure_ascii=False).encode()[:count]
class Opener:
    def open(self, req, timeout):
        requests.append(dict(method=req.get_method(), path=req.selector, body=json.loads(req.data) if req.data else None,
                             key=bool(req.get_header('Idempotency-key')), timeout=timeout))
        if current.get('status', 200) != 200:
            raise urllib.error.HTTPError(req.full_url, current['status'], 'fixture', {}, None)
        return Response()
urllib.request.build_opener = lambda *args: Opener()
def download(url, job):
    downloads.append(url)
    raise muse.TransportError()
muse.download = download
cases = []
def snapshot(jid):
    with core.db() as con:
        j = dict(con.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone())
        p = dict(con.execute('SELECT * FROM provider_tasks WHERE job=?', (jid,)).fetchone())
        run = timing.current_run(con, jid)
        wallet = credits.wallet(con, j['workspace'])
        return dict(state=j['status'], note=j['note'], attempts=j['attempts'], uncertain=p['state']=='uncertain',
                    retry=p['retry_at']>0 and j['status']=='queued', held=wallet['reserved'], balance=wallet['balance'],
                    runStatus=run['status'] if run else None, phase=run['phase'] if run else None, remote=bool(p['task_id']))
def scenario(name, actions, kind='image', missing_ref=False):
    global current
    requests.clear(); downloads.clear()
    with core.db(True) as con:
        uid = con.execute("INSERT INTO users(name,salt,pw,role,nickname,avatar) VALUES(?,'fixture','fixture','admin','Fixture','')", (uuid.uuid4().hex,)).lastrowid
        wid = con.execute('SELECT default_workspace FROM users WHERE id=?', (uid,)).fetchone()[0]
        con.execute('UPDATE credit_accounts SET balance=10000 WHERE workspace=?', (wid,))
        con.execute('UPDATE credit_prices SET amount=2')
        jid = con.execute("""INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,image_quality,workspace)
          VALUES(?,?,?,?,?,0,?,0,0,0,'queued',?,?,?,?,'native',?)""",
          (uuid.uuid4().hex,uid,'图 <Picture 1> / <Picture １２> / <Picture ١> / <Picture -1>',json.dumps(['missing'] if missing_ref else []),'16:9',5 if kind=='video' else 0,core.now(),core.now(),kind,'muse-'+kind,wid)).lastrowid
        con.execute('INSERT INTO provider_tasks(job,dispatch_key) VALUES(?,?)', (jid,uuid.uuid4().hex))
        credits.reserve(con,jid)
    snapshots=[]
    for i, action in enumerate(actions):
        current=action
        if i==0:
            try: muse.dispatch_one(100)
            except Exception:
                # The queue loop swallows malformed bodies; its next tick resolves a lost acknowledgement.
                with core.db() as con: job=dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
                muse.uncertain(job)
        else:
            with core.db() as con:
                job=dict(con.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone())
                record=dict(con.execute('SELECT * FROM provider_tasks WHERE job=?',(jid,)).fetchone())
            try: muse.poll(job,record)
            except Exception: pass # Matches run_queue's catch; no subsequent POST.
        snapshots.append(snapshot(jid))
    cases.append(dict(name=name,kind=kind,missingRef=missing_ref,actions=actions,snapshots=snapshots,requests=list(requests),downloads=list(downloads)))
    with core.db(True) as con:
        con.execute("UPDATE jobs SET status='cancelled' WHERE id=? AND status IN ('queued','running')", (jid,))

for status in [400,401,403,404,408,413,422,429,500,502,503,504,302]:
    scenario('submit-http-'+str(status),[dict(status=status)])
for body in [None,[],{},'invalid',{'id':'task_short'},{'id':'task_'+'A'*32},{'id':'task_'+'a'*65},
             {'id':task+'\n'},{'id':123},{'id':task,'task_id':'invalid'},{'id':task,'task_id':[]},
             {'task_id':'task_'+'f'*20},{'id':'task_'+'0'*64},ack,dict(id=task,status='completed')]:
    scenario('submit-body-'+str(len(cases)),[dict(body=body)])
for raw in ['{bad','', '{"id":"'+task+'","ignored":NaN}', '{"id":"'+task+'","ignored":Infinity}', '{"id":"'+task+'","ignored":-Infinity}']:
    scenario('submit-json-'+str(len(cases)),[dict(raw=raw)])
for encoding in ['utf-8-sig','utf-16','utf-16-le','utf-16-be','utf-32','utf-32-le','utf-32-be']:
    scenario('submit-encoding-'+encoding,[dict(raw=json.dumps(ack),encoding=encoding)])
scenario('missing-reference',[dict(body=ack)],missing_ref=True)
scenario('video-submit',[dict(body=ack)],kind='video')
for status in [400,401,403,404,408,429,500,502,503,302]:
    scenario('poll-http-'+str(status),[dict(body=ack),dict(status=status)])
for body in [None,[],{},'invalid',{'status':'failed'}, {'status':'processing'}, {'status':'processing','phase':'preparing'},
             {'status':'processing','phase':None},{'status':'queued'}, {'status':'unknown'}]:
    scenario('poll-body-'+str(len(cases)),[dict(body=ack),dict(body=body)])
for value in [{},{'url':'/v1/media/a'}, {'url':'','result':{'url':'/v1/media/b'}}, {'result':[]}, {'result':['bad']},
              {'result':False}, {'result':1}, {'data':[]}, {'data':[{'url':'/v1/media/a'},{'url':'/v1/media/b'}]},
              {'data':['bad']},{'data':True},{'url':123},{'url':'','data':[]},{'url':'/v1/media/a','result':True},
              {'url':False,'result':{'url':''}}, {'url':None,'result':{'url':None}}]:
    scenario('poll-complete-'+str(len(cases)),[dict(body=ack),dict(body={'status':'completed',**value})])
for status in ['done','success','succeeded']:
    scenario('poll-alias-'+status,[dict(body=ack),dict(body=dict(status=status,url='/v1/media/a'))])
scenario('poll-sequence',[dict(body=ack),dict(body={'status':'processing','phase':'preparing'}),dict(status=503),
                          dict(body={'status':'unknown'}),dict(body={'status':'processing'}),dict(body={'status':'failed'})])
print(json.dumps(cases, ensure_ascii=False))
