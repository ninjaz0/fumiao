import hashlib
import json
import re
import secrets
from urllib.parse import urlsplit
import httpx


class PlatformError(RuntimeError):
    def __init__(self,message,status=None):
        super().__init__(message)
        self.status=status


def validate_site(site):
    u = urlsplit(site)
    local = u.hostname in ('127.0.0.1', 'localhost', '::1')
    if u.scheme != 'https' and not (u.scheme == 'http' and local):
        raise PlatformError('平台地址需要 HTTPS')
    if u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
        raise PlatformError('请填写平台根地址')
    return site.rstrip('/')


class Platform:
    def __init__(self, state, vault):
        self.state, self.vault = state, vault
        self.site = validate_site(state.get('site'))
        self.client = httpx.Client(base_url=self.site, timeout=40, follow_redirects=False,
                                   headers={'User-Agent': 'Fumiao-Worker/1.0'})
        session = vault.get('platform:'+self.site)
        if session: self.client.cookies.set('fm_session', session['cookie'])

    def request(self, method, path, *, secret=None, ticket=None, **kwargs):
        headers = kwargs.pop('headers', {})
        if secret: headers['Authorization'] = 'Bearer '+secret
        if ticket: headers['X-Job-Ticket'] = ticket
        try:
            response = self.client.request(method, path, headers=headers, **kwargs)
        except httpx.RequestError:
            raise PlatformError('无法连接弗淼，请检查网络后重试') from None
        if response.status_code >= 400:
            try: message = response.json().get('detail', '')
            except ValueError: message = ''
            if response.status_code == 404 and path.startswith('/api/fmworker') and message in ('', 'Not Found'):
                message = '平台尚未安装 fmWorker 接入更新'
            if not isinstance(message, str): message = '请求参数无效'
            raise PlatformError(message[:240] or f'平台请求失败（{response.status_code}）',response.status_code)
        if 300 <= response.status_code < 400: raise PlatformError('平台返回了意外跳转')
        return response

    def login(self, name, password):
        self.request('POST', '/api/login', json={'name': name, 'password': password})
        cookie = self.client.cookies.get('fm_session')
        if not cookie: raise PlatformError('未收到登录凭据')
        account = self.request('GET', '/api/fmworker/account').json()
        self.vault.put('platform:'+self.site, {'cookie': cookie})
        self.state.set('account', account['user'])
        return account

    def logout(self):
        if self.client.cookies.get('fm_session'):
            try:self.request('POST','/api/logout',timeout=8)
            except PlatformError:pass
        self.vault.delete('platform:'+self.site)
        self.client.cookies.clear()
        self.state.set('account', None)

    def register(self, kind):
        account = self.state.get('account')
        if not account: raise PlatformError('请先登录弗淼')
        key = f"resource:{self.site}:{account['id']}:{kind}"
        stored = self.vault.get(key)
        if stored and stored.get('id'):
            current = self.request('GET', '/api/fmworker/account').json()
            if current['user']['id'] != account['id']:
                raise PlatformError('登录账号已变化，请重新登录弗淼')
            if not any(r['id'] == stored['id'] for r in current['resources']):
                # An explicit Start reconnects a removed resource with a new
                # credential. Never revive the revoked key or alter its history.
                stored = None
        if not stored:
            stored = {'secret': secrets.token_urlsafe(48)}
            self.vault.put(key, stored)  # Durable before request: retries use same idempotency key.
        result = self.request('POST', '/api/fmworker/resources', json={
            'kind': kind, 'name': {'breeze':'fmWorker · Breeze', 'flow':'fmWorker · Flow', 'colab':'fmWorker · Colab'}[kind],
            'secret': stored['secret']}).json()
        stored['id'] = result['id']; self.vault.put(key, stored)
        self.state.resource(kind, node=result['id'])
        return stored

    def credential(self, kind):
        account = self.state.get('account')
        if not account: return None
        return self.vault.get(f"resource:{self.site}:{account['id']}:{kind}")

    def register_colab(self, instance_id, name):
        """Each H3 runtime owns a distinct model-worker node and credential."""
        account = self.state.get('account')
        if not account: raise PlatformError('请先登录弗淼')
        key = f"resource:{self.site}:{account['id']}:colab:{instance_id}"
        stored = self.vault.get(key)
        if not stored:
            stored = {'secret': secrets.token_urlsafe(48)}
            self.vault.put(key, stored)
        result = self.request('POST', '/api/fmworker/resources', json={
            'kind': 'colab', 'name': name[:45], 'secret': stored['secret']}).json()
        stored['id'] = result['id']
        self.vault.put(key, stored)
        return stored

    def configure_colab(self, node, enabled):
        return self.request('PUT', f'/api/fmworker/resources/{int(node)}', json={'enabled': bool(enabled)}).json()

    def configure(self, kind, enabled):
        cred = self.credential(kind) or self.register(kind)
        # Compatibility with servers before the feature was removed: never
        # allow their old defaults to recreate a contribution budget.
        legacy={'timezone':'Asia/Shanghai','start':'00:00','end':'00:00','daily_tasks':None,'monthly_tasks':None,'daily_units':None,'monthly_units':None}
        self.request('PUT', f"/api/fmworker/resources/{cred['id']}", json={'enabled': enabled, 'limits': legacy})
        self.state.resource(kind, enabled=enabled)

    def beat(self, kind, stage, capabilities, ticket='', **extra):
        cred = self.credential(kind)
        return self.request('POST', '/fmworker/heartbeat', secret=cred['secret'], json={
            'stage': stage, 'capabilities': capabilities, 'ticket': ticket, **extra}).json()

    def claim(self, kind):
        return self.request('POST', '/fmworker/claim', secret=self.credential(kind)['secret']).json()['job']

    def upload(self, kind, job, path, metadata=None):
        metadata = metadata or {}
        cred = self.credential(kind)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        headers = {'X-SHA256': digest, 'Content-Type': 'video/mp4' if job['kind']=='video' else 'audio/wav' if job['kind']=='audio' else 'application/octet-stream'}
        if metadata.get('media_id'): headers['X-Flow-Media-ID'] = metadata['media_id']
        if kind != 'flow': headers['X-Job-Timing'] = json.dumps(metadata)
        route = '/fmworker' if kind == 'flow' else '/agent'
        with path.open('rb') as stream:
            return self.request('PUT', f"{route}/jobs/{job['id']}/result", secret=cred['secret'], ticket=job['ticket'], headers=headers, content=stream, timeout=180).json()
