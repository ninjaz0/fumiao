import hashlib
import json
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote
import requests
from colab_cli.contents import ContentsClient as OfficialContentsClient

from .assets import bundled
from .state import atomic
from .platform import PlatformError
from .colab_account import AccountProbe, empty_account


def allocation_rejection(exc):
    """Only explicit admission rejections are final; transport failures are not."""
    from colab_cli.client import ColabRequestError, TooManyAssignmentsError
    if isinstance(exc, TooManyAssignmentsError): return 412
    if isinstance(exc, ColabRequestError):
        status = getattr(exc.response, 'status_code', None)
        if status in (400, 401, 403, 412, 429): return status
    return None


class ContentsClient(OfficialContentsClient):
    """The official content protocol with bounded network waits."""
    def _request(self, method, path, params=None, json_data=None):
        query = {'authuser': '0', 'colab-runtime-proxy-token': self.token}
        query.update(params or {})
        response = requests.request(method, self.base_url + '/api/contents/' + quote(path.strip('/'), safe='/'),
                                    params=query, json=json_data, timeout=(10, 60))
        if response.status_code == 404: raise FileNotFoundError('Colab 路径不存在')
        response.raise_for_status()
        return None if method == 'DELETE' else response.json()


def runtime_ready(session):
    response = requests.get(session.url.rstrip('/') + '/api/kernels',
        headers={'Accept': 'application/json', 'X-Colab-Client-Agent': 'colab-cli',
                 'X-Colab-Runtime-Proxy-Token': session.token, 'Authorization': 'Bearer ' + session.token},
        params={'authuser': '0', 'colab-runtime-proxy-token': session.token}, timeout=10)
    return response.status_code == 200


class Colab:
    def __init__(self, state, vault, google, platform):
        self.state, self.vault, self.google, self.platform = state, vault, google, platform
        self.lock = threading.RLock()
        self.last_tick = 0
        self.probe = AccountProbe(state, google)
        self.migrate_legacy()

    def migrate_legacy(self):
        """Local bookkeeping only; never reconnect, allocate, or stop on upgrade."""
        if self.state.get('colab_legacy_migrated'): return
        managed = self.state.get('managed_colab')
        pending = self.state.get('allocation_pending')
        account = self.state.get('account') or {}
        if not account.get('id') or not (managed or pending): return
        old_session = self.vault.get('colab-session')
        if managed and old_session:
            ident = 'legacy-' + hashlib.sha256(str(old_session['endpoint']).encode()).hexdigest()[:24]
            phase = 'running'
        elif pending:
            ident = 'legacy-' + str(pending['request_id']).replace('-', '')[:24]
            phase = 'uncertain'
        else: return
        settings = (managed or {}).get('settings', self.state.get('settings', {}))
        record = {'id': ident, 'request_id': (pending or {}).get('request_id'), 'name': '旧版 Colab 实例',
                  'purpose': 'h3', 'gpu': settings.get('gpu', (pending or {}).get('gpu', 'G4')),
                  'variant': 'GPU', 'high_memory': False, 'status': 'offline', 'phase': phase,
                  'detail': '旧版实例；原版本运行限制仍可能生效',
                  'node': self.state.get('resources', {}).get('colab', {}).get('node'),
                  'started_at': (managed or {}).get('started_at', (pending or {}).get('created_at', time.time())),
                  'owner': (managed or {}).get('owner', account['id']), 'site': self.state.get('site'),
                  'google_sub': (self.state.get('google_identity') or {}).get('sub'), 'legacy': True,
                  'settings': settings}
        records = self.records()
        records.setdefault(ident, record)
        self.state.set('colab_instances', records)
        if old_session: self.vault.put('colab-session:' + ident, old_session)
        self.state.set('colab_legacy_migrated', True)

    def client(self):
        from colab_cli.client import Client, Prod, Assignment
        from google.auth.transport.requests import AuthorizedSession
        os.environ.setdefault('COLAB_CLI_REQUEST_TIMEOUT', '45')
        class SingleAttemptClient(Client):
            def assign(self, notebook_hash, variant=None, accelerator=None, shape=None):
                # SDK retries can hide an earlier timed-out POST behind a later
                # 4xx. Keep each user-triggered attempt observable and durable.
                current = self._get_assignment(notebook_hash, variant, accelerator, shape)
                if isinstance(current, Assignment): return current
                return self._post_assignment(notebook_hash, current.token, variant, accelerator, shape)
        return SingleAttemptClient(Prod(), AuthorizedSession(self.google.credentials()))

    def records(self):
        return self.state.get('colab_instances', {})

    def owned(self):
        account = self.state.get('account') or {}
        site = getattr(self.platform, 'site', self.state.get('site'))
        return {i: r for i, r in self.records().items() if r.get('owner') == account.get('id') and r.get('site') == site}

    def update(self, instance_id, **changes):
        with self.lock:
            records = self.records()
            records[instance_id] = records[instance_id] | changes
            self.state.set('colab_instances', records)
            return records[instance_id]

    def public_instances(self):
        fields = ('id', 'node', 'name', 'purpose', 'gpu', 'status', 'detail', 'started_at', 'project_id')
        return [{k: record.get(k) for k in fields} for record in self.owned().values()]

    def saved(self, instance_id=None):
        from colab_cli.state import SessionState
        value = self.vault.get('colab-session:' + instance_id if instance_id else 'colab-session')
        return SessionState.model_validate(value) if value else None

    def save_session(self, session, instance_id=None):
        self.vault.put('colab-session:' + instance_id if instance_id else 'colab-session', session.model_dump(mode='json'))

    def refresh_session(self, instance_id):
        session = self.saved(instance_id)
        if not session: return None
        if not self.same_google(self.owned().get(instance_id, {})):
            raise RuntimeError('请连接创建此实例的 Google 账号后核对')
        assignments = self.client().list_assignments()
        assignment = next((a for a in assignments if a.endpoint == session.endpoint), None)
        if not assignment:
            self.mark_gone(instance_id)
            return None
        session.token = assignment.runtime_proxy_info.token
        session.url = assignment.runtime_proxy_info.url
        session.token_expires_at = assignment.runtime_proxy_info.expires_at()
        self.save_session(session, instance_id)
        return session

    def execute(self, session, code, timeout=90, instance_id=None):
        from colab_cli.runtime import ColabRuntime
        def kernel(value):
            session.kernel_id = value
            self.save_session(session, instance_id)
        def sid(value):
            session.session_id = value
            self.save_session(session, instance_id)
        runtime = ColabRuntime(session.url, session.token, kernel_id=session.kernel_id, session_id=session.session_id,
                               on_kernel_started=kernel, on_session_started=sid)
        try:
            outputs = runtime.execute_code(code, allow_stdin=False, timeout=timeout)
            if any(item.get('output_type') == 'error' for item in outputs):
                raise RuntimeError('Colab 命令执行失败，实例已保留，可重试连接或主动释放')
            return outputs
        finally:
            runtime.stop(shutdown_kernel=False)

    def select(self, accelerator, high_memory=False):
        if not isinstance(accelerator, str) or not accelerator: raise RuntimeError('请先选择实例类型')
        if not isinstance(high_memory, bool): raise RuntimeError('实例内存规格无效')
        info = self.state.get('colab_account') or empty_account()
        if info['status'] != 'ready' or time.time() - (info.get('checked_at') or 0) > 300:
            info = self.probe.run()
        if info['status'] != 'ready': raise RuntimeError('请先完成 Colab 权益检测，再选择实例类型')
        ident = accelerator.upper()
        if ident.endswith('-HIGH_RAM'): high_memory = True
        rows = info['eligible_accelerators']
        entry = next((r for r in rows if r['id'] == ident and (r.get('high_memory') is None or r.get('high_memory') == high_memory)), None)
        if not entry and high_memory:
            entry = next((r for r in rows if r['id'] == ident + '-HIGH_RAM' and r.get('high_memory') is True), None)
        explicit_cpu = entry and entry['variant'] == 'CPU' and entry.get('eligible') is None
        if not entry or (entry.get('eligible') is not True and not explicit_cpu): raise RuntimeError('账号当前未确认可申请此实例类型，请重新检测或选择其他类型')
        if high_memory and entry.get('high_memory') is None:
            raise RuntimeError('此账号的高内存资格尚未确认，请选择标准规格')
        return entry

    @staticmethod
    def allocation_options(record):
        from colab_cli.client import Accelerator, Variant, Shape
        gpu = record['gpu']
        variant = {'CPU': Variant.DEFAULT, 'GPU': Variant.GPU, 'TPU': Variant.TPU}[record['variant']]
        try: accelerator = None if variant == Variant.DEFAULT else Accelerator(gpu)
        except ValueError: raise RuntimeError('当前 Colab 客户端尚不支持该实例类型，请更新 fmWorker') from None
        return {'variant': variant, 'accelerator': accelerator,
                'shape': Shape.HIGH_RAM if record.get('high_memory') else None}

    def new_record(self, purpose, entry):
        account = self.state.get('account')
        identity = self.state.get('google_identity') or {}
        if not account: raise RuntimeError('请先登录弗淼')
        if not identity.get('sub'): raise RuntimeError('请重新连接 Google 账号以确认实例归属')
        gpu = entry['id'].removesuffix('-HIGH_RAM')
        # A repeated click after a timeout resumes the durable request. It cannot
        # create a second charged runtime while the first outcome is unknown.
        unresolved = [r for r in self.owned().values() if r.get('phase') in ('requesting', 'uncertain', 'allocated', 'setup_failed')]
        if unresolved:
            if any(r.get('legacy') for r in unresolved): raise RuntimeError('请先核对并主动释放旧版未完成的实例申请')
            match = next((r for r in unresolved if r['purpose'] == purpose and r['gpu'] == gpu and
                          r.get('high_memory') == bool(entry.get('high_memory'))), None)
            if not match: raise RuntimeError('请先继续连接或主动释放上一次未完成的实例申请')
            return match
        instance_id = uuid.uuid4().hex
        record = {'id': instance_id, 'request_id': str(uuid.uuid4()), 'name': ('H3 · ' if purpose == 'h3' else 'Colab · ') + gpu + ' · ' + instance_id[:6],
                  'purpose': purpose, 'gpu': gpu, 'variant': entry['variant'], 'high_memory': bool(entry.get('high_memory')),
                  'status': 'connecting', 'detail': '正在准备申请', 'phase': 'requesting', 'node': None,
                  'registered': False, 'allocation_submitted': False,
                  'started_at': time.time(), 'owner': account['id'], 'site': self.platform.site,
                  'google_sub': identity.get('sub'), 'settings': dict(self.state.get('settings', {}))}
        self.allocation_options(record)  # Reject unsupported SDK enums before registering or allocating.
        records = self.records()
        records[instance_id] = record
        self.state.set('colab_instances', records)
        return record

    def start(self, accelerator, high_memory=False):
        return self.create('compute', accelerator, high_memory)

    def deploy(self):
        return self.create('h3', 'G4', False)

    def create(self, purpose, accelerator, high_memory=False):
        with self.lock:
            # Drive authorization is checked before any paid allocation.
            settings = self.state.get('settings', {})
            access = self.google.drive_access() if purpose == 'h3' and settings.get('drive_cache') else None
            entry = self.select(accelerator, high_memory)
            record = self.new_record(purpose, entry)
            instance_id = record['id']
            node_cred = None
            if purpose == 'h3':
                node_cred = self.platform.register_colab(instance_id, record['name'])
                record = self.update(instance_id, node=node_cred['id'])
            record = self.update(instance_id, registered=True)
            session = self.saved(instance_id)
            if session:
                session = self.refresh_session(instance_id)
                if not session: raise RuntimeError('上一次实例已被 Google 回收，请重新开始')
            if not session:
                from colab_cli.state import SessionState
                options = self.allocation_options(record)
                self.update(instance_id, phase='requesting', allocation_submitted=True, status='connecting', detail='正在申请 ' + record['gpu'] + ' 实例')
                try:
                    result = self.client().assign(uuid.UUID(record['request_id']), **options)
                except Exception as exc:
                    rejected = allocation_rejection(exc)
                    if rejected and not record.get('allocation_submitted') and not record.get('allocation_uncertain') and record.get('phase') != 'uncertain':
                        detail = {400: 'Colab 拒绝了此机型或申请参数，可重新检测并选择其他机型',
                                  401: 'Google 授权未通过，可重新授权后再申请',
                                  403: 'Google 未允许此实例申请，可重新检测或选择其他机型',
                                  412: 'Colab 配额或并发条件暂不满足，可稍后重试或选择其他机型',
                                  429: 'Colab 请求过于频繁，请稍后重试'}[rejected]
                        self.update(instance_id, phase='rejected', status='error', allocation_submitted=False,
                                    rejection_status=rejected, detail=detail, provider_cleanup_pending=True)
                        try: self.cleanup_rejection(instance_id)
                        except Exception: pass  # Metadata cleanup is retried; no runtime was allocated.
                        raise RuntimeError(detail + f'（{rejected}）') from None
                    self.update(instance_id, phase='uncertain', status='error', allocation_uncertain=True,
                                detail='申请结果未确认；重试会核对原申请，不重复创建')
                    raise RuntimeError('Colab 申请结果未确认，请重试原申请或核对后释放') from None
                session = SessionState(name='fmworker-' + instance_id, token=result.runtime_proxy_info.token,
                    url=result.runtime_proxy_info.url, endpoint=result.endpoint,
                    token_expires_at=result.runtime_proxy_info.expires_at(), variant=options['variant'].value,
                    accelerator=options['accelerator'].value if options['accelerator'] else 'NONE',
                    machine_shape='HIGH_RAM' if record['high_memory'] else 'STANDARD')
                self.save_session(session, instance_id)
                record = self.update(instance_id, phase='allocated', endpoint=session.endpoint)
            try:
                self.bootstrap(record, session, node_cred, access)
                self.update(instance_id, phase='running', status='connecting', detail='H3 已启动，等待模型就绪' if purpose == 'h3' else '实例已启动')
                self.state.resource('colab', enabled=True, stage='preparing', detail='实例已启动，等待平台确认连接')
                self.state.event('Colab 已创建', record['name'])
            except Exception as exc:
                self.update(instance_id, phase='setup_failed', status='error', detail='连接初始化未完成；实例保留，重试继续连接或主动释放')
                if isinstance(exc, RuntimeError): raise
                raise RuntimeError('Colab 连接初始化失败；实例已保留，可重试或主动释放') from None
            return {'id': instance_id}

    def bootstrap(self, record, session, node_cred=None, access=None):
        instance_id = record['id']
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                if runtime_ready(session): break
            except requests.RequestException:
                pass
            time.sleep(2)
        else:
            raise RuntimeError('Colab 初始化超时，实例保留，可重试连接')
        if record['purpose'] != 'h3': return
        root = '/content/fmworker/' + instance_id + '/h3'
        self.execute(session, 'from pathlib import Path; Path(' + repr(root) + ').mkdir(parents=True,exist_ok=True,mode=0o700)', instance_id=instance_id)
        content = ContentsClient(session)
        with tempfile.TemporaryDirectory() as temporary:
            temp = Path(temporary)
            lock = json.loads(bundled('agent.lock.json').read_text(encoding='utf-8'))
            config = {'site': self.platform.site, 'secret': node_cred['secret'], 'model': 'MiniMax H3',
                'cloud': True, 'manual_release_only': True, 'run_id': instance_id,
                'agent_sha256': lock['sha256'], 'started_at': record['started_at'],
                'drive_cache': bool(record['settings'].get('drive_cache'))}
            atomic(temp/'config.json', config)
            content.upload(str(temp/'config.json'), root.lstrip('/') + '/config.json')
            for filename in ('cloud_watchdog.py', 'cloud_entry.py', 'drive_cache.py', 'agent.tgz'):
                content.upload(str(bundled(filename)), root.lstrip('/') + '/' + filename)
            if access:
                atomic(temp/'drive-access.json', access)
                content.upload(str(temp/'drive-access.json'), root.lstrip('/') + '/drive-access.json')
        code = """import os,sys,subprocess
from pathlib import Path
os.umask(0o077)
r=Path(H3_ROOT)
for filename in ('config.json','drive-access.json'):
 if (r/filename).exists(): (r/filename).chmod(0o600)
pidfile=r/'cloud_entry.py.pid'
running=False
try:
 pid=int(pidfile.read_text())
 running=str(r/'cloud_entry.py').encode() in (Path('/proc')/str(pid)/'cmdline').read_bytes().split(bytes([0]))
except (OSError,ValueError): pass
if not running:
 with (r/'runtime.log').open('ab') as log:
  process=subprocess.Popen([sys.executable,'-u',str(r/'cloud_entry.py')],cwd=r,stdout=log,stderr=log,start_new_session=True)
 pidfile.write_text(str(process.pid))
""".replace('H3_ROOT', repr(root))
        self.platform.configure_colab(record['node'], True)
        self.execute(session, code, instance_id=instance_id)

    def tick(self):
        if time.monotonic() - self.last_tick < 25 or not self.owned(): return
        if not self.lock.acquire(blocking=False): return
        try:
            self.last_tick = time.monotonic()
            remote = self.platform.request('GET', '/api/fmworker/account').json()
            visible = {r['id']: r for r in remote.get('resources', [])}
            assignments = None
            # A provider failure is not proof that allocated compute disappeared.
            if any(self.same_google(r) and self.recorded_endpoint(i) and r.get('status') != 'released' for i, r in self.owned().items()):
                try: assignments = self.client().list_assignments()
                except Exception: pass
            for instance_id, record in self.owned().items():
                if record.get('status') == 'released': continue
                if record.get('phase') == 'rejected':
                    if record.get('provider_cleanup_pending'):
                        try: self.cleanup_rejection(instance_id)
                        except Exception: pass
                    continue
                if assignments is not None and self.confirm_gone(instance_id, assignments): continue
                if record.get('phase') in ('requesting','uncertain','allocated','setup_failed') or record.get('status') == 'releasing': continue
                if record.get('purpose') == 'h3':
                    status = visible.get(record.get('node'))
                    if not status: self.update(instance_id, status='offline', detail='平台未找到此模型节点'); continue
                    online = status.get('online') is True
                    stage = status.get('stage', 'preparing')
                    self.update(instance_id, status=('busy' if stage in ('rendering','uploading','busy') else 'deploying' if stage in ('preparing','loading','installing','fetching','connecting') else stage) if online else 'offline', detail=status.get('detail',''))
                elif assignments is not None and self.same_google(record):
                    self.update(instance_id, status='ready', detail='Colab 实例在线')
            active = [r for r in self.owned().values() if r.get('status') != 'released' and r.get('phase') != 'rejected']
            ready = any(r['status'] in ('ready', 'busy') for r in active)
            self.state.resource('colab', stage='ready' if ready else 'preparing' if active else 'paused',
                                detail=f'{len(active)} 台实例' if active else '没有运行中的实例', current_job=None)
            if not active: self.state.resource('colab', enabled=False)
        finally:
            self.lock.release()

    def reconcile_allocation(self, instance_id):
        record = self.owned().get(instance_id)
        if not record: raise RuntimeError('实例不属于当前登录账号')
        if self.saved(instance_id): return self.refresh_session(instance_id)
        from colab_cli.client import Assignment
        from colab_cli.state import SessionState
        found = self.client()._get_assignment(uuid.UUID(record['request_id']), **self.allocation_options(record))
        if not isinstance(found, Assignment): return None
        session = SessionState(name='fmworker-' + instance_id, token=found.runtime_proxy_info.token,
            url=found.runtime_proxy_info.url, endpoint=found.endpoint, token_expires_at=found.runtime_proxy_info.expires_at(),
            variant=self.allocation_options(record)['variant'].value, accelerator='NONE' if record['variant'] == 'CPU' else record['gpu'],
            machine_shape='HIGH_RAM' if record.get('high_memory') else 'STANDARD')
        self.save_session(session, instance_id)
        self.update(instance_id, phase='allocated', endpoint=session.endpoint)
        return session

    def release(self, instance_id):
        with self.lock:
            record = self.owned().get(instance_id)
            if not record: raise RuntimeError('实例不属于当前登录账号')
            if record.get('status') == 'released': return {'ok': True, 'status': 'released'}
            if record.get('phase') == 'rejected':
                self.cleanup_rejection(instance_id)
                self.update(instance_id, phase='released', status='released')
                return {'ok': True, 'status': 'released'}
            if record.get('legacy'): return self.release_legacy(instance_id, record)
            if not self.same_google(record): raise RuntimeError('请连接创建此实例的 Google 账号后核对释放')
            if self.confirm_gone(instance_id): return {'ok': True, 'status': 'released'}
            session = self.saved(instance_id)
            if not session and record.get('allocation_submitted', True): session = self.reconcile_allocation(instance_id)
            if not session and record.get('allocation_submitted', True):
                raise RuntimeError('Google 尚未确认先前申请的最终结果，请稍后核对；没有创建新实例或释放其他实例')
            # Stop admission and require model completion before releasing compute.
            # The server rejects resource deletion while a job is running.
            self.retire_node(record)
            if session:
                client = self.client()
                self.update(instance_id, status='releasing', detail='等待 Google 确认释放')
                client.unassign(session.endpoint)
                for _ in range(15):
                    if not any(a.endpoint == session.endpoint for a in client.list_assignments()): break
                    time.sleep(2)
                else: raise RuntimeError('Google 尚未确认释放；记录已保留，请重试')
            self.vault.delete('colab-session:' + instance_id)
            self.update(instance_id, phase='released', status='released', detail='Google 已确认实例释放')
            return {'ok': True, 'status': 'released'}

    def retire_node(self, record):
        if record.get('node'):
            try:
                self.platform.configure_colab(record['node'], False)
                self.platform.request('DELETE', '/api/fmworker/resources/' + str(record['node'])).json()
            except PlatformError as exc:
                if exc.status != 404: raise

    def cleanup_rejection(self, instance_id):
        record = self.owned().get(instance_id)
        if not record or record.get('phase') != 'rejected': return
        if record.get('provider_cleanup_pending'): self.retire_node(record)
        self.update(instance_id, provider_cleanup_pending=False)

    def same_google(self, record):
        sub = record.get('google_sub')
        return bool(sub and sub == (self.state.get('google_identity') or {}).get('sub'))

    def confirm_gone(self, instance_id, assignments=None):
        record = self.owned().get(instance_id)
        if not record or not self.same_google(record): return False
        endpoint = self.recorded_endpoint(instance_id)
        if not endpoint: return False
        if assignments is None: assignments = self.client().list_assignments()
        if any(a.endpoint == endpoint for a in assignments): return False
        self.mark_gone(instance_id)
        return True

    def recorded_endpoint(self, instance_id):
        record = self.owned().get(instance_id)
        if not record: return None
        session = self.saved(instance_id)
        return session.endpoint if session else record.get('endpoint')

    def mark_gone(self, instance_id):
        record = self.owned()[instance_id]
        if record.get('node'):
            # Provider-confirmed loss must not be blocked by a stale running job.
            try: self.platform.configure_colab(record['node'], False)
            except Exception: pass
        if record.get('legacy'):
            self.vault.delete('colab-session')
            self.state.set('managed_colab', None)
            self.state.set('allocation_pending', None)
        self.vault.delete('colab-session:' + instance_id)
        self.update(instance_id, status='released', phase='released', project_id=None,
                    detail='Google 已回收实例；临时文件和内存无法恢复')

    def release_legacy(self, instance_id, record):
        if not self.same_google(record):
            raise RuntimeError('请连接创建此实例的 Google 账号后释放')
        session = self.saved(instance_id)
        if session: session = self.refresh_session(instance_id)
        elif record.get('request_id'): session = self.reconcile_allocation(instance_id)
        if session:
            client = self.client()
            if record.get('phase') == 'running':
                # The legacy watchdog understands this explicit drain request.
                self.execute(session, "from pathlib import Path; Path('/content/fmworker/drain').touch()", instance_id=instance_id)
            else:
                client.unassign(session.endpoint)
            for _ in range(15):
                if not any(a.endpoint == session.endpoint for a in client.list_assignments()): break
                time.sleep(2)
            else: raise RuntimeError('正在等待旧版实例排空并确认释放，请稍后重试')
        self.vault.delete('colab-session:' + instance_id)
        self.vault.delete('colab-session')
        self.state.set('managed_colab', None)
        self.state.set('allocation_pending', None)
        self.update(instance_id, phase='released', status='released', detail='旧版实例已释放')
        return {'ok': True}

    def drain(self):
        """Pause model admission only; allocated compute remains."""
        with self.lock:
            for record in self.owned().values():
                if record.get('node') and record.get('status') != 'released' and record.get('phase') != 'rejected':
                    self.platform.configure_colab(record['node'], False)
            self.state.resource('colab', enabled=False, detail='已暂停模型任务接入；实例保持连接')
