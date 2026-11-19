"""Serve the verified production chat routes on a loopback socket with fixture data."""
import json
import os
import runpy
import socket
import sys
import time
import uuid
from pathlib import Path

from fastapi import HTTPException
from fastapi.testclient import TestClient
import uvicorn


out, provider = Path(sys.argv[1]), sys.argv[2]
listener = socket.socket()
listener.bind(('127.0.0.1', 0))
listener.listen()
port = listener.getsockname()[1]
site = sys.argv[3] if len(sys.argv) > 3 else 'http://localhost:3000'
if site == 'direct':
    site = f'http://127.0.0.1:{port}'
scripts = Path(__file__).resolve().parent
pinned, _ = runpy.run_path(str(scripts / 'preview-original.py'))['prepare'](out / 'pinned')
for key in list(os.environ):
    if key.startswith('FUMIAO_') or key in {'DEEPSEEK_API_KEY', 'OPENAI_CHAT_API_KEY', 'OPENAI_API_KEY'}:
        del os.environ[key]
os.environ.update(
    FUMIAO_DATA=str(out / 'sqlite'),
    FUMIAO_SITE=site,
    FUMIAO_STATIC_DIR=str(pinned / 'static'),
    FUMIAO_MUSE_AUTOSTART='0',
    FUMIAO_FLOW_AUTOSTART='0',
    FUMIAO_PAYMENT_AUTOSTART='0',
    DEEPSEEK_API_KEY='sk-chat-http-fixture',
    OPENAI_CHAT_API_KEY='sk-chat-http-fixture',
)
composer_fixtures = Path(sys.argv[4]) if len(sys.argv) > 4 else None
if composer_fixtures:
    os.environ['OPENAI_API_KEY'] = 'sk-studio-composer-fixture'
    os.environ['FUMIAO_FLOW_URL'] = provider
    os.environ['FUMIAO_FLOW_KEY'] = 'studio-composer-fixture'
    data = Path(os.environ['FUMIAO_DATA'])
    data.mkdir(parents=True)
    (data / '.dispatch-paused').touch()
sys.path.insert(0, str(pinned))

import chat_models
import chat_runtime
import core
from server import app

provider_base = provider if len(sys.argv) > 3 else provider + '/oracle'
for spec in chat_models.PROVIDERS.values():
    spec.update(url=provider_base + '/chat/completions', models_url=provider_base + '/models')

with TestClient(app) as client:
    for user in ('admin', 'member'):
        code = core.token()
        with core.db(True) as con:
            con.execute('INSERT INTO registration_codes(code,role,expires) VALUES(?,?,?)', (code, user, core.now() + 90))
        response = client.post('/api/register', json=dict(name=user, nickname=user.title(), password='chat-http-fixture', code=code))
        assert response.status_code == 200, response.text
        if user == 'admin':
            response = client.post('/api/canvases', json={'title': '对话画布'})
            assert response.status_code == 200, response.text
            canvas = response.json()
            response = client.put(f"/api/canvases/{canvas['id']}/document", json={
                'title': canvas['title'], 'expected_revision': canvas['revision'],
                'document': {'nodes': [{'id': 'text-node', 'type': 'text', 'title': '原稿', 'text': '原文😀', 'x': 20, 'y': 5}], 'edges': []},
            })
            assert response.status_code == 200, response.text
            canvas.update(response.json())
    with core.db(True) as con:
        con.execute('INSERT INTO workspace_members(workspace,user) VALUES(1,2)')
        con.execute('UPDATE credit_accounts SET balance=100')
        con.execute("UPDATE users SET avatar='builtin:alpine'")
        if composer_fixtures:
            con.execute('UPDATE credit_prices SET amount=1')

runpy.run_path(str(scripts / 'export-legacy.py'))['export'](
    core.DATA / 'studio.sqlite', out / 'export.json', 'chat-http-oracle', True,
)


@app.post('/__fixture/revoke-member')
def revoke_member():
    with core.db(True) as con:
        con.execute('DELETE FROM workspace_members WHERE workspace=1 AND user=2')
    return {'ok': True}


if composer_fixtures:
    import timing

    @app.post('/__fixture/demote-admin')
    def demote_admin():
        with core.db(True) as con:
            con.execute("UPDATE users SET role='member' WHERE name='admin'")
        return {'ok': True}

    @app.post('/__fixture/composer-results/{job_id}')
    def deliver_composer_result(job_id: int):
        # Simulate artifact delivery at the pinned storage boundary. The
        # original jobs status trigger still performs the real wallet settlement.
        with core.db(True) as con:
            row = con.execute("SELECT * FROM jobs WHERE id=? AND status='queued'", (job_id,)).fetchone()
            if not row:
                raise HTTPException(409, 'Expected one queued composer job')
            stamp = time.time()
            con.execute("UPDATE jobs SET attempts=attempts+1 WHERE id=?", (job_id,))
            row = dict(row)
            row['attempts'] += 1
            timing.start_run(con, row, timestamp=stamp - 0.1)
            kind = row['kind']
            filename, original_kind, mime, width, height = {
                'video': ('video.mp4', 'video', 'video/mp4', row['width'], row['height']),
                'audio': ('audio.wav', 'audio', 'audio/wav', 0, 0),
                'image': ('image.png', 'ref', 'image/png', 96, 54),
            }[kind]
            raw = (composer_fixtures / filename).read_bytes()
            key = uuid.uuid4().hex
            staged = core.stage_dir / key
            staged.write_bytes(raw)
            core.store.put(staged, key)
            metadata = {
                'video': {'sampling_steps': row['sampling_steps'], 'fast_mode': row['sampling_steps'] == 4},
                'audio': {'duration': 1, 'sample_rate': 24000, 'channels': 1, 'format': 'wav'},
                'image': {},
            }[kind]
            con.execute('INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)',
                        (key, original_kind, len(raw), mime, width, height, row['owner'], row['workspace']))
            con.execute("UPDATE jobs SET status='done',result=?,width=?,height=?,output_metadata=?,updated=?,note='' WHERE id=?",
                        (key, width, height, json.dumps(metadata), core.now(), job_id))
            timing.end_run(con, row, 'done', timestamp=stamp)
        return {'id': key}


@app.post('/__fixture/recover')
async def recover():
    chat_runtime.recover()
    for task in list(chat_runtime.TASKS.values()):
        task.cancel()
    return {'ok': True}


with listener:
    (out / 'server.json').write_text(json.dumps({'port': port, 'canvas': canvas}))
    uvicorn.Server(uvicorn.Config(app, log_level='error')).run(sockets=[listener])
