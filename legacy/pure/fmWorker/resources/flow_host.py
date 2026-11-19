"""Runs the pinned Flow2API with local-only, authenticated desktop operations.

OAuth/Flow credentials never persist in the upstream SQLite database: all its
connections share one in-memory database kept alive by an anchor connection.
Chrome owns the recoverable session; the desktop imports it into memory.
"""
import asyncio
import hmac
import json
import os
import sqlite3
import threading
import time
import sys
import traceback
import logging
import urllib.request
from pathlib import Path

root = Path(os.environ['FMWORKER_FLOW_ROOT'])
browser_probe_failures=[]


def exception_structure(exc):
    value={'type':type(exc).__name__,
        'frames':[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno}
                  for f in traceback.extract_tb(exc.__traceback__)]}
    for key in ('code','errno'):
        number=getattr(exc,key,None)
        if isinstance(number,int):value[key]=number
    return value


class BrowserProbeHandler(logging.Handler):
    def emit(self, record):
        if record.exc_info and record.exc_info[1]:
            browser_probe_failures.append(exception_structure(record.exc_info[1]))
            del browser_probe_failures[:-3]


probe_logger=logging.getLogger('nodriver')
probe_logger.setLevel(logging.DEBUG)
probe_logger.addHandler(BrowserProbeHandler())
probe_logger.propagate=False
sys.path.insert(0, str(root))
os.chdir(root)
import aiosqlite
original_connect = aiosqlite.connect
anchor = sqlite3.connect('file:fmworker-flow?mode=memory&cache=shared', uri=True)
parent_pid=os.getppid()
parent_gone=threading.Event()
def parent_alive():
    if os.name=='nt':
        import ctypes
        handle=ctypes.windll.kernel32.OpenProcess(0x00100000,False,parent_pid)
        if not handle:return False
        alive=ctypes.windll.kernel32.WaitForSingleObject(handle,0)==0x00000102
        ctypes.windll.kernel32.CloseHandle(handle);return alive
    return os.getppid()==parent_pid
def parent_guard():
    while parent_alive():time.sleep(3)
    parent_gone.set()
    server=globals().get('http_server')
    if server:server.should_exit=True
threading.Thread(target=parent_guard,daemon=True).start()
def memory_connect(database, *args, **kwargs):
    return original_connect('file:fmworker-flow?mode=memory&cache=shared', *args, uri=True, **kwargs)
aiosqlite.connect = memory_connect

from fastapi import Request, HTTPException
from src.main import app, db, token_manager
from src.core.config import config
from src.services.browser_captcha_personal import BrowserCaptchaService
from src.services.browser_captcha_extension import ExtensionCaptchaService


def desktop_bridge(packet):
    port=int(os.environ['FMWORKER_CHROME_PORT'])
    request=urllib.request.Request(f'http://127.0.0.1:{port}/bridge',data=json.dumps(packet).encode(),method='POST',
        headers={'Content-Type':'application/json','Authorization':'Bearer '+os.environ['FMWORKER_CHROME_SECRET']})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=70) as response:
        value=json.load(response)
    if value.get('error'):raise HTTPException(409,detail={'code':'chrome_bridge_error','message':value['error']})
    return value['result']


class DesktopExtensionCaptcha:
    async def has_connection_for_token(self,token_id):
        status=await asyncio.to_thread(desktop_bridge,{'op':'status'})
        return bool(status.get('connected')),''

    async def get_token(self,project_id,action='IMAGE_GENERATION',timeout=25,token_id=None):
        result=await asyncio.to_thread(desktop_bridge,{'op':'browser','kind':'captcha','payload':{'project_id':project_id,'action':action}})
        return result.get('token')

    async def report_flow_error(self,*args,**kwargs):pass

    def describe_routes(self):return 'fmWorker Chrome'


desktop_captcha=DesktopExtensionCaptcha()
async def desktop_extension_instance(cls,db=None):return desktop_captcha
if os.environ.get('FMWORKER_CHROME_PORT'):
    ExtensionCaptchaService.get_instance=classmethod(desktop_extension_instance)


def browser_fingerprint(client,result,project_id,proxy=None):
    agent=str(result.get('user_agent',''))
    language=str(result.get('accept_language',''))
    if not agent or len(agent)>512 or any(c in agent+language for c in '\r\n'):
        raise RuntimeError('Chrome 未返回有效浏览器标识')
    value=client._build_fingerprint_from_user_agent(agent,accept_language=language[:200],proxy_url=proxy)
    value.update(project_id=project_id,origin='https://flow.google.com',referer='https://flow.google.com/project/'+project_id)
    return value


async def desktop_recaptcha(self,project_id,action='IMAGE_GENERATION',token_id=None,**kwargs):
    import uuid
    project_id=str(uuid.UUID(str(project_id).removeprefix('projects/')))
    self._set_captcha_request_context({'method':'extension','project_id':project_id,'token_id':token_id,'owner':asyncio.current_task()})
    try:
        result=await asyncio.to_thread(desktop_bridge,{'op':'browser','kind':'captcha','payload':{'project_id':project_id,'action':action}})
    except Exception:
        if action=='UPLOAD_IMAGE':
            raise HTTPException(409,detail={'code':'flow_reference_verification_failed',
                'message':'参考图片上传验证未完成，视频尚未提交生成'}) from None
        raise
    proxy=await self.proxy_manager.get_request_proxy_url() if self.proxy_manager else None
    self._set_request_fingerprint(browser_fingerprint(self,result,project_id,proxy))
    return result.get('token'),None


if os.environ.get('FMWORKER_CHROME_PORT'):
    type(token_manager.flow_client)._get_recaptcha_token=desktop_recaptcha

# Shared-memory SQLite cannot use WAL. The pinned upstream has no nested
# connection scopes, so use its existing connection lock for reads as well as
# writes; this avoids table-lock races without writing credentials to disk.
original_scoped_connect=type(db)._connect
def serialized_connection(self,*,write=False):
    return original_scoped_connect(self,write=True)
type(db)._connect=serialized_connection


def authenticate(request):
    if not hmac.compare_digest(request.headers.get('authorization',''), 'Bearer '+config.api_key):
        raise HTTPException(401, 'Unauthorized')


async def personal():
    try:
        service = await BrowserCaptchaService.get_instance(db)
        return await personal_worker(service)
    except Exception as exc:
        connection_failure(exc, 'browser_start')


async def personal_worker(service):
    # The pinned upstream returns a single worker at browser_count=1, and a
    # pool only for multiple browsers or a token pool. Support both contracts.
    ensure_workers=getattr(service,'_ensure_workers',None)
    if callable(ensure_workers):
        await ensure_workers()
        if not service._workers:raise RuntimeError('Flow 浏览器尚未准备好')
        worker=service._workers[0]
    else:
        worker=service
    await worker.initialize()
    return worker


def connection_failure(exc, phase):
    # Log structure, never exception text, local variables or request bodies:
    # provider exceptions can otherwise contain a cookie or an auth URL.
    chain=[];current=exc
    while current is not None and len(chain)<4:
        chain.append(exception_structure(current))
        current=current.__cause__ or current.__context__
    diagnostic={'phase':phase,'at':time.time(),'exceptions':chain,'browser_probe':list(browser_probe_failures)}
    target=os.environ.get('FMWORKER_FLOW_DIAGNOSTICS')
    if target:
        try:
            path=Path(target);path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text(json.dumps(diagnostic,ensure_ascii=False,indent=2),encoding='utf-8')
            path.chmod(0o600)
        except OSError:pass
    raise HTTPException(503,detail={'code':'flow_connection_failed','phase':phase,'exception':type(exc).__name__}) from None


@app.post('/fmworker/open-login')
async def open_login(request: Request):
    authenticate(request)
    if os.environ.get('FMWORKER_CHROME_PORT'):
        return await asyncio.to_thread(desktop_bridge,{'op':'browser','kind':'open_flow'})
    worker = await personal()
    try:
        await worker.browser.get('https://flow.google.com/projects', new_tab=True)
    except Exception as exc:
        connection_failure(exc, 'login_window')
    return {'ok':True}


@app.post('/fmworker/session')
async def session(request: Request):
    authenticate(request)
    body = await request.json()
    expected = str(body.get('email','')).strip().lower()
    if not expected: raise HTTPException(400, 'Connect Google first')
    project_id=body.get('project_id')
    if project_id:
        import uuid
        try:project_id=str(uuid.UUID(str(project_id)))
        except ValueError:project_id=None
    try:return await sync_session(expected,project_id)
    except HTTPException:raise
    except Exception as exc:connection_failure(exc,'session_sync')


async def sync_session(expected,project_id=None):
    if os.environ.get('FMWORKER_CHROME_PORT'):
        result=await asyncio.to_thread(desktop_bridge,{'op':'browser','kind':'session'})
        if not result.get('connected'):return {'connected':False}
        if result.get('email','').lower()!=expected:raise HTTPException(409,'Flow 账号不匹配')
        serialized=[c for c in result.get('cookies',[]) if isinstance(c,dict) and c.get('domain','').lstrip('.') in ('google.com','flow.google.com')]
    else:
        worker = await personal()
        tabs = list(worker.browser.tabs)
        tab = next((t for t in tabs if str(getattr(t,'url','')).startswith('https://flow.google.com/')), None)
        if not tab: return {'connected':False}
        identity = await tab.evaluate("({host:location.hostname,email:(window.WIZ_global_data||{}).oPEP7c||''})", return_by_value=True)
        if not isinstance(identity,dict) or identity.get('host') != 'flow.google.com' or not identity.get('email'):return {'connected':False}
        if identity['email'].lower() != expected:raise HTTPException(409,'Flow 与 Colab 必须使用同一个 Google 账号')
        cookies = await worker._get_browser_cookies(label='fmworker_manual_login')
        serialized=[]
        for cookie in cookies:
            value=worker._serialize_browser_cookie_for_storage(cookie)
            if value and value.get('domain','').lstrip('.') in ('google.com','flow.google.com'):serialized.append(value)
    encoded = json.dumps(serialized, separators=(',',':'))
    # token_manager performs the upstream session check before accepting cookies.
    converted = await token_manager.flow_client.st_to_at('', google_cookies=encoded)
    actual = str(converted.get('user',{}).get('email','')).strip().lower()
    if actual and actual != expected: raise HTTPException(409, 'Flow 实际会话与所选 Google 账号不同')
    current = await db.get_token_by_email(expected)
    if current:
        await token_manager.update_token(current.id, google_cookies=encoded, at=converted['access_token'],
                                          login_account=expected, protocol_mode='session')
    else:
        await token_manager.add_token(st='fmworker-local', google_cookies=encoded, login_account=expected,
                                      protocol_mode='session', remark='fmWorker', project_name='fmWorker',project_id=project_id, auto_refresh_enabled=True)
    current=await db.get_token_by_email(expected)
    return {'connected':True,'email':expected,'cookies':serialized,'project_id':current.current_project_id if current else None}


@app.post('/fmworker/restore')
async def restore(request: Request):
    authenticate(request)
    body=await request.json()
    encoded=json.dumps(body['cookies'],separators=(',',':'))
    await token_manager.add_token(st='fmworker-local',google_cookies=encoded,login_account=body['email'],
                                  protocol_mode='session',remark='fmWorker',project_name='fmWorker',
                                  project_id=body.get('project_id'),auto_refresh_enabled=True)
    return {'ok':True}


@app.post('/fmworker/shutdown')
async def shutdown(request: Request):
    authenticate(request)
    http_server.should_exit=True
    return {'ok':True}

if __name__=='__main__':
    import uvicorn
    http_server=uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=int(os.environ['FMWORKER_FLOW_PORT']), log_level='warning',timeout_graceful_shutdown=15))
    if not parent_gone.is_set():http_server.run()
