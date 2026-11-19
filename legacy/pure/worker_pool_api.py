"""Authenticated public-pool control surface for the fmWorker desktop app."""
import hashlib
import hmac
import json
import re
import uuid
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import credits
import model_policy
import timing
import worker_pool
from core import actor, admin, db, fail, hashed, now, token, reap, LEASE, RESERVE, receive, store, dispatch_paused
from flow_catalog import MODELS as FLOW_MODELS
from worker_api import authenticate, assignment, payload, Beat, heartbeat

router = APIRouter()
from worker_verification import router as verification_router
router.include_router(verification_router)


class RewardConfig(BaseModel):
    reward_bps: int = Field(ge=0, le=10000)


@router.get('/api/admin/fmworker/config')
def reward_config(request: Request):
    admin(request)
    with db() as con:
        return {'reward_bps':int(con.execute("SELECT value FROM settings WHERE key='fmworker_reward_bps'").fetchone()[0])}


@router.put('/api/admin/fmworker/config')
def save_reward_config(body: RewardConfig, request: Request):
    admin(request)
    with db(True) as con:
        con.execute("UPDATE settings SET value=? WHERE key='fmworker_reward_bps'", (str(body.reward_bps),))
    return body.model_dump()


class Register(BaseModel):
    kind: Literal['breeze', 'flow', 'colab']
    name: str = Field(min_length=1, max_length=45)
    secret: str = Field(min_length=40, max_length=128)


class Configure(BaseModel):
    enabled: bool


class PoolBeat(BaseModel):
    stage: Literal['preparing', 'ready', 'busy', 'error']
    detail: str = Field(default='', max_length=300)
    capabilities: dict = Field(default_factory=dict)
    ticket: str = Field(default='', max_length=128)
    workflow: str = Field(default='', max_length=80)
    runtime_id: str = Field(default='', max_length=96)
    usage_uid: str | None = Field(default=None, max_length=100)
    usage_units: float = Field(default=0, ge=0, le=1000000, allow_inf_nan=False)


class Usage(BaseModel):
    uid: str = Field(min_length=1, max_length=100)
    units: float = Field(ge=0, le=1000000, allow_inf_nan=False)


@router.post('/fmworker/usage')
def report_usage(body: Usage, request: Request):
    with db(True) as con:
        node = authenticate(con, request)
        r = worker_pool.resource(con, node['id'])
        if not r: fail(403, '不是 fmWorker 资源')
        con.execute('INSERT OR IGNORE INTO fm_usage VALUES(?,?,?,?)', (node['id'], body.uid, body.units, now()))
        return {'ok':True}



def public_resource(row):
    return {k: row[k] for k in ('id', 'name', 'kind', 'enabled', 'stage', 'detail', 'control', 'lastseen')} | {
        'capabilities': json.loads(row['capabilities']),
        'online': row['lastseen'] > now()-75}


@router.get('/api/fmworker/account')
def account(request: Request):
    user = actor(request)
    with db() as con:
        workspace = con.execute("SELECT id FROM workspaces WHERE owner=? AND kind='personal'", (user['id'],)).fetchone()
        resources = [public_resource(r) for r in con.execute('SELECT n.*,f.kind,f.enabled,f.capabilities FROM nodes n JOIN fm_resources f ON f.node=n.id WHERE n.owner=? AND n.control!=?', (user['id'], 'removed'))]
        earned = con.execute('SELECT COALESCE(sum(units),0) FROM fm_rewards WHERE owner=?', (user['id'],)).fetchone()[0]
        return {'protocol': 1, 'user': {'id': user['id'], 'name': user['name'], 'nickname': user['nickname']},
                'wallet': credits.wallet(con, workspace[0]) if workspace else None,
                'resources': resources, 'earned': earned/10000,
                'reward_bps': int(con.execute("SELECT value FROM settings WHERE key='fmworker_reward_bps'").fetchone()[0])}


@router.get('/api/fmworker/history')
def history(request: Request):
    user = actor(request)
    with db() as con:
        return {'items': [dict(r) for r in con.execute('''SELECT r.job,r.node,r.units/10000.0 AS reward,r.credited,r.created,n.name
          FROM fm_rewards r JOIN nodes n ON n.id=r.node WHERE r.owner=? ORDER BY r.created DESC LIMIT 100''', (user['id'],))]}


@router.post('/api/fmworker/resources')
def register(body: Register, request: Request):
    user = actor(request)
    selected = ['breeze-tts-2'] if body.kind == 'breeze' else ['MiniMax H3'] if body.kind == 'colab' else list(FLOW_MODELS)
    with db(True) as con:
        old = con.execute('SELECT n.id,n.owner,f.kind FROM nodes n LEFT JOIN fm_resources f ON f.node=n.id WHERE n.key=?', (hashed(body.secret),)).fetchone()
        if old:
            if old['owner'] != user['id'] or old['kind'] != body.kind: fail(409, '资源凭据已被使用')
            return {'id': old['id']}
        if con.execute("SELECT count(*) FROM nodes n JOIN fm_resources f ON f.node=n.id WHERE n.owner=? AND n.control!='removed'", (user['id'],)).fetchone()[0] >= 12:
            fail(409, '请先移除不再使用的资源')
        node = con.execute("INSERT INTO nodes(owner,name,key,lastseen,stage,models,ready_models) VALUES(?,?,?,?,'preparing',?,'[]')",
                           (user['id'], body.name.strip(), hashed(body.secret), now(), json.dumps(selected))).lastrowid
        con.execute('INSERT INTO fm_resources(node,kind,limits,created) VALUES(?,?,?,?)', (node, body.kind, '{}', now()))
        return {'id': node, 'models': selected}


@router.put('/api/fmworker/resources/{node}')
def configure(node: int, body: Configure, request: Request):
    user = actor(request)
    with db(True) as con:
        if not con.execute("SELECT 1 FROM nodes n JOIN fm_resources f ON f.node=n.id WHERE n.id=? AND n.owner=? AND n.control!='removed'", (node, user['id'])).fetchone():
            fail(404, '资源不存在')
        con.execute('UPDATE fm_resources SET enabled=?,limits=? WHERE node=?', (int(body.enabled), '{}', node))
        # Current jobs remain eligible to complete while admission is paused.
        return {'ok': True}


@router.delete('/api/fmworker/resources/{node}')
def remove(node: int, request: Request):
    user = actor(request)
    with db(True) as con:
        if not con.execute('SELECT 1 FROM nodes n JOIN fm_resources f ON f.node=n.id WHERE n.id=? AND n.owner=?', (node, user['id'])).fetchone(): fail(404, '资源不存在')
        if con.execute("SELECT 1 FROM jobs WHERE node=? AND status='running'", (node,)).fetchone(): fail(409, '请等待当前任务完成后移除')
        con.execute("UPDATE nodes SET control='removed' WHERE id=?", (node,))
        con.execute('UPDATE fm_resources SET enabled=0 WHERE node=?', (node,))
        return {'ok': True}


def clean_caps(kind, value):
    models = value.get('models', [])
    allowed = ['breeze-tts-2'] if kind == 'breeze' else ['MiniMax H3'] if kind == 'colab' else list(FLOW_MODELS)
    if not isinstance(models, list) or any(m not in allowed for m in models): fail(400, '资源能力无效')
    result = {'models': list(dict.fromkeys(models))}
    if kind == 'colab':
        matrix = value.get('h3', {})
        permitted = {'modes': list(worker_pool.H3_MODES), 'steps': [4,16,20,32,50], 'quality': [480,768], 'seconds': [5,10,15]}
        if not isinstance(matrix, dict): fail(400, 'H3 能力表无效')
        for key, items in permitted.items():
            if not isinstance(matrix.get(key, []), list) or any(x not in items for x in matrix.get(key, [])): fail(400, 'H3 能力表无效')
        result['h3'] = {key: matrix.get(key, []) for key in permitted}
    return result


@router.post('/fmworker/heartbeat')
def pool_heartbeat(body: PoolBeat, request: Request):
    with db(True) as con:
        node = authenticate(con, request)
        r = worker_pool.resource(con, node['id'])
        if not r: fail(403, '不是 fmWorker 资源')
        caps = clean_caps(r['kind'], body.capabilities)
        con.execute('UPDATE fm_resources SET capabilities=? WHERE node=?', (json.dumps(caps), node['id']))
        con.execute('UPDATE nodes SET stage=?,detail=?,lastseen=?,ready_models=?,workflow=?,runtime_id=?,video_steps=? WHERE id=?',
                    (body.stage, body.detail, now(), json.dumps(caps['models']), body.workflow, body.runtime_id,
                     json.dumps(caps.get('h3', {}).get('steps', [20])), node['id']))
        held = False
        if body.ticket:
            held = bool(con.execute("UPDATE jobs SET lease=? WHERE node=? AND ticket=? AND status='running'", (now()+LEASE, node['id'], body.ticket)).rowcount)
        if body.usage_uid:
            con.execute('INSERT OR IGNORE INTO fm_usage VALUES(?,?,?,?)', (node['id'], body.usage_uid, body.usage_units, now()))
        return {'control': node['control'], 'enabled': bool(r['enabled']), 'held': held, 'protocol': 1}


@router.post('/fmworker/claim')
def pool_claim(request: Request):
    with db(True) as con:
        node = authenticate(con, request)
        if not worker_pool.resource(con, node['id']): fail(403, '不是 fmWorker 资源')
        reap(con)
        current = con.execute("SELECT * FROM jobs WHERE node=? AND status='running'", (node['id'],)).fetchone()
        if current: return {'job': job_payload(con, current)}
        if dispatch_paused() or node['control'] != 'active' or node['stage'] != 'ready' or node['lastseen'] < now()-75:
            return {'job': None}
        for job in con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY id").fetchall():
            if not worker_pool.can_claim(con, node, job) or not model_policy.enabled(con, job['model'], job['workspace']): continue
            # Flow continuations are bound to their generating Google account.
            # Cross-account continuation cannot silently regenerate the source.
            if job['model'] in FLOW_MODELS and FLOW_MODELS[job['model']]['mode'] == 'extend':
                source = json.loads(con.execute('SELECT input_json FROM flow_tasks WHERE job=?', (job['id'],)).fetchone()[0]).get('source_job')
                prior = con.execute("SELECT node FROM jobs WHERE id=? AND status='done'", (source,)).fetchone()
                if not prior or prior[0] != node['id']: continue
            con.execute("UPDATE jobs SET status='running',node=?,ticket=?,lease=?,attempts=attempts+1,updated=? WHERE id=?", (node['id'], token(), now()+LEASE, now(), job['id']))
            current = con.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone()
            if job['model'] in FLOW_MODELS: con.execute("UPDATE flow_tasks SET state='worker' WHERE job=?", (job['id'],))
            worker_pool.assigned(con, node, current)
            timing.start_run(con, current, node)
            return {'job': job_payload(con, current)}
        return {'job': None}


def job_payload(con, job):
    data = payload(job)
    if job['model'] in FLOW_MODELS:
        data['flow'] = dict(FLOW_MODELS[job['model']])
        data['flow_input'] = json.loads(con.execute('SELECT input_json FROM flow_tasks WHERE job=?', (job['id'],)).fetchone()[0])
    return data


@router.put('/fmworker/jobs/{job_id}/result')
async def flow_result(job_id: int, request: Request):
    with db() as con:
        job = assignment(con, request, job_id, True)
        if job['model'] not in FLOW_MODELS: fail(400, '此结果应使用 GPU 结果接口')
        if job['status'] == 'done': return {'ok': True, 'id': job['result']}
    path, size = await receive(request, RESERVE)
    key = None
    committed = False
    try:
        with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if not hmac.compare_digest(digest, request.headers.get('x-sha256', '')): fail(422, '成品摘要不符')
        from muse_provider import inspect_media
        try: mime, metadata = await run_in_threadpool(inspect_media, path, job['kind'])
        except ValueError: fail(422, '成品未通过音视频校验')
        media_id = request.headers.get('x-flow-media-id', '')
        if media_id and re.fullmatch(r'[A-Za-z0-9_./:-]{1,300}', media_id): metadata['flow_media_id'] = media_id
        with db(True) as con:
            current = assignment(con, request, job_id, True)
            if current['status'] == 'done': return {'ok': True, 'id': current['result']}
            key = uuid.uuid4().hex
            store.put(path, key)
            con.execute('INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)',
                        (key, 'ref' if job['kind']=='image' else 'video', size, mime, metadata['width'], metadata['height'], job['owner'], job['workspace']))
            con.execute("UPDATE jobs SET status='done',result=?,width=?,height=?,output_metadata=?,lease=NULL,updated=?,note='' WHERE id=?", (key, metadata['width'], metadata['height'], json.dumps(metadata), now(), job_id))
            con.execute("UPDATE flow_tasks SET state='done',result_json='{}' WHERE job=?", (job_id,))
            timing.end_run(con, current, 'done')
            worker_pool.settle_reward(con, job_id)
        committed = True
        return {'ok': True, 'id': key}
    finally:
        path.unlink(missing_ok=True)
        if key and not committed: store.delete(key)
