import base64
import html
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from .assets import bundled, extract_verified, managed_python
from .browser import find_browser
from .state import atomic
from .platform import PlatformError


def image_mime(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):return 'image/png'
    if raw.startswith(b'\xff\xd8\xff'):return 'image/jpeg'
    if raw[:4]==b'RIFF' and raw[8:12]==b'WEBP':return 'image/webp'
    if raw[:6] in (b'GIF87a',b'GIF89a'):return 'image/gif'
    if raw[4:8]==b'ftyp' and raw[8:12] in (b'avif',b'avis'):return 'image/avif'
    raise RuntimeError('参考图片格式不受支持，请重新上传图片')


class GenerationRejected(RuntimeError):
    pass


def generation_failure(payload):
    text=json.dumps(payload,ensure_ascii=False).lower()
    if 'flow_reference_verification_failed' in text:
        return GenerationRejected('参考图片上传验证未完成，视频尚未提交生成；请检查 Chrome 连接助手')
    if 'chrome_bridge_error' in text:
        return RuntimeError('Chrome 连接助手未完成页面验证，请检查扩展连接及版本')
    if 'failed to obtain recaptcha token' in text:
        return GenerationRejected('页面验证未完成，视频尚未提交生成')
    if 'public_error_unusual_activity' in text or 'recaptcha evaluation failed' in text:
        return RuntimeError('Google Flow 要求检查账号活动，请在官方页面检查后重试')
    if 'model_access_denied' in text:return GenerationRejected('当前 Flow 账号未开放所选模型')
    return RuntimeError('Flow 未完成生成，请检查账号和额度')


class Flow:
    def __init__(self, state, vault, platform,chrome=None):
        self.state,self.vault,self.platform=state,vault,platform
        self.root=state.root/'flow'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.process=None; self.client=None; self.key=None
        self.lock=threading.Lock(); self.active=None; self.last_sync=0
        self.chrome=chrome
        self.backend_ready=False

    def start_backend(self):
        with self.lock:
            if self.process and self.process.poll() is None and self.backend_ready:return
            if self.process and self.process.poll() is None:
                self.process.terminate()
                try:self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:self.process.kill()
            if self.client:self.client.close()
            self.client=None;self.backend_ready=False
            if not self.chrome or not self.chrome.status()['connected']:
                raise RuntimeError('请先在当前 Chrome 用户中安装并连接 fmWorker 扩展')
            self.state.resource('flow',stage='preparing',detail='正在准备 Flow 连接组件')
            lock=json.loads(bundled('upstream.lock.json').read_text(encoding='utf-8'))['flow2api']
            source=self.root/lock['revision']
            if not (source/'main.py').is_file(): extract_verified(bundled('flow2api.tar.gz'),source,lock['sha256'],True)
            with (self.root/'install.log').open('ab') as log:
                python=managed_python(self.root/'venv',bundled('flow.requirements.lock'),log)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
            self.key=secrets.token_urlsafe(40)
            config=(source/'config/setting_example.toml').read_text(encoding='utf-8')
            config=re.sub(r'api_key = "han1234"', 'api_key = "'+self.key+'"',config,count=1)
            config=config.replace('admin_password = "admin"','admin_password = "'+secrets.token_urlsafe(40)+'"')
            config=config.replace('host = "0.0.0.0"','host = "127.0.0.1"').replace('port = 8000','port = '+str(port))
            config=config.replace('captcha_method = "yescaptcha"','captcha_method = "extension"')
            config=config.replace('log_requests = true','log_requests = false').replace('log_responses = true','log_responses = false')
            config=config.replace('personal_max_resident_tabs = 5','personal_max_resident_tabs = 1')
            config=config.replace('personal_project_pool_size = 4','personal_project_pool_size = 1')
            config=config.replace('browser_personal_fresh_restart_every_n_solves = 10','browser_personal_fresh_restart_every_n_solves = 0')
            (source/'config/setting.toml').write_text(config,encoding='utf-8');(source/'config/setting.toml').chmod(0o600)
            env=dict(os.environ,FMWORKER_FLOW_ROOT=str(source),FMWORKER_FLOW_PORT=str(port),
                     FMWORKER_FLOW_DIAGNOSTICS=str(self.root/'connection-diagnostic.json'),
                     FMWORKER_CHROME_PORT=str(self.chrome.port),FMWORKER_CHROME_SECRET=self.chrome.secret,
                     PYTHONUNBUFFERED='1')
            # Upstream diagnostic bodies may contain session details: discard them.
            self.process=subprocess.Popen([str(python),str(bundled('flow_host.py'))],env=env,cwd=source,
                                          stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            self.client=httpx.Client(base_url=f'http://127.0.0.1:{port}',headers={'Authorization':'Bearer '+self.key},
                                     timeout=90,trust_env=False,follow_redirects=False)
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                if self.process.poll() is not None: raise RuntimeError('Flow 连接组件启动失败，请重新准备')
                try:
                    if self.client.get('/v1/models').is_success: break
                except httpx.RequestError: pass
                time.sleep(.4)
            else: raise RuntimeError('Flow 连接组件启动超时')
            self.backend_ready=True
            # The current Chrome user owns the session. Import it from the
            # extension instead of restoring a second keychain cookie copy.

    def connect(self):
        if self.active:raise RuntimeError('请等待 Flow 当前任务完成后再登录')
        self.start_backend()
        self.desktop_request('/fmworker/open-login')
        self.last_sync=0
        # A task can be claimed while the browser request is in flight. The
        # state lock orders this write against tick() publishing that claim.
        with self.state.lock:
            current=self.state.get('resources').get('flow',{})
            if not self.active and not current.get('current_job'):
                self.state.resource('flow',stage='connecting',detail='请在当前 Chrome 用户中完成 Flow 登录')

    def detect(self):
        """Read an existing Flow tab without opening another tab or window."""
        self.start_backend();self.last_sync=0;self.sync()

    def desktop_request(self,path,**kwargs):
        try:response=self.client.post(path,**kwargs)
        except httpx.TimeoutException:
            raise RuntimeError('Flow 浏览器连接超时，请关闭 fmWorker 的登录窗口后重试') from None
        except httpx.RequestError:
            raise RuntimeError('Flow 本机连接已中断，请重新打开 fmWorker 后重试') from None
        if response.is_error:
            try:detail=response.json().get('detail',{})
            except (ValueError,AttributeError):detail={}
            if isinstance(detail,dict) and detail.get('code')=='chrome_bridge_error' and isinstance(detail.get('message'),str):
                raise RuntimeError(detail['message'][:200])
            code=detail.get('exception','') if isinstance(detail,dict) and detail.get('code')=='flow_connection_failed' else ''
            suffix='（'+code+'）' if re.fullmatch(r'[A-Za-z]{1,48}',code) else ''
            raise RuntimeError('Flow 登录窗口未能连接'+suffix+'，请导出诊断记录')
        return response

    def sync(self):
        if not self.client or time.monotonic()-self.last_sync<30:return
        identity=self.state.get('google_identity')
        if not identity:return
        self.last_sync=time.monotonic()
        project=self.state.get('flow_project') or {}
        params={'email':identity['email']}
        if project.get('email')==identity['email']:params['project_id']=project.get('project_id')
        try:response=self.desktop_request('/fmworker/session',json=params,timeout=60)
        except RuntimeError as exc:
            google=self.state.get('google');google['flow']='error';self.state.set('google',google)
            self.state.resource('flow',stage='error',detail=str(exc));raise
        if response.status_code==409: raise RuntimeError('Flow 与 Colab 的 Google 账号不同，请在专用浏览器中切换账号')
        if not response.is_success:return
        result=response.json()
        if not result.get('connected'):
            google=self.state.get('google');google['flow']='login_required';self.state.set('google',google)
            self.state.resource('flow',stage='connecting',detail='请在当前 Chrome 用户中打开已登录的 Flow 页面')
            return
        if result.get('connected'):
            if result.get('project_id'):
                self.state.set('flow_project',{'email':identity['email'],'project_id':result['project_id']})
            google=self.state.get('google');first=google.get('flow')!='connected';google['flow']='connected';self.state.set('google',google)
            if first:self.state.event('Flow 已连接','已复用当前 Chrome 用户')
            self.state.resource('flow',stage='ready' if self.state.get('resources')['flow']['enabled'] else 'paused',detail='Flow 已连接')

    def capabilities(self):
        result=self.client.get('/v1/models');result.raise_for_status()
        upstream={r['id'] for r in result.json().get('data',[])}
        catalog=json.loads(bundled('flow_models.json').read_text(encoding='utf-8'))
        # The platform catalog owns identifiers; do not invent advertised models.
        if isinstance(catalog,dict) and 'models' in catalog:catalog=catalog['models']
        items=catalog.items() if isinstance(catalog,dict) else ((r['id'],r) for r in catalog)
        return {'models':[key for key,value in items if value.get('upstream') in upstream]}

    def tick(self):
        if not self.client or not self.backend_ready:return
        if self.active:return
        if self.chrome and not self.chrome.status()['connected']:
            self.state.resource('flow',stage='connecting',detail='Chrome 扩展已断开，请保持当前 Chrome 用户打开')
            google=self.state.get('google');google['flow']='disconnected';self.state.set('google',google)
            return
        self.sync()
        resource=self.state.get('resources').get('flow',{})
        if not resource.get('enabled') or self.active or self.state.get('google').get('flow')!='connected':return
        caps=self.capabilities()
        self.platform.beat('flow','ready',caps)
        job=self.platform.claim('flow')
        if not job:return
        self.active=job
        self.state.resource('flow',stage='busy',current_job=job['id'],detail='正在生成')
        threading.Thread(target=self.execute,args=(job,caps),daemon=True,name='flow-generation').start()

    def execute(self,job,caps):
        folder=self.root/'jobs'/str(job['id']);folder.mkdir(parents=True,exist_ok=True)
        saved=None
        try:
            prior=json.loads((folder/'assignment.json').read_text(encoding='utf-8'))
            if prior.get('ticket')==job['ticket']:saved=json.loads((folder/'state.json').read_text(encoding='utf-8'))
        except (FileNotFoundError,ValueError):pass
        atomic(folder/'assignment.json',job)
        stop=threading.Event()
        def heartbeat():
            while not stop.wait(15):
                try:
                    value=self.platform.beat('flow','busy',caps,ticket=job['ticket'])
                    if not value['held']:stop.set()
                except Exception:pass
        threading.Thread(target=heartbeat,daemon=True).start()
        try:
            if saved and saved.get('state')=='uploading':
                self.deliver(job,Path(saved['path']),saved.get('metadata',{}),stop)
                atomic(folder/'state.json',{'state':'done'})
                self.state.event('Flow 成品已恢复回传',f"任务 #{job['id']}")
                return
            if saved and saved.get('state') in ('dispatching','done'):
                raise RuntimeError('已有请求结果未确认，不会重复提交生成')
            content=[{'type':'text','text':job['prompt']}]
            cred=self.platform.credential('flow')
            for ref in job['refs']:
                raw=self.platform.request('GET',f"/agent/jobs/{job['id']}/ref/{ref}",secret=cred['secret'],ticket=job['ticket']).content
                content.append({'type':'image_url','image_url':{'url':'data:'+image_mime(raw)+';base64,'+base64.b64encode(raw).decode()}})
            source=job.get('flow_input',{}).get('source_media_id')
            if source:content.append({'type':'image_url','image_url':{'url':'extend://'+source}})
            # Persist ambiguity before transmission. A restart never resubmits it.
            atomic(folder/'state.json',{'state':'dispatching','ticket':job['ticket']})
            chunks=[];total=0
            with self.client.stream('POST','/v1/chat/completions',json={'model':job['flow']['upstream'],'messages':[{'role':'user','content':content}],'stream':True},timeout=1800) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if stop.is_set():raise RuntimeError('任务已取消或已由平台收回')
                    total+=len(line)
                    if total>8*1024*1024:raise RuntimeError('生成响应过大')
                    if not line.startswith('data:'):continue
                    text=line[5:].strip()
                    if text=='[DONE]':break
                    data=json.loads(text)
                    if data.get('error'):raise generation_failure(data['error'])
                    for choice in data.get('choices',[]):
                        value=choice.get('delta',choice.get('message',{})).get('content','')
                        if isinstance(value,str):chunks.append(value)
            text=''.join(chunks)
            match=re.search(r'<video\b[^>]*\bsrc=[\"\']([^\"\']+)',text) if job['kind']=='video' else re.search(r'!\[[^\]]*\]\(([^\s)]+)\)',text)
            if not match:raise RuntimeError('Flow 未返回可识别的成品')
            url=html.unescape(match.group(1));parsed=urlsplit(url)
            own=urlsplit(str(self.client.base_url))
            allowed=(parsed.netloc==own.netloc and parsed.path.startswith('/tmp/')) or (parsed.scheme=='https' and (parsed.hostname in ('storage.googleapis.com','flow-content.google') or (parsed.hostname or '').endswith('.googleusercontent.com')))
            if not allowed or parsed.username or parsed.password:raise RuntimeError('Flow 成品地址无效')
            path=folder/('result.mp4' if job['kind']=='video' else 'result.png')
            with httpx.stream('GET',url,timeout=120,follow_redirects=False) as response,path.open('wb') as out:
                response.raise_for_status();size=0
                for chunk in response.iter_bytes():
                    size+=len(chunk)
                    if size>64*1024*1024:raise RuntimeError('成品超过 64 MB')
                    out.write(chunk)
            media=re.search(r'data-media-id=[\"\']([A-Za-z0-9_./:-]+)',text)
            metadata={'media_id':media.group(1) if media else ''}
            atomic(folder/'state.json',{'state':'uploading','metadata':metadata,'path':str(path)})
            self.deliver(job,path,metadata,stop)
            atomic(folder/'state.json',{'state':'done'})
            self.state.event('Flow 任务完成',f"任务 #{job['id']} 已回传")
        except Exception as exc:
            message=str(exc) if isinstance(exc,RuntimeError) else '生成或回传未确认，已保留本地记录；不会重复提交生成'
            if isinstance(exc,GenerationRejected):atomic(folder/'state.json',{'state':'rejected','detail':message})
            self.state.resource('flow',stage='error',detail=message)
            self.state.event('Flow 任务失败',f"任务 #{job['id']} · {message}",'error')
            try:self.platform.request('POST',f"/agent/jobs/{job['id']}/error",secret=self.platform.credential('flow')['secret'],ticket=job['ticket'],json={'stage':'error','detail':message})
            except Exception:pass
        finally:
            stop.set();self.finish_job_state()

    def finish_job_state(self):
        self.active=None
        current=self.state.get('resources').get('flow',{})
        changes={'current_job':None}
        if current.get('stage')=='busy':
            changes.update(stage='ready' if current.get('enabled') else 'paused',
                           detail='等待平台分配任务' if current.get('enabled') else '已停止接收新任务')
        self.state.resource('flow',**changes)

    def deliver(self,job,path,metadata,stop):
        deadline=time.monotonic()+120
        credential=self.platform.credential('flow')
        while not stop.is_set():
            try:
                receipt=self.platform.request('GET',f"/agent/jobs/{job['id']}/receipt",secret=credential['secret'],ticket=job['ticket']).json()
                if receipt.get('delivered'):return
                self.platform.upload('flow',job,path,metadata)
                return
            except PlatformError as exc:
                if exc.status is not None and exc.status not in (429,500,502,503,504):raise
                if time.monotonic()>=deadline:raise
                stop.wait(3)
        raise RuntimeError('任务已被平台收回，成品保留在本机')

    def close(self):
        if self.active:return False
        self.backend_ready=False
        if self.process and self.process.poll() is None:
            try:self.client.post('/fmworker/shutdown',timeout=5).raise_for_status()
            except Exception:self.process.terminate()
            try:self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:self.process.kill()
        self.process=None;self.client=None
        return True
