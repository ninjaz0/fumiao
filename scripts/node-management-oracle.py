"""Start only the pinned HTTP app with temporary accounts and SQLite data."""
import hashlib
import os
from pathlib import Path
import runpy
import socket
import sys
import tarfile

from fastapi.testclient import TestClient
import uvicorn

out = Path(sys.argv[1])
password = os.environ.pop('NODE_TEST_PASSWORD')
scripts = Path(__file__).resolve().parent
pinned, _ = runpy.run_path(str(scripts / 'preview-original.py'))['prepare'](out / 'pinned')
archive = pinned / 'agent' / 'agent.tgz'
expected = archive.with_suffix('.tgz.sha256').read_text().split()[0]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
with tarfile.open(archive) as bundle:
    bundle.extractall(out / 'fixed-agent', filter='data')
for key in list(os.environ):
    if key.startswith('FUMIAO_') or key.endswith('_API_KEY'):
        del os.environ[key]
os.environ.update(
    FUMIAO_DATA=str(out / 'sqlite'),
    FUMIAO_SITE='http://localhost:3000',
    FUMIAO_STATIC_DIR=str(pinned / 'static'),
    FUMIAO_MUSE_AUTOSTART='0',
    FUMIAO_FLOW_AUTOSTART='0',
    FUMIAO_PAYMENT_AUTOSTART='0',
)
os.umask(0o077)
sys.path.insert(0, str(pinned))
import core
from server import app

with TestClient(app) as client:
    for role in ('admin', 'member', 'observer'):
        code = core.token()
        with core.db(True) as con:
            con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)',
                        (code, 'admin' if role == 'admin' else 'member', core.now() + 90))
        response = client.post('/api/register', json=dict(name=role, nickname=role, password=password, code=code))
        assert response.is_success, response.status_code
    with core.db(True) as con:
        con.execute("INSERT INTO nodes(id,owner,name,key,stage,lastseen,control) VALUES(17,1,'弗淼003',?,'ready',?,'removed')",
                    (core.hashed(core.token()), core.now()))
        con.execute("INSERT INTO pairs(owner,label,key,expires) VALUES(1,'弗淼004',?,?)",
                    (core.hashed(core.token()), core.now() - 1))
        con.execute("INSERT INTO settings VALUES('node_name_sequence','6')")
        con.execute("UPDATE credit_prices SET amount=1 WHERE amount IS NULL")
        workspace = con.execute("SELECT id FROM workspaces WHERE kind='personal' AND owner=1").fetchone()[0]
        con.execute('UPDATE credit_accounts SET balance=100 WHERE workspace=?', (workspace,))
        con.execute("INSERT INTO credit_ledger(workspace,actor,action,amount,balance,reserved,created) VALUES(?,1,'recharge',100,100,0,?)",
                    (workspace, core.now()))

runpy.run_path(str(scripts / 'export-legacy.py'))['export'](
    core.DATA / 'studio.sqlite', out / 'node-export.json', 'nodes-http', True,
)
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    (out / 'node-oracle-port').write_text(str(listener.getsockname()[1]))
    uvicorn.Server(uvicorn.Config(app, access_log=False, log_level='critical')).run(sockets=[listener])
