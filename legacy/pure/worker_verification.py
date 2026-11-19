"""Task-scoped Flow verification. Google credentials never enter this service."""
import hashlib
import json
import os
from pathlib import Path
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from core import actor, db, fail, hashed, now
from flow_catalog import MODELS
from worker_api import assignment

router = APIRouter()
SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'
TASK_TYPES = {'RecaptchaV3TaskProxyless': None, 'RecaptchaV3TaskProxylessM1': None,
              'RecaptchaV3TaskProxylessM1S7': .7, 'RecaptchaV3TaskProxylessM1S9': .9}


def configuration():
    try:
        value = json.loads(Path(os.environ.get('FUMIAO_FLOW_VERIFICATION_CONFIG',
            '/srv/fumiao/config/flow-verification.json')).read_text())
        assert value['base_url'] in ('https://api.yescaptcha.com', 'https://cn.yescaptcha.com')
        assert value['task_type'] in TASK_TYPES
        assert isinstance(value['client_key'], str) and 8 <= len(value['client_key']) <= 200
        return value
    except (OSError, ValueError, KeyError, AssertionError, TypeError):
        fail(503, '平台页面验证服务尚未配置')


class Verification(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    project_id: UUID
    action: Literal['UPLOAD_IMAGE', 'IMAGE_GENERATION', 'VIDEO_GENERATION']
    user_agent: str = Field(min_length=10, max_length=512, pattern=r'^[^\r\n]+$')


def ensure_table(con):
    con.execute('''CREATE TABLE IF NOT EXISTS fm_flow_verifications(
      request_id TEXT PRIMARY KEY, job INTEGER NOT NULL, node INTEGER NOT NULL,
      ticket_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, action TEXT NOT NULL,
      project_id TEXT NOT NULL, user_agent TEXT NOT NULL, state TEXT NOT NULL,
      provider_id TEXT, created INTEGER NOT NULL)''')
    con.execute('CREATE INDEX IF NOT EXISTS fm_flow_verifications_job ON fm_flow_verifications(job)')


def authorize(con, request, job_id):
    job = assignment(con, request, job_id)
    resource = con.execute('SELECT kind FROM fm_resources WHERE node=?', (job['node'],)).fetchone()
    if job['model'] not in MODELS or not resource or resource['kind'] != 'flow':
        fail(403, '仅限当前 Flow 任务使用页面验证')
    if job['lease'] <= now(): fail(409, '任务租约已过期')
    return job


def provider_call(config, method, payload):
    # No Google cookies, prompts, images, node credentials or arbitrary URLs.
    try:
        response = httpx.post(config['base_url'] + '/' + method,
            json={'clientKey': config['client_key'], **payload}, timeout=25, follow_redirects=False)
        response.raise_for_status()
        value = response.json()
        if not isinstance(value, dict): raise ValueError()
    except (httpx.HTTPError, ValueError):
        fail(503, '平台页面验证服务暂时未响应')
    if value.get('errorId'):
        if value.get('errorCode') == 'ERROR_ZERO_BALANCE': fail(503, '平台页面验证服务额度不足')
        fail(503, '平台页面验证未完成，请稍后重试')
    return value


@router.get('/api/fmworker/flow-verification')
def status(request: Request):
    actor(request)
    configuration()
    return {'available': True, 'mode': 'platform', 'protocol': 1}


@router.post('/fmworker/jobs/{job_id}/verification')
def create(job_id: int, body: Verification, request: Request):
    values = body.model_dump(mode='json')
    fingerprint = hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()
    with db(True) as con:
        job = authorize(con, request, job_id)
        refs = json.loads(job['refs'])
        allowed = {'VIDEO_GENERATION' if job['kind'] == 'video' else 'IMAGE_GENERATION'}
        if refs: allowed.add('UPLOAD_IMAGE')
        if body.action not in allowed: fail(400, '验证动作与当前任务不匹配')
        ensure_table(con)
        old = con.execute('SELECT * FROM fm_flow_verifications WHERE request_id=?', (str(body.request_id),)).fetchone()
        if old:
            if (old['job'], old['node'], old['ticket_hash'], old['fingerprint']) != (job_id, job['node'], hashed(job['ticket']), fingerprint):
                fail(409, '验证请求编号已被使用')
            if not old['provider_id']: fail(409, '验证请求状态待确认，不会重复提交')
            return {'request_id': str(body.request_id), 'status': 'processing'}
        # Bound provider spending to the claimed task and its actual references.
        count = con.execute('SELECT count(*) FROM fm_flow_verifications WHERE job=?', (job_id,)).fetchone()[0]
        if count >= 6 + 3 * len(refs): fail(429, '本次任务的页面验证重试次数已用尽')
        config = configuration()
        con.execute('INSERT INTO fm_flow_verifications VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            (str(body.request_id), job_id, job['node'], hashed(job['ticket']), fingerprint,
             body.action, str(body.project_id), body.user_agent, 'creating', None, now()))
    task = {'websiteURL': 'https://flow.google.com/project/' + str(body.project_id),
            'websiteKey': SITE_KEY, 'type': config['task_type'], 'pageAction': body.action,
            'userAgent': body.user_agent}
    score = TASK_TYPES[config['task_type']]
    if score is not None: task['minScore'] = score
    value = provider_call(config, 'createTask', {'task': task})
    provider_id = value.get('taskId')
    if not isinstance(provider_id, str) or not 1 <= len(provider_id) <= 160:
        fail(503, '平台页面验证未返回任务编号')
    with db(True) as con:
        con.execute("UPDATE fm_flow_verifications SET state='processing',provider_id=? WHERE request_id=?",
                    (provider_id, str(body.request_id)))
    return {'request_id': str(body.request_id), 'status': 'processing'}


@router.get('/fmworker/jobs/{job_id}/verification/{request_id}')
def result(job_id: int, request_id: UUID, request: Request):
    with db(True) as con:
        job = authorize(con, request, job_id)
        ensure_table(con)
        row = con.execute('SELECT * FROM fm_flow_verifications WHERE request_id=? AND job=? AND node=? AND ticket_hash=?',
                          (str(request_id), job_id, job['node'], hashed(job['ticket']))).fetchone()
        if not row: fail(404, '验证请求不存在')
        if row['created'] < now() - 180: fail(410, '页面验证请求已过期')
        if not row['provider_id']: fail(409, '验证请求状态待确认，不会重复提交')
    value = provider_call(configuration(), 'getTaskResult', {'taskId': row['provider_id']})
    with db() as con: authorize(con, request, job_id)
    if value.get('status') == 'processing': return {'status': 'processing'}
    solution = value.get('solution') or {}
    token = solution.get('gRecaptchaResponse')
    agent = solution.get('userAgent') or row['user_agent']
    if value.get('status') != 'ready' or not isinstance(token, str) or not 20 <= len(token) <= 65536:
        fail(503, '平台页面验证未返回有效结果')
    if not isinstance(agent, str) or not 10 <= len(agent) <= 512 or '\r' in agent or '\n' in agent:
        fail(503, '平台页面验证返回的浏览器信息无效')
    # Tokens are short lived: return only to the still-authorized task, never
    # persist them in logs, the database, or downloadable diagnostics.
    return {'status': 'ready', 'token': token, 'user_agent': agent, 'accept_language': 'en-US,en;q=0.9'}
