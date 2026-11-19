"""Desktop OAuth in the external browser; tokens go straight to the OS vault."""
import json
import os
import socket
import threading
import time
import webbrowser
from datetime import timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from importlib import resources
from urllib.parse import parse_qs, urlsplit

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/colaboratory', 'https://www.googleapis.com/auth/drive.file']
PLAN_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email',
               'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/cloud-platform']


class Google:
    def __init__(self, state, vault):
        self.state, self.vault = state, vault
        self.lock = threading.Lock()
        self.server = None
        self.cancelled = threading.Event()
        self.authorization_url = None

    def configuration(self):
        configured = self.state.root/'google-client.json'
        if configured.exists(): return json.loads(configured.read_text(encoding='utf-8'))
        return json.loads(resources.files('colab_cli').joinpath('oauth_config.json').read_text(encoding='utf-8'))

    def credentials(self):
        with self.lock:
            saved = self.vault.get('google')
            if not saved: raise RuntimeError('请先连接 Google 账号')
            creds = Credentials.from_authorized_user_info(saved)
            if not creds.valid:
                if not creds.refresh_token: raise RuntimeError('Google 授权已过期，请重新连接')
                creds.refresh(Request())
                self.vault.put('google', json.loads(creds.to_json()))
            return creds

    def plan_credentials(self):
        identity = self.state.get('google_identity') or {}
        saved = self.vault.get('google-plan')
        if saved and saved.get('sub') == identity.get('sub'):
            try:
                creds = Credentials.from_authorized_user_info(saved['credentials'])
                if not creds.valid:
                    creds.refresh(Request())
                    self.vault.put('google-plan', {'sub': identity['sub'], 'credentials': json.loads(creds.to_json())})
                return creds
            except Exception:
                return None
        try:
            creds = self.credentials()
            return creds if creds.has_scopes(['https://www.googleapis.com/auth/cloud-platform']) else None
        except Exception:
            return None

    def begin_plan(self, on_complete):
        if not self.state.get('google_identity'): raise RuntimeError('请先连接 Google 账号')
        return self.begin(on_complete, plan=True)

    def begin(self, on_complete, *, plan=False):
        if self.server: raise RuntimeError('Google 授权窗口已经打开')
        configured = self.state.root/'google-plan-client.json'
        configuration = json.loads(configured.read_text(encoding='utf-8')) if plan and configured.is_file() else self.configuration()
        flow = InstalledAppFlow.from_client_config(configuration, PLAN_SCOPES if plan else SCOPES, autogenerate_code_verifier=True)
        self.cancelled.clear()
        owner = self
        result = {}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                parsed = urlsplit(self.path)
                args = parse_qs(parsed.query)
                valid = (parsed.path == '/' and args.get('state', [''])[0] == result['state'])
                if not valid:
                    self.send_error(400, 'Invalid authorization response'); return
                result['params'] = args
                body = '<!doctype html><meta charset="utf-8"><title>fmWorker</title><p>授权结果已返回 fmWorker，可以关闭此页面。</p>'.encode()
                self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store')
                self.end_headers(); self.wfile.write(body)
        server = HTTPServer(('127.0.0.1', 0), Handler)
        server.timeout = 1; self.server = server
        flow.redirect_uri = f'http://localhost:{server.server_port}/'
        url, nonce = flow.authorization_url(access_type='offline', prompt='select_account consent')
        result['state'] = nonce
        self.authorization_url = url
        status_key = 'google_plan_authorization' if plan else 'google'
        self.state.set(status_key, {'stage': 'authorizing', 'detail': '请在浏览器中选择同一 Google 账号并授权' if plan else '请在浏览器中选择账号并授权'})
        def wait():
            try:
                deadline = time.monotonic()+600
                while 'params' not in result and time.monotonic() < deadline and not self.cancelled.is_set():
                    server.handle_request()
                if self.cancelled.is_set(): raise RuntimeError('已取消授权，可以重新连接')
                params = result.get('params', {})
                if params.get('error'): raise RuntimeError('Google 授权未完成，可重新连接')
                if not params.get('code'): raise RuntimeError('Google 授权已超时，请重新连接')
                flow.fetch_token(code=params['code'][0], timeout=30)
                if self.cancelled.is_set(): raise RuntimeError('已取消授权，可以重新连接')
                creds = flow.credentials
                response = requests.get('https://openidconnect.googleapis.com/v1/userinfo', headers={'Authorization':'Bearer '+creds.token}, timeout=15)
                response.raise_for_status(); profile = response.json()
                if not profile.get('email_verified') or not profile.get('sub'): raise RuntimeError('无法确认 Google 账号')
                old = self.state.get('google_identity')
                if plan:
                    if not old or old.get('sub') != profile['sub']:
                        raise RuntimeError('套餐授权必须使用已连接的同一 Google 账号')
                    if not creds.has_scopes(['https://www.googleapis.com/auth/cloud-platform']):
                        raise RuntimeError('套餐查询权限未获授权，Colab 连接保持有效')
                    self.vault.put('google-plan', {'sub': profile['sub'], 'credentials': json.loads(creds.to_json())})
                    self.state.set(status_key, {'stage': 'connected', 'detail': '补充授权已完成，正在查询套餐'})
                    on_complete()
                    return
                flow_resource=self.state.get('resources').get('flow',{})
                pending=self.state.get('allocation_pending')
                instances = self.state.get('colab_instances', {})
                active = any(r.get('status') != 'released' and r.get('phase') != 'rejected' for r in instances.values())
                in_use=active or self.state.get('managed_colab') or (pending and pending.get('phase')!='unassigned') or flow_resource.get('enabled') or flow_resource.get('current_job')
                if old and old.get('sub') != profile['sub'] and in_use:
                    raise RuntimeError('请先释放现有 Colab 实例，再更换账号')
                self.vault.put('google', json.loads(creds.to_json()))
                self.state.set('google_identity', {'sub':profile['sub'], 'email':profile['email']})
                if not old or old.get('sub') != profile['sub']:
                    self.state.set('colab_account', None)
                    self.state.set('google_plan_authorization', {})
                    self.vault.delete('google-plan')
                self.state.set('google', {'stage':'connected', 'email':profile['email'], 'detail':'Colab 已授权'})
                on_complete()
            except Exception as exc:
                # Never expose OAuth response bodies, URLs or codes through status.
                self.state.set(status_key, {'stage':'error', 'detail':str(exc) if isinstance(exc, RuntimeError) else 'Google 授权未完成，请检查网络或 OAuth 客户端配置'})
            finally:
                server.server_close(); self.server = None; self.authorization_url = None
        threading.Thread(target=wait, daemon=True, name='google-oauth').start()
        if not webbrowser.open(url):
            self.state.event('打开授权页面', '默认浏览器未响应，请检查系统浏览器设置', 'error')

    def reopen(self):
        if not self.authorization_url: raise RuntimeError('授权页面已过期，请重新连接')
        webbrowser.open(self.authorization_url)

    def cancel(self):
        if not self.server:return
        self.cancelled.set()

    def drive_access(self):
        creds = self.drive_credentials()
        # Deliberately exclude refresh_token, client_secret and unrelated metadata.
        expiry = creds.expiry
        if expiry is not None and expiry.tzinfo is None: expiry = expiry.replace(tzinfo=timezone.utc)
        return {'access_token':creds.token, 'expires_at':expiry.timestamp() if expiry else time.time()+300}

    def drive_credentials(self):
        primary=self.credentials()
        scope='https://www.googleapis.com/auth/drive.file'
        restricted=Credentials(token=None,refresh_token=primary.refresh_token,token_uri=primary.token_uri,
                               client_id=primary.client_id,client_secret=primary.client_secret,scopes=[scope])
        restricted.refresh(Request())
        # Google may decline or ignore a narrower refresh scope. Check the actual
        # token and fail closed rather than export Colab management privileges.
        response=requests.get('https://oauth2.googleapis.com/tokeninfo',params={'access_token':restricted.token},timeout=15)
        response.raise_for_status()
        actual=set(response.json().get('scope','').split())
        allowed={scope,'openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile'}
        if scope not in actual or not actual<=allowed:
            raise RuntimeError('Google 未签发独立 Drive 短期权限，请关闭缓存后连接；完整账号权限不会传入云端')
        return restricted

    def disconnect(self):
        pending=self.state.get('allocation_pending')
        active = any(r.get('status') != 'released' and r.get('phase') != 'rejected' for r in self.state.get('colab_instances', {}).values())
        if active or self.state.get('managed_colab') or (pending and pending.get('phase')!='unassigned'): raise RuntimeError('请先确认并释放 Colab 实例')
        self.vault.delete('google')
        self.vault.delete('google-plan')
        self.state.set('colab_account', None)
        self.state.set('google_plan_authorization', {})
        self.state.set('google_identity', None); self.state.set('google', {})
