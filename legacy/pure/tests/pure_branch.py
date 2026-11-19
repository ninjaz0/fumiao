"""No Notebook endpoints; normal accounts, assets and canvas still work."""
import os,sys,tempfile,io
from pathlib import Path
root=Path(__file__).resolve().parents[1];sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(root))
import core
from server import app
from fastapi.testclient import TestClient
from PIL import Image
c=TestClient(app)
paths=['/api/lab/state','/api/lab/instances','/api/lab/agent-manifest','/connect/lab-agent.py','/lab-runtime/example/lab','/static/lab.js','/static/lab.css']
for p in paths:assert c.get(p).status_code==404,(p,c.get(p).status_code)
assert not any('/lab' in getattr(r,'path','') for r in app.routes)
with core.db() as db:assert not db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lab_%'").fetchall()
code=core.token()
with core.db(True) as db:db.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",(code,core.now()+60))
r=c.post('/api/register',json={'name':'pure-review','nickname':'验收','password':'isolated-pure-testing-2026','code':code});assert r.is_success,r.text
r=c.get('/api/state');assert r.status_code==200
page=c.get('/studio');assert page.status_code==200 and b'/static/lab.' not in page.content
assert 'unsafe-eval' not in page.headers['Content-Security-Policy'] and 'notebooks.nvmes.com' not in page.headers['Content-Security-Policy']
assert c.post('/api/workspaces',json={'name':'bad-origin'},headers={'Origin':'https://untrusted.invalid'}).status_code==403
raw=io.BytesIO();Image.new('RGB',(64,32),'#223344').save(raw,'PNG')
a=c.post('/api/assets',content=raw.getvalue());assert a.is_success,a.text
assert c.post('/api/asset-packs',json={'name':'保留素材包','media':[a.json()['id']],'purpose':'scene'}).is_success
assert c.post('/api/canvases',json={'title':'保留画布'}).is_success
assert c.get('/api/fmworker/account').is_success
# An old database is accepted without destructive table cleanup.
with core.db(True) as db:db.execute('CREATE TABLE lab_legacy_saved_files(id TEXT PRIMARY KEY)');db.execute("INSERT INTO lab_legacy_saved_files VALUES('keep-me')")
core.init_db()
with core.db() as db:assert db.execute('SELECT id FROM lab_legacy_saved_files').fetchone()[0]=='keep-me'
print('PASS removed routes/artifacts/schema, preserved CSP/CSRF, registration/workspace/assets/canvas/worker APIs, non-destructive old database compatibility')
