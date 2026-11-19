"""Adapter regressions; never start Chrome or access an account."""
import ast
import asyncio
import json
import logging
import os
import sys
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from fmworker.flow import Flow


def host_helpers():
    source = ROOT / 'resources/flow_host.py'
    tree = ast.parse(source.read_text())
    names = {'personal_worker', 'exception_structure', 'connection_failure', 'BrowserProbeHandler','browser_fingerprint'}
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in names]
    scope = dict(Path=Path, json=json, os=os, time=time, traceback=traceback, logging=logging,
                 HTTPException=HTTPException, browser_probe_failures=[])
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
    return scope


def test_single_browser_service_is_not_treated_as_pool():
    calls=[]
    async def initialize():calls.append('initialize')
    worker=SimpleNamespace(initialize=initialize)
    selected=asyncio.run(host_helpers()['personal_worker'](worker))
    assert selected is worker and calls==['initialize']


def test_pool_initializes_before_selecting_worker():
    calls=[]
    async def initialize():calls.append('initialize')
    worker=SimpleNamespace(initialize=initialize)
    pool=SimpleNamespace(_workers=[])
    async def ensure():
        calls.append('ensure');pool._workers=[worker]
    pool._ensure_workers=ensure
    assert asyncio.run(host_helpers()['personal_worker'](pool)) is worker
    assert calls==['ensure','initialize']


def test_empty_pool_has_actionable_failure():
    async def ensure():pass
    pool=SimpleNamespace(_ensure_workers=ensure,_workers=[])
    with pytest.raises(RuntimeError,match='浏览器尚未准备好'):
        asyncio.run(host_helpers()['personal_worker'](pool))


def test_connection_diagnostics_exclude_exception_text_and_locals(tmp_path,monkeypatch):
    path=tmp_path/'connection.json'
    monkeypatch.setenv('FMWORKER_FLOW_DIAGNOSTICS',str(path))
    helpers=host_helpers()
    private_cookie='sensitive-cookie-value'
    try:raise AttributeError('Cookie='+private_cookie)
    except AttributeError as exc:
        with pytest.raises(HTTPException) as result:helpers['connection_failure'](exc,'browser_start')
    data=json.loads(path.read_text())
    assert data['exceptions'][0]['type']=='AttributeError'
    assert data['exceptions'][0]['frames']
    assert private_cookie not in path.read_text()
    assert private_cookie not in str(result.value.detail)
    assert result.value.status_code==503


def test_unwritable_diagnostics_do_not_hide_connection_failure(tmp_path,monkeypatch):
    parent=tmp_path/'file';parent.write_text('not a folder')
    monkeypatch.setenv('FMWORKER_FLOW_DIAGNOSTICS',str(parent/'connection.json'))
    with pytest.raises(HTTPException) as result:
        host_helpers()['connection_failure'](TimeoutError('private URL'),'browser_start')
    assert result.value.detail['exception']=='TimeoutError'


@pytest.mark.parametrize('detail, expected',[
    ({'code':'flow_connection_failed','exception':'AttributeError'},'（AttributeError）'),
    ({'code':'flow_connection_failed','exception':'Cookie=secret'},'未能连接，'),
    ('private provider response','未能连接，'),
])
def test_client_exposes_only_structured_safe_error(detail,expected):
    client=SimpleNamespace(post=lambda *a,**k:httpx.Response(503,json={'detail':detail}))
    flow=object.__new__(Flow);flow.client=client
    with pytest.raises(RuntimeError) as result:flow.desktop_request('/fmworker/open-login')
    assert expected in str(result.value)
    assert 'secret' not in str(result.value) and 'private' not in str(result.value)


def test_generation_request_uses_verification_browser_identity():
    client=SimpleNamespace(_build_fingerprint_from_user_agent=lambda agent,**kwargs:{'user_agent':agent,**kwargs})
    result={'token':'never-logged','user_agent':'Chrome test','accept_language':'en-GB','proxy_url':'https://untrusted.invalid'}
    fp=host_helpers()['browser_fingerprint'](client,result,'project-id','http://trusted-proxy.invalid')
    assert fp['user_agent']=='Chrome test' and fp['accept_language']=='en-GB'
    assert fp['proxy_url']=='http://trusted-proxy.invalid'
    assert fp['referer']=='https://flow.google.com/project/project-id'
    assert 'token' not in fp
    with pytest.raises(RuntimeError):host_helpers()['browser_fingerprint'](client,{'user_agent':'bad\r\nheader'},'project-id')


def test_generation_failure_only_marks_known_pre_submission_rejection():
    from fmworker.flow import generation_failure,GenerationRejected
    assert isinstance(generation_failure({'message':'Failed to obtain reCAPTCHA token'}),GenerationRejected)
    assert not isinstance(generation_failure({'message':'network timed out'}),GenerationRejected)
    assert isinstance(generation_failure({'message':'flow_reference_verification_failed'}),GenerationRejected)
    assert not isinstance(generation_failure({'message':'chrome_bridge_error'}),GenerationRejected)
    assert 'sensitive-url' not in str(generation_failure({'message':'network failed https://sensitive-url/secret'}))
