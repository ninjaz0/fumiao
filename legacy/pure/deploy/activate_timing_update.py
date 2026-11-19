"""Timing/UI-only cutover: external GPU computation and existing leases stay intact."""
import hashlib,json,os,shutil,sqlite3,subprocess,time,urllib.request
from pathlib import Path
os.umask(0o077)
base=Path('/srv/fumiao');candidate=Path('/tmp/fumiao-candidate').read_text().strip();release=Path(candidate)
check=Path(Path('/tmp/fumiao-check-path').read_text().strip())
manifest=json.loads((release/'release.json').read_text());version=manifest['release']
assert (check/'PASSED').read_text()==version
old=(base/'app').resolve();old_manifest=json.loads((old/'release.json').read_text())
allowed={'timing.py','static/studio.js','static/studio.css','static/canvas.js','static/canvas.css'}
for name,digest in manifest['files'].items():
 assert hashlib.sha256((release/name).read_bytes()).hexdigest()==digest,name
 if name not in allowed:assert digest==old_manifest['files'][name],('Unexpected backend change',name)
backup=base/'rollback'/(version+'-live-video');backup.mkdir(mode=0o700,exist_ok=False)
data=base/'data';saved=backup/'data';saved.mkdir(mode=0o700)
# Immutable object files are hard-linked under the SQLite write lock, then the
# committed DB is snapshotted from a read connection. This keeps the freeze short.
lock=sqlite3.connect(data/'studio.sqlite',timeout=20);lock.row_factory=sqlite3.Row
lock.execute('BEGIN IMMEDIATE')
held=[]
try:
 assert lock.execute("SELECT count(*) FROM jobs WHERE kind='image' AND status='running'").fetchone()[0]==0,'An image request is still active'
 held=[dict(r) for r in lock.execute("SELECT id,uid,ticket,node,attempts,lease FROM jobs WHERE kind='video' AND status='running'")]
 assert all(r['lease'] and r['lease']>time.time()+90 for r in held),'Wait for fresh GPU heartbeat'
 (saved/'objects').mkdir(mode=0o700)
 for row in lock.execute('SELECT id FROM media'):
  os.link(data/'objects'/row['id'],saved/'objects'/row['id'])
 if (data/'avatars').is_dir():
  (saved/'avatars').mkdir(mode=0o700)
  for f in (data/'avatars').iterdir():
   if f.is_file():
    try:os.link(f,saved/'avatars'/f.name)
    except FileNotFoundError:pass
 for name in ('openai.env',):
  if (data/name).exists():shutil.copy2(data/name,saved/name)
 src=sqlite3.connect('file:'+str(data/'studio.sqlite')+'?mode=ro',uri=True)
 dst=sqlite3.connect(saved/'studio.sqlite');src.backup(dst);dst.close();src.close()
finally:
 lock.rollback();lock.close()
(backup/'app').symlink_to(old)
(backup/'held-jobs.json').write_text(json.dumps(held))
# Verify the backup before touching the running web service.
b=sqlite3.connect(saved/'studio.sqlite')
assert b.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
for key,size in b.execute('SELECT id,size FROM media'):assert (saved/'objects'/key).stat().st_size==size
b.close()
# Re-check lease freshness immediately before the bounded restart.
c=sqlite3.connect('file:'+str(data/'studio.sqlite')+'?mode=ro',uri=True)
assert c.execute("SELECT count(*) FROM jobs WHERE kind='image' AND status='running'").fetchone()[0]==0
assert all(r[0] and r[0]>time.time()+90 for r in c.execute("SELECT lease FROM jobs WHERE kind='video' AND status='running'"));c.close()
changed=False;started=time.monotonic()
def switch(path):
 temp=base/'app.queue-next';temp.unlink(missing_ok=True);temp.symlink_to(path);os.replace(temp,base/'app')
try:
 subprocess.run(['systemctl','stop','fumiao'],check=True,timeout=20)
 switch(release);changed=True
 subprocess.run(['systemctl','start','fumiao'],check=True,timeout=15)
 healthy=False
 for _ in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:18732/health',timeout=1) as r:healthy=json.load(r).get('ok')
   if healthy:break
  except OSError:pass
  time.sleep(.25)
 assert healthy,'Health check failed'
 c=sqlite3.connect('file:'+str(data/'studio.sqlite')+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
 assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert not list(c.execute('PRAGMA foreign_key_check'))
 for previous in held:
  current=c.execute('SELECT * FROM jobs WHERE id=?',(previous['id'],)).fetchone()
  assert current and all(current[k]==previous[k] for k in ('uid','ticket','node','attempts')), 'Assignment changed'
  assert current['status'] in ('running','done'), 'Active task did not survive cutover'
  if current['status']=='running':assert current['lease']>time.time(), 'Lease expired'
 c.close()
 proof={'release':version,'web_restart_seconds':round(time.monotonic()-started,2),'preserved_gpu_jobs':[j['id'] for j in held],'backup':str(backup)}
 (backup/'ACCEPTED.json').write_text(json.dumps(proof));print(json.dumps(proof))
except BaseException:
 subprocess.run(['systemctl','stop','fumiao'],timeout=20)
 if changed:switch(old)
 subprocess.run(['systemctl','start','fumiao'],timeout=15)
 raise
