"""Isolated account, allocation and lifecycle tests; never contact Google."""
import hashlib
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'runtime'))
sys.path.insert(0, str(ROOT/'resources'))
from fmworker.state import State, Vault
from fmworker.colab import Colab
from fmworker.colab_account import AccountProbe, empty_account, catalog, runtime_catalog, parse_plan


class MemoryKeyring:
    def __init__(self): self.data = {}
    def get_password(self, service, key): return self.data.get((service, key))
    def set_password(self, service, key, value): self.data[service, key] = value
    def delete_password(self, service, key): self.data.pop((service, key), None)


def vault(): return Vault(backend=MemoryKeyring())


def response(value, code=200):
    return httpx.Response(code, json=value, request=httpx.Request('GET', 'https://account.invalid'))


class FakePlatform:
    site = 'https://nvmes.com'
    def __init__(self): self.calls = []; self.nodes = {}; self.remote = []
    def register_colab(self, ident, name):
        if ident not in self.nodes: self.nodes[ident] = {'id': len(self.nodes) + 1, 'secret': 'node-secret-' + ident}
        return self.nodes[ident]
    def configure_colab(self, node, enabled): self.calls.append(('configure', node, enabled))
    def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return response({'resources': self.remote} if method == 'GET' else {'ok': True, 'status': 'releasing'})


def account():
    value = empty_account()
    value.update(status='ready', checked_at=time.time(), source='test-only', eligible_accelerators=[
        {'id': 'CPU', 'label': 'CPU', 'variant': 'CPU', 'eligible': True, 'high_memory': False},
        {'id': 'G4', 'label': 'G4', 'variant': 'GPU', 'eligible': True, 'high_memory': False},
        {'id': 'T4', 'label': 'T4', 'variant': 'GPU', 'eligible': False, 'high_memory': False}])
    return value


def worker(tmp_path):
    from colab_cli.client import Assignment
    state = State(tmp_path); state.set('account', {'id': 2}); state.set('settings', {'drive_cache': False})
    state.set('google_identity', {'sub': 'same-user', 'email': 'user@example.invalid'})
    state.set('google', {'stage': 'connected'}); state.set('colab_account', account()); state.resource('colab')
    api = FakePlatform(); colab = Colab(state, vault(), SimpleNamespace(), api)
    allocations = []
    def assign(ident, **kwargs):
        allocations.append((ident, kwargs))
        return Assignment(endpoint='owned-' + str(ident), runtimeProxyInfo={
            'token': 'secret-token-' + str(ident), 'tokenExpiresInSeconds': 3600, 'url': 'https://runtime.invalid/'})
    colab.client = lambda: SimpleNamespace(assign=assign, list_assignments=lambda: [])
    bootstraps = []
    colab.bootstrap = lambda *args: bootstraps.append(args)
    return colab, api, allocations, bootstraps


def test_v1_catalog_preserves_false_unknown_and_zero():
    data = {'eligibleAccelerators': [{'variant': 'VARIANT_GPU', 'models': ['g4']}],
            'ineligibleAccelerators': [{'variant': 'VARIANT_GPU', 'models': ['T4']}]}
    values = catalog(data)
    assert values[0] == {'id': 'G4', 'label': 'G4', 'variant': 'GPU', 'eligible': True, 'high_memory': None}
    assert values[1]['eligible'] is False
    assert not any(row['id'] == 'CPU' for row in values)


def test_public_specs_include_cpu_and_highmem_without_guessing():
    values = runtime_catalog({'runtimeSpecs': [
        {'key': {'variant': 'VARIANT_CPU', 'accelerator': 'NONE', 'shape': 'SHAPE_STANDARD'}, 'eligible': True},
        {'key': {'variant': 'VARIANT_GPU', 'accelerator': 'A100', 'shape': 'SHAPE_HIGHMEM'}, 'eligible': False}]})
    assert values[0]['id'] == 'CPU'
    assert values[1]['id'] == 'A100-HIGH_RAM' and values[1]['high_memory'] is True and values[1]['eligible'] is False


def test_probe_only_reads_account_and_uses_zero_balance(tmp_path, monkeypatch):
    import fmworker.colab_account as module
    calls = []
    class Session:
        def __init__(self, credentials): pass
        def get(self, url, **kwargs):
            calls.append((url, kwargs))
            if 'runtimespecs' in url: return response({}, 403)
            return response({'subscriptionTier': 'SUBSCRIPTION_TIER_PRO', 'paidComputeUnitsBalance': 0,
                'consumptionRateHourly': 0, 'eligibleAccelerators': [{'variant': 'VARIANT_GPU', 'models': ['G4']}],
                'ineligibleAccelerators': []})
        def close(self): pass
    monkeypatch.setattr(module, 'AuthorizedSession', Session)
    state = State(tmp_path)
    value = AccountProbe(state, SimpleNamespace(credentials=lambda: object(), plan_credentials=lambda: None)).run()
    assert value['status'] == 'ready' and value['paid_compute_units_balance'] == 0
    assert value['google_ai_plan']['status'] == 'authorization_required'
    assert value['subscription_tier'] == 'SUBSCRIPTION_TIER_PRO'
    assert all('assign' not in url for url, _ in calls)
    assert calls[0][1]['params'] == {'get_ccu_consumption_info': 'true'}


def test_ccu_fallback_does_not_invent_entitlements(tmp_path, monkeypatch):
    import fmworker.colab_account as module
    class Session:
        def __init__(self, credentials): pass
        def get(self, url, **kwargs):
            return response({'currentBalance': 123, 'consumptionRateHourly': 0}) if 'ccu-info' in url else response({}, 403)
        def close(self): pass
    monkeypatch.setattr(module, 'AuthorizedSession', Session)
    state = State(tmp_path)
    result = AccountProbe(state, SimpleNamespace(credentials=lambda: object(), plan_credentials=lambda: None)).run()
    assert result['status'] == 'error' and result['paid_compute_units_balance'] == 123
    assert result['subscription_tier'] is None and result['eligible_accelerators'] == []


def test_plan_uses_paid_tier_without_promoting_generic_current_tier():
    assert parse_plan({'currentTier': {'id': 'standard-tier'}})['status'] == 'unknown'
    assert parse_plan({'paidTier': {'id': 'g1-ultra-tier'}, 'currentTier': {'id': 'free-tier'}})['name'] == 'Google AI Ultra 20x'
    assert parse_plan({'paidTier': {'id': 'new-unknown-tier', 'name': 'Pro maybe'}})['status'] == 'unknown'


def test_plan_oauth_defaults_to_existing_client_and_preserves_colab_on_cancel(tmp_path, monkeypatch):
    import requests
    from fmworker.google import Google
    state = State(tmp_path); state.set('google_identity', {'sub': 'same'})
    state.set('google', {'stage': 'connected'})
    google = Google(state, vault()); opened = []
    google.configuration = lambda: {'installed': {'client_id': 'test', 'client_secret': 'test',
        'auth_uri': 'https://accounts.google.com/o/oauth2/auth', 'token_uri': 'https://oauth2.googleapis.com/token',
        'redirect_uris': ['http://localhost']}}
    monkeypatch.setattr('fmworker.google.webbrowser.open', lambda url: opened.append(url) or True)
    google.begin_plan(lambda: pytest.fail('Cancelled plan authorization cannot complete'))
    assert opened and 'cloud-platform' in opened[0]
    assert state.get('google')['stage'] == 'connected'
    google.cancel()
    deadline = time.monotonic() + 3
    while google.server and time.monotonic() < deadline: time.sleep(.02)
    assert google.server is None and state.get('google')['stage'] == 'connected'
    assert state.get('google_plan_authorization')['stage'] == 'error'


def test_empty_cpu_has_no_h3_node_or_model_bootstrap(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.start('CPU')['id']
    assert len(allocations) == 1 and allocations[0][1]['accelerator'] is None
    assert not api.nodes
    assert boots[0][0]['purpose'] == 'compute' and boots[0][2] is None
    assert colab.saved(ident).accelerator == 'NONE'
    assert colab.public_instances()[0]['status'] == 'connecting'
    state_json = colab.state.path.read_text()
    assert 'secret-token' not in state_json and 'lab-secret' not in state_json


def test_two_h3_clicks_create_distinct_g4_nodes_and_keep_existing_cpu(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    cpu = colab.start('CPU')['id']; first = colab.deploy()['id']; second = colab.deploy()['id']
    assert len({cpu, first, second}) == 3
    assert len(api.nodes) == 2 and api.nodes[first]['id'] != api.nodes[second]['id']
    assert [r[1]['accelerator'].value if r[1]['accelerator'] else 'CPU' for r in allocations] == ['CPU', 'G4', 'G4']
    assert colab.records()[cpu]['status'] == 'connecting'


def test_explicit_unknown_or_ineligible_selection_never_allocates(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    for selection in ('', 'H100', 'T4'):
        with pytest.raises(RuntimeError): colab.start(selection)
    assert allocations == [] and api.calls == []


def test_allocation_timeout_reuses_durable_id_and_never_auto_releases(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    ids = []
    def uncertain(ident, **kwargs): ids.append(ident); raise TimeoutError('contains-private-request')
    colab.client = lambda: SimpleNamespace(assign=uncertain)
    for _ in range(2):
        with pytest.raises(RuntimeError, match='申请结果未确认'): colab.start('CPU')
    assert ids[0] == ids[1] and len(colab.records()) == 1
    assert next(iter(colab.records().values()))['phase'] == 'uncertain'
    assert 'contains-private-request' not in colab.state.path.read_text()


def test_unresolved_allocation_blocks_changing_shape(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    colab.client = lambda: SimpleNamespace(assign=lambda *a, **kw: (_ for _ in ()).throw(TimeoutError()))
    with pytest.raises(RuntimeError): colab.start('CPU')
    with pytest.raises(RuntimeError, match='上一次'): colab.deploy()
    assert len(colab.records()) == 1


def test_bootstrap_failure_retains_runtime_for_explicit_recovery(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    colab.bootstrap = lambda *args: (_ for _ in ()).throw(ConnectionError('private URL'))
    with pytest.raises(RuntimeError, match='已保留'): colab.start('CPU')
    record = next(iter(colab.records().values()))
    assert record['phase'] == 'setup_failed' and colab.saved(record['id'])
    assert not any(call[0] == 'POST' and '/release' in call[1] for call in api.calls)


def test_ready_requires_model_node_heartbeat(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.deploy()['id']; node=colab.records()[ident]['node']
    colab.client=lambda:SimpleNamespace(list_assignments=lambda:[SimpleNamespace(endpoint=colab.saved(ident).endpoint)])
    api.remote=[{'id':node,'online':True,'stage':'preparing','detail':'安装模型'}]
    colab.tick();assert colab.records()[ident]['status']=='deploying'
    api.remote=[{'id':node,'online':True,'stage':'ready','detail':'就绪'}];colab.last_tick=0
    colab.tick();assert colab.records()[ident]['status']=='ready'
    assert all('/api/lab' not in str(c) for c in api.calls)




def test_release_only_unassigns_selected_runtime(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    first=colab.start('CPU')['id'];second=colab.start('CPU')['id']
    endpoint=colab.saved(first).endpoint;other=colab.saved(second).endpoint;released=[]
    colab.client=lambda:SimpleNamespace(unassign=lambda e:released.append(e),list_assignments=lambda:[SimpleNamespace(endpoint=e) for e in [endpoint,other] if e not in released])
    colab.release(first)
    assert released==[endpoint] and colab.records()[first]['status']=='released'
    assert colab.records()[second]['status']=='connecting'
    assert all('/api/lab' not in str(c) for c in api.calls)




def test_cross_account_records_and_release_are_isolated(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.start('CPU')['id']; colab.state.set('account', {'id': 55})
    assert colab.public_instances() == []
    with pytest.raises(RuntimeError, match='不属于'): colab.release(ident)


def test_pause_only_changes_h3_admission(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    cpu = colab.start('CPU')['id']; h3 = colab.deploy()['id']; colab.drain()
    assert ('configure', colab.records()[h3]['node'], False) in api.calls
    assert colab.records()[cpu]['status'] == 'connecting'
    assert not any(call[0] == 'POST' and '/release' in call[1] for call in api.calls)


def test_shutdown_keeps_cloud_instances_and_settings_drop_time_limits(tmp_path, monkeypatch):
    import fmworker.service as module
    state = State(tmp_path); state.set('settings', {'idle_minutes': 15, 'max_runtime_minutes': 120, 'gpu': 'H100'})
    service = module.Service(state=state, vault=vault(), start_thread=False)
    state.set('managed_colab', {'endpoint': 'legacy-still-running'})
    state.resource('colab', enabled=True)
    service.colab.drain = lambda: pytest.fail('Closing desktop must not pause Colab')
    service.background = lambda key, fn: fn() or {'started': True}
    service.flow.close = lambda: None
    service.dispatch('shutdown', {})
    assert service.status()['can_quit'] is True
    assert state.get('resources')['colab']['enabled'] is True
    assert state.get('settings') == {'theme': 'light', 'drive_cache': True}


def test_cloud_watchdog_ignores_idle_deadline_and_desktop_loss(tmp_path, monkeypatch):
    import cloud_watchdog
    monkeypatch.setattr(cloud_watchdog, 'ROOT', tmp_path)
    config = {'cloud': True, 'started_at': 1}
    assert cloud_watchdog.reason(config, {'stage': 'error'}, {}, 9999999999) is None
    (tmp_path/'drain').touch()
    assert cloud_watchdog.reason(config, {'ticket': 'active'}, {}, 9999999999) is None
    assert cloud_watchdog.reason(config, {}, {}, 9999999999) == 'drained'
    assert cloud_watchdog.reason({'cloud': False, 'deadline': 2}, {}, {}, 3) == 'maximum-runtime'


def test_unique_h3_credentials_are_durable_before_register_and_retry(tmp_path):
    from fmworker.platform import Platform
    state = State(tmp_path); state.set('account', {'id': 9}); storage = vault(); api = Platform(state, storage)
    calls = []
    def handler(request):
        body = json.loads(request.content); calls.append(body)
        ident = body['name']
        saved = storage.get('resource:https://nvmes.com:9:colab:' + ident)
        assert saved['secret'] == body['secret']
        return httpx.Response(200, json={'id': 1 if ident == 'a' else 2})
    api.client = httpx.Client(base_url=api.site, transport=httpx.MockTransport(handler))
    a = api.register_colab('a', 'a'); again = api.register_colab('a', 'a'); b = api.register_colab('b', 'b')
    assert a == again and a['secret'] != b['secret']






def test_empty_bootstrap_does_not_install_or_upload_any_connector(tmp_path, monkeypatch):
    import fmworker.colab as module
    colab, api, allocations, boots=worker(tmp_path)
    record=colab.new_record('compute',account()['eligible_accelerators'][0])
    monkeypatch.setattr(module,'runtime_ready',lambda session:True)
    monkeypatch.setattr(module,'ContentsClient',lambda *a:pytest.fail('No uploads for empty compute'))
    colab.execute=lambda *a,**kw:pytest.fail('No connector installation for empty compute')
    Colab.bootstrap(colab,record,object())




def test_h3_bootstrap_uses_dedicated_node_and_has_no_release_watchdog(tmp_path, monkeypatch):
    import ast
    import fmworker.colab as module
    colab, api, allocations, boots = worker(tmp_path)
    record = colab.new_record('h3', account()['eligible_accelerators'][1]); record['node'] = 7
    uploads = {}; code = []
    class Contents:
        def __init__(self, session): pass
        def upload(self, local, remote): uploads[remote] = Path(local).read_bytes()
    monkeypatch.setattr(module, 'ContentsClient', Contents)
    monkeypatch.setattr(module, 'runtime_ready', lambda session: True)
    colab.execute = lambda session, source, **kwargs: code.append(source)
    Colab.bootstrap(colab, record, object(), {'secret':'private-model'})
    configs={name:json.loads(data) for name,data in uploads.items() if name.endswith('config.json')}
    assert len(configs)==1
    model=next(iter(configs.values()))
    assert model['secret']=='private-model' and model['manual_release_only'] is True
    assert 'deadline' not in model and 'idle_minutes' not in model
    assert all('/lab/' not in name for name in uploads)
    assert ('configure',7,True) in api.calls
    for source in code:ast.parse(source)
    assert 'cloud_entry.py' in code[-1] and 'cloud_watchdog.py' not in code[-1]


@pytest.mark.parametrize('sub,success', [('same', True), ('different', False)])
def test_optional_plan_oauth_requires_same_verified_account(tmp_path, monkeypatch, sub, success):
    import urllib.request
    from fmworker.google import Google
    import fmworker.google as module
    state = State(tmp_path); state.set('google_identity', {'sub': 'same', 'email': 'same@example.invalid'})
    state.set('google', {'stage': 'connected'})
    storage = vault(); storage.put('google', {'primary': 'untouched'})
    creds = SimpleNamespace(token='short-for-test', has_scopes=lambda scopes: True,
                            to_json=lambda: json.dumps({'refresh_token': 'plan-vault-only'}))
    flow = SimpleNamespace(credentials=creds, authorization_url=lambda **kw: ('https://accounts.invalid/?state=fake', 'fake'),
                           fetch_token=lambda **kw: None)
    monkeypatch.setattr(module.InstalledAppFlow, 'from_client_config', lambda *a, **kw: flow)
    monkeypatch.setattr(module.requests, 'get', lambda *a, **kw: response({'email_verified': True, 'sub': sub, 'email': 'user@example.invalid'}))
    monkeypatch.setattr(module.webbrowser, 'open', lambda url: True)
    google = Google(state, storage); google.configuration = lambda: {}
    done = []; google.begin_plan(lambda: done.append(True))
    port = google.server.server_port
    urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/?state=fake&code=testing', timeout=3).read()
    deadline = time.monotonic() + 3
    while google.server and time.monotonic() < deadline: time.sleep(.01)
    assert bool(done) is success
    assert bool(storage.get('google-plan')) is success
    assert storage.get('google') == {'primary': 'untouched'}
    assert state.get('google')['stage'] == 'connected'
    assert 'plan-vault-only' not in state.path.read_text()


def test_upgrade_only_migrates_local_legacy_bookkeeping(tmp_path):
    from colab_cli.state import SessionState
    state = State(tmp_path); state.set('account', {'id': 9}); state.set('google_identity', {'sub': 'same'})
    state.set('managed_colab', {'owner': 9, 'started_at': 5, 'settings': {'gpu': 'G4'}})
    storage = vault(); storage.put('colab-session', SessionState(name='old', token='private', url='https://runtime.invalid', endpoint='owned').model_dump(mode='json'))
    colab = Colab(state, storage, None, FakePlatform())
    records = colab.public_instances()
    assert len(records) == 1 and records[0]['status'] == 'offline'
    assert '旧版' in records[0]['detail'] and state.get('managed_colab') is not None
    assert not colab.platform.calls


def test_new_unknown_outcome_release_only_unassigns_its_reconciled_endpoint(tmp_path):
    from colab_cli.client import Assignment
    colab, api, allocations, boots = worker(tmp_path)
    record = colab.new_record('compute', account()['eligible_accelerators'][0])
    colab.update(record['id'], phase='uncertain', allocation_submitted=True, registered=True)
    own = Assignment(endpoint='just-owned', runtimeProxyInfo={'token': 'private', 'url': 'https://runtime.invalid', 'tokenExpiresInSeconds': 3600})
    released = []
    client = SimpleNamespace(_get_assignment=lambda *a, **kw: own, unassign=lambda e: released.append(e),
                             list_assignments=lambda: [SimpleNamespace(endpoint='unrelated')])
    colab.client = lambda: client
    colab.release(record['id'])
    assert released == ['just-owned']
    assert colab.records()[record['id']]['status'] == 'released'
    assert all('/api/lab' not in str(c) for c in api.calls)


def test_tunnel_raw_entitlements_remain_usable_when_user_info_is_denied(tmp_path, monkeypatch):
    import fmworker.colab_account as module
    calls = []
    class Session:
        def __init__(self, credentials): pass
        def get(self, url, **kwargs):
            calls.append((url, kwargs))
            if url == module.USER_INFO: return response({'error': {'status': 'PERMISSION_DENIED'}}, 403)
            assert url == module.CCU_INFO
            return response({'currentBalance': 0, 'consumptionRateHourly': 0, 'assignmentsCount': 0,
                'eligibleGpus': ['T4'], 'ineligibleGpus': ['H100', 'G4', 'A100', 'L4'],
                'eligibleTpus': ['V5E1'], 'ineligibleTpus': ['V6E1']})
        def close(self): pass
    monkeypatch.setattr(module, 'AuthorizedSession', Session)
    state = State(tmp_path)
    result = AccountProbe(state, SimpleNamespace(credentials=lambda: object(), plan_credentials=lambda: None)).run()
    entries = {row['id']: row for row in result['eligible_accelerators']}
    assert result['status'] == 'ready' and result['subscription_tier'] is None
    assert entries['T4']['eligible'] is True and entries['G4']['eligible'] is False
    assert entries['V5E1']['variant'] == 'TPU' and entries['V6E1']['eligible'] is False
    assert entries['CPU']['eligible'] is None and result['paid_compute_units_balance'] == 0
    for url, kwargs in calls:
        assert kwargs['headers'] == {'Accept': 'application/json', 'X-Colab-Client-Agent': 'colab-cli'}
    assert calls[-1][1]['params'] == {'authuser': '0'}


def test_unknown_cpu_candidate_requires_explicit_choice_but_can_allocate(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    info = account(); info['eligible_accelerators'][0]['eligible'] = None
    colab.state.set('colab_account', info)
    with pytest.raises(RuntimeError): colab.start('')
    assert allocations == []
    colab.start('CPU')
    assert len(allocations) == 1


def test_supported_tpu_enum_is_used_without_gpu_fallback(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    info = account(); info['eligible_accelerators'].append(
        {'id': 'V5E1', 'label': 'V5E1', 'variant': 'TPU', 'eligible': True, 'high_memory': None})
    colab.state.set('colab_account', info)
    colab.start('V5E1')
    assert allocations[0][1]['variant'].value == 'TPU'
    assert allocations[0][1]['accelerator'].value == 'V5E1'


def test_inflight_request_without_assignment_is_not_reported_as_released(tmp_path):
    from colab_cli.client import GetAssignmentResponse
    colab, api, allocations, boots = worker(tmp_path)
    record = colab.new_record('compute', account()['eligible_accelerators'][0])
    colab.update(record['id'], phase='uncertain', allocation_submitted=True, registered=True)
    client = SimpleNamespace(_get_assignment=lambda *a, **kw: GetAssignmentResponse(acc='NONE', nbh='old', token='xsrf', variant='DEFAULT'))
    colab.client = lambda: client
    with pytest.raises(RuntimeError, match='最终结果'): colab.release(record['id'])
    assert colab.records()[record['id']]['phase'] == 'uncertain'
    assert not any(c[0] == 'POST' and c[1].endswith('/provider-state') for c in api.calls)


def test_overlapping_readonly_probe_does_not_fail_a_login_callback(tmp_path):
    from fmworker.service import Service
    service = Service(state=State(tmp_path), vault=vault(), start_thread=False)
    service.operations['colab.probe'] = {'running': True}
    assert service.probe_colab() == {'started': False}
    assert service.operations['colab.probe']['running'] is True


def rejection(status, method='POST'):
    import requests
    from colab_cli.client import ColabRequestError
    res = requests.Response(); res.status_code = status
    req = requests.Request(method, 'https://colab.research.google.com/tun/m/assign').prepare()
    res.request = req
    return ColabRequestError('upstream private response must not leak', req, res, 'private-token-never-display')


@pytest.mark.parametrize('status,method', [(400, 'POST'), (401, 'GET'), (403, 'GET'), (403, 'POST'), (412, 'POST'), (429, 'POST')])
def test_definite_allocation_refusal_does_not_lock_type_switch_or_cleanup(tmp_path, status, method):
    colab, api, allocations, boots = worker(tmp_path)
    original_client = colab.client
    colab.client = lambda: SimpleNamespace(assign=lambda *a, **kw: (_ for _ in ()).throw(rejection(status, method)))
    with pytest.raises(RuntimeError, match=str(status)): colab.start('CPU')
    denied = next(iter(colab.records().values()))
    assert denied['phase'] == 'rejected' and denied['allocation_submitted'] is False
    assert denied['provider_cleanup_pending'] is False
    assert 'private-token-never-display' not in colab.state.path.read_text()
    colab.client = original_client
    new_id = colab.deploy()['id']
    assert new_id != denied['id'] and colab.records()[new_id]['gpu'] == 'G4'
    colab.client = lambda: pytest.fail('Definite rejection cleanup must not call Google')
    colab.release(denied['id'])
    assert colab.records()[denied['id']]['status'] == 'released'


def test_sdk_wrapped_412_is_an_explicit_rejection(tmp_path):
    from colab_cli.client import TooManyAssignmentsError
    colab, api, allocations, boots = worker(tmp_path)
    colab.client = lambda: SimpleNamespace(assign=lambda *a, **kw: (_ for _ in ()).throw(TooManyAssignmentsError('private upstream error')))
    with pytest.raises(RuntimeError, match='412'): colab.start('CPU')
    assert next(iter(colab.records().values()))['phase'] == 'rejected'


def test_later_explicit_refusal_does_not_erase_an_earlier_unknown_post(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    attempts = []; errors = [rejection(503), rejection(403, 'GET')]
    def assign(request_id, **kwargs): attempts.append(request_id); raise errors.pop(0)
    colab.client = lambda: SimpleNamespace(assign=assign)
    for _ in range(2):
        with pytest.raises(RuntimeError, match='结果未确认'): colab.start('CPU')
    record = next(iter(colab.records().values()))
    assert record['phase'] == 'uncertain' and record['allocation_uncertain'] is True
    assert attempts[0] == attempts[1]
    assert not any(c[0] == 'POST' and c[1].endswith('/provider-state') for c in api.calls)


def test_production_client_has_no_hidden_allocation_retries(tmp_path, monkeypatch):
    from colab_cli.client import Assignment
    import google.auth.transport.requests as transport
    state = State(tmp_path)
    monkeypatch.setattr(transport, 'AuthorizedSession', lambda credentials: object())
    colab = Colab(state, vault(), SimpleNamespace(credentials=lambda: object()), FakePlatform())
    client = colab.client(); posted = []
    client._get_assignment = lambda *args: SimpleNamespace(token='xsrf')
    def post(*args): posted.append(args); raise rejection(503)
    client._post_assignment = post
    with pytest.raises(Exception): client.assign('same-id')
    assert len(posted) == 1
    own = Assignment(endpoint='own', runtimeProxyInfo={'token': 'secret', 'url': 'https://runtime.invalid', 'tokenExpiresInSeconds': 3600})
    client._get_assignment = lambda *args: own
    assert client.assign('same-id') is own and len(posted) == 1


@pytest.mark.parametrize('project', [None, 'saved-project'])
def test_provider_confirmed_gone_needs_no_platform_runtime(tmp_path, project):
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.start('CPU')['id']; colab.update(ident, status='offline', project_id=project)
    checked = []
    def assignments(): checked.append(True); return []
    colab.client = lambda: SimpleNamespace(list_assignments=assignments)
    result = colab.release(ident)
    assert result['status'] == 'released' and len(checked) == 1
    assert colab.saved(ident) is None and colab.records()[ident]['project_id'] is None
    assert '临时文件和内存无法恢复' in colab.records()[ident]['detail']
    assert not any(c[0] == 'POST' and c[1].endswith('/release') for c in api.calls)
    assert all('/api/lab' not in str(c) for c in api.calls)


def test_offline_and_failed_google_read_is_not_gone(tmp_path):
    from fmworker.platform import PlatformError
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.start('CPU')['id']; colab.update(ident, status='offline')
    colab.client = lambda: SimpleNamespace(list_assignments=lambda: (_ for _ in ()).throw(ConnectionError()))
    original_request = api.request
    def request(method, path, **kwargs):
        if path.endswith('/release'): raise PlatformError('实例未连接', 409)
        return original_request(method, path, **kwargs)
    api.request = request
    with pytest.raises(ConnectionError): colab.release(ident)
    assert colab.saved(ident) is not None and colab.records()[ident]['status'] == 'offline'
    assert not any(c[0] == 'POST' and c[1].endswith('/provider-state') for c in api.calls)


def test_different_google_identity_cannot_confirm_other_account_gone(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.start('CPU')['id']; colab.state.set('google_identity', {'sub': 'different'})
    colab.client = lambda: pytest.fail('Do not inspect another account to infer ownership loss')
    assert colab.confirm_gone(ident) is False
    assert colab.saved(ident) is not None


def test_tick_reconciles_provider_reclamation_once_for_multiple_offline_instances(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    first = colab.start('CPU')['id']; second = colab.start('CPU')['id']
    api.remote = [{'id': ident, 'status': 'offline', 'connected': False, 'detail': 'relay offline', 'project_id': 'saved-' + ident}
                  for ident in (first, second)]
    checks = []
    colab.client = lambda: SimpleNamespace(list_assignments=lambda: checks.append(True) or [])
    colab.tick()
    assert len(checks) == 1
    assert all(r['status'] == 'released' for r in colab.records().values())
    assert colab.state.get('resources')['colab']['enabled'] is False


def test_rejected_allocation_does_not_block_google_disconnect(tmp_path):
    from fmworker.service import Service
    state = State(tmp_path)
    service = Service(state=state, vault=vault(), start_thread=False)
    state.set('colab_instances', {'denied': {'status': 'error', 'phase': 'rejected'}})
    state.resource('colab', enabled=True)  # An old aggregate indicator is not a live runtime.
    service.flow.close = lambda: None
    service.dispatch('google.disconnect', {})
    assert state.get('google') == {}


def test_crash_after_submitting_is_unknown_even_if_next_attempt_is_denied(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    record = colab.new_record('compute', account()['eligible_accelerators'][0])
    colab.update(record['id'], phase='requesting', allocation_submitted=True)
    colab.client = lambda: SimpleNamespace(assign=lambda *a, **kw: (_ for _ in ()).throw(rejection(403, 'GET')))
    with pytest.raises(RuntimeError, match='结果未确认'): colab.start('CPU')
    assert colab.records()[record['id']]['phase'] == 'uncertain'
    assert not any(c[0] == 'POST' and c[1].endswith('/provider-state') for c in api.calls)


def test_durable_recorded_endpoint_can_confirm_gone_after_local_session_loss(tmp_path):
    colab, api, allocations, boots = worker(tmp_path)
    ident = colab.start('CPU')['id']
    assert colab.records()[ident]['endpoint']
    colab.vault.delete('colab-session:' + ident)
    colab.client = lambda: SimpleNamespace(list_assignments=lambda: [])
    assert colab.confirm_gone(ident) is True
    assert colab.records()[ident]['status'] == 'released'


def test_running_h3_task_prevents_provider_release(tmp_path):
    from fmworker.platform import PlatformError
    colab, api, allocations, boots = worker(tmp_path)
    ident=colab.deploy()['id'];endpoint=colab.saved(ident).endpoint;released=[]
    colab.client=lambda:SimpleNamespace(list_assignments=lambda:[SimpleNamespace(endpoint=endpoint)],unassign=lambda e:released.append(e))
    original=api.request
    def request(method,path,**kw):
        if method=='DELETE':raise PlatformError('请等待当前任务完成后移除',409)
        return original(method,path,**kw)
    api.request=request
    with pytest.raises(PlatformError,match='当前任务'):colab.release(ident)
    assert not released and colab.saved(ident) is not None
    assert ('configure',colab.records()[ident]['node'],False) in api.calls


def test_retry_release_after_node_removed_keeps_same_endpoint(tmp_path):
    from fmworker.platform import PlatformError
    colab, api, allocations, boots = worker(tmp_path)
    ident=colab.deploy()['id'];endpoint=colab.saved(ident).endpoint;calls=[];gone=[]
    def configure(*a):raise PlatformError('资源不存在',404)
    api.configure_colab=configure
    def unassign(e):
        calls.append(e)
        if len(calls)==1:raise ConnectionError('unknown outcome')
        gone.append(e)
    colab.client=lambda:SimpleNamespace(list_assignments=lambda:[] if gone else [SimpleNamespace(endpoint=endpoint)],unassign=unassign)
    with pytest.raises(ConnectionError):colab.release(ident)
    assert colab.saved(ident) is not None and colab.records()[ident]['status']=='releasing'
    colab.release(ident)
    assert calls==[endpoint,endpoint] and colab.records()[ident]['status']=='released'
