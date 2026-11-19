"""Authenticated, loopback-only transport for the paired Chrome extension.

Chrome owns the real browser profile. No debugging flags, profile copies, or
browser credential databases are used. Browser commands are fixed operations.
"""
import base64
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .assets import bundled
from .state import atomic

HOST_NAME='com.nvmes.fmworker'
MAX_PACKET=262144
ALLOWED_COMMANDS={'open_flow','session','captcha'}
CAPTCHA_ACTIONS={'IMAGE_GENERATION','VIDEO_GENERATION','UPLOAD_IMAGE'}


def extension_manifest():
    return json.loads(bundled('chrome-extension/manifest.json').read_text(encoding='utf-8'))


def extension_id():
    digest=hashlib.sha256(base64.b64decode(extension_manifest()['key'])).hexdigest()[:32]
    return ''.join(chr(ord('a')+int(c,16)) for c in digest)


def chrome_binary():
    if platform.system()=='Darwin':
        path=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        return str(path) if path.is_file() else None
    for name in ('PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA'):
        path=Path(os.environ.get(name,''))/'Google/Chrome/Application/chrome.exe'
        if path.is_file():return str(path)
    return shutil.which('google-chrome') or shutil.which('chromium')


def current_chrome_profile():
    if platform.system()=='Darwin':root=Path.home()/'Library/Application Support/Google/Chrome'
    elif platform.system()=='Windows':root=Path(os.environ.get('LOCALAPPDATA',''))/'Google/Chrome/User Data'
    else:root=Path.home()/'.config/google-chrome'
    try:
        profile=json.loads((root/'Local State').read_text(encoding='utf-8')).get('profile',{})
        cache=profile.get('info_cache',{})
        candidates=[profile.get('last_used')]+list(profile.get('last_active_profiles',[]))
        for directory in candidates:
            if isinstance(directory,str) and re.fullmatch(r'Default|Profile [0-9]+',directory) and directory in cache:
                return directory
    except (OSError,ValueError,TypeError):pass
    raise RuntimeError('未识别到当前 Chrome 用户。请在已经打开的 Chrome 地址栏输入 chrome://extensions 打开扩展管理')


class ChromeBridge:
    def __init__(self,state,start=True):
        self.state=state;self.lock=threading.RLock();self.pending={}
        self.owner=None;self.last_seen=0.;self.client_version='';self.server=None
        self.secret=secrets.token_urlsafe(48);self.port=0
        self.folder=state.root/'chrome-extension'
        if start:
            self.start()
            self.refresh_registration()

    def refresh_registration(self):
        """Update an already-authorized host when the app moves or upgrades."""
        path=(Path.home()/'Library/Application Support/Google/Chrome/NativeMessagingHosts'/f'{HOST_NAME}.json'
              if platform.system()=='Darwin' else self.state.root/'chrome-native-host.json')
        if not path.is_file() or not (self.folder/'manifest.json').is_file():return
        try:
            saved=json.loads(path.read_text(encoding='utf-8'))
            if saved.get('allowed_origins')==['chrome-extension://'+extension_id()+'/']:self.prepare()
        except (OSError,ValueError,RuntimeError):
            self.state.event('Chrome 连接组件需要更新','请在 Flow 页面重新准备扩展','error')

    def connected(self):
        return bool(self.owner and time.monotonic()-self.last_seen<8)

    def status(self):
        with self.lock:
            prepared=(self.folder/'manifest.json').is_file()
            connected=self.connected()
            current=extension_manifest()['version']
            outdated=connected and self.client_version!=current
            return {'prepared':prepared,'connected':connected and not outdated,
                    'stage':'update_required' if outdated else 'connected' if connected else 'waiting' if prepared else 'not_installed',
                    'version':current,'client_version':self.client_version,'extension_id':extension_id(),
                    'folder':str(self.folder) if prepared else '', 'distribution':'unpacked'}

    def start(self):
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                if self.path!='/bridge' or self.headers.get('Origin') or not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+owner.secret):
                    self.send_error(403);return
                try:length=int(self.headers.get('Content-Length','0'))
                except ValueError:self.send_error(400);return
                if not 0<length<=MAX_PACKET:self.send_error(413);return
                self.connection.settimeout(8)
                try:
                    packet=json.loads(self.rfile.read(length))
                    out={'result':owner.dispatch(packet)}
                except (ValueError,TypeError,KeyError):out={'error':'扩展请求格式无效'}
                except RuntimeError as exc:out={'error':str(exc)}
                except Exception:out={'error':'扩展连接未完成，请重试'}
                raw=json.dumps(out,ensure_ascii=False).encode()
                self.send_response(200);self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(raw)));self.end_headers()
                try:self.wfile.write(raw)
                except OSError:pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.server.daemon_threads=True;self.port=self.server.server_port
        atomic(self.state.root/'chrome-bridge.json',{'port':self.port,'secret':self.secret})
        threading.Thread(target=self.server.serve_forever,daemon=True,name='chrome-bridge').start()

    def close(self):
        if self.server:self.server.shutdown();self.server.server_close();self.server=None
        path=self.state.root/'chrome-bridge.json'
        try:
            if json.loads(path.read_text()).get('secret')==self.secret:path.unlink()
        except (OSError,ValueError):pass

    def request(self,kind,payload=None,timeout=25):
        if kind not in ALLOWED_COMMANDS:raise ValueError('不支持的扩展操作')
        with self.lock:
            if not self.status()['connected']:raise RuntimeError('请先在当前 Chrome 用户中安装并连接 fmWorker 扩展')
            if len(self.pending)>=8:raise RuntimeError('扩展正在处理其他请求，请稍后重试')
            ident=secrets.token_urlsafe(24)
            item={'id':ident,'kind':kind,'payload':payload or {},'owner':self.owner,
                  'deadline':time.monotonic()+timeout,'sent':False,'event':threading.Event()}
            self.pending[ident]=item
        try:
            if not item['event'].wait(timeout):raise RuntimeError('Chrome 扩展响应超时，请保持 Chrome 打开后重试')
            result=item.get('result',{})
            if not result.get('ok'):
                labels={'wrong_account':'Chrome 中的 Flow 账号与已授权 Google 账号不同，请在 Flow 页面切换账号',
                        'cookie_permission_missing':'扩展缺少 Google 账号 Cookie 权限，请按安装向导更新连接助手',
                        'cookie_read_failed':'无法读取 Flow 登录状态，请检查连接助手的 Flow 站点权限',
                        'account_cookies_missing':'未取得 Google 账号 Cookie，请刷新已登录的 Flow 页面后重试',
                        'flow_session_missing':'未取得 Flow 页面会话，请刷新已登录的 Flow 页面后重试',
                        'login_required':'请先在当前 Chrome 用户中登录 Flow',
                        'page_unavailable':'Flow 页面未就绪，请打开 Flow 后重试',
                        'verification_failed':'Flow 页面验证未完成，请在 Chrome 中检查后重试'}
                raise RuntimeError(labels.get(result.get('error'),'Chrome 扩展操作未完成，请重试'))
            return result
        finally:
            with self.lock:self.pending.pop(ident,None)

    def dispatch(self,packet):
        op=packet.get('op');client=packet.get('client','')
        if op in ('poll','result','disconnect'):
            if not isinstance(client,str) or not 16<=len(client)<=80:raise ValueError()
            with self.lock:
                if self.connected() and self.owner!=client:raise RuntimeError('另一个 Chrome 用户已连接，请先从该用户的扩展中断开')
                if op=='poll':
                    newly_connected=not self.connected()
                    self.owner=client;self.last_seen=time.monotonic()
                    self.client_version=str(packet.get('version',''))[:32]
                    if newly_connected:self.state.event('Chrome 扩展已连接' if self.status()['connected'] else 'Chrome 扩展需要更新')
                    commands=[]
                    for item in self.pending.values():
                        if item['owner']==client and not item['sent'] and item['deadline']>time.monotonic():
                            item['sent']=True;commands.append({k:item[k] for k in ('id','kind','payload')})
                    current=self.status()['connected']
                    return {'connected':current,'reason':'' if current else 'update_required','commands':commands}
                if client!=self.owner:raise RuntimeError('扩展连接已过期')
                if op=='disconnect':
                    self.owner=None;self.last_seen=0
                    for item in self.pending.values():
                        item['result']={'ok':False,'error':'disconnected'};item['event'].set()
                    return {'ok':True}
                item=self.pending.get(packet.get('id'))
                if not item or item['owner']!=client or not item['sent']:raise RuntimeError('扩展响应已过期')
                result=packet.get('result')
                if not isinstance(result,dict):raise ValueError()
                item['result']=result;item['event'].set();return {'ok':True}
        if op=='status':return self.status()
        if op=='browser':
            expected=self.state.get('google_identity',{}).get('email','')
            payload=dict(packet.get('payload') or {});payload['expected_email']=expected
            if not expected:raise RuntimeError('请先连接 Google 账号')
            kind=packet.get('kind')
            if kind=='captcha' and payload.get('action') not in CAPTCHA_ACTIONS:raise ValueError()
            return self.request(kind,payload,timeout=60 if kind=='captcha' else 25)
        raise ValueError('未知扩展操作')

    def prepare(self):
        source=bundled('chrome-extension')
        self.folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        for path in source.iterdir():
            if path.is_file():shutil.copy2(path,self.folder/path.name)
        configured=os.environ.get('FMWORKER_NATIVE_EXECUTABLE')
        if configured:executable=Path(configured)
        elif getattr(sys,'frozen',False):executable=Path(sys.executable).with_name('fmworker.exe' if os.name=='nt' else 'fmworker')
        else:raise RuntimeError('请在 fmWorker 桌面软件中准备扩展')
        if not executable.is_absolute() or not executable.is_file():raise RuntimeError('本机连接组件缺失，请重新安装 fmWorker')
        host={'name':HOST_NAME,'description':'fmWorker Chrome connection','path':str(executable),'type':'stdio',
              'allowed_origins':['chrome-extension://'+extension_id()+'/']}
        if platform.system()=='Darwin':
            target=Path.home()/'Library/Application Support/Google/Chrome/NativeMessagingHosts'/f'{HOST_NAME}.json'
            atomic(target,host)
        elif platform.system()=='Windows':
            import winreg
            target=self.state.root/'chrome-native-host.json';atomic(target,host)
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER,'Software\\Google\\Chrome\\NativeMessagingHosts\\'+HOST_NAME) as key:
                winreg.SetValueEx(key,'',0,winreg.REG_SZ,str(target))
        else:raise RuntimeError('首版扩展安装向导支持 Windows 和 Mac')
        self.state.event('Chrome 扩展已准备','请在当前 Chrome 用户中加载连接助手')
        return self.status()

    def open_extensions(self):
        binary=chrome_binary()
        if not binary:raise RuntimeError('请先安装 Google Chrome')
        # Explicitly target the last active real profile; a bare launch can
        # open Chrome's profile picker even while that user's window is open.
        profile=current_chrome_profile()
        subprocess.Popen([binary,'--profile-directory='+profile,'chrome://extensions/'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return {'ok':True}

    def reveal(self):
        if not (self.folder/'manifest.json').exists():raise RuntimeError('请先准备扩展')
        command=['open',str(self.folder)] if platform.system()=='Darwin' else ['explorer.exe',str(self.folder)]
        subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return {'ok':True}
