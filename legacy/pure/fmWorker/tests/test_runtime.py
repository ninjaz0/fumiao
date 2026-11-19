import json
import sys
import tarfile
import io
import hashlib
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'runtime'));sys.path.insert(0,str(ROOT/'resources'))
from fmworker.state import State,Vault
from fmworker.platform import validate_site,PlatformError
from fmworker.assets import extract_verified
from drive_cache import DriveCache
from cloud_watchdog import reason


class MemoryKeyring:
    def __init__(self):self.data={}
    def get_password(self,s,k):return self.data.get((s,k))
    def set_password(self,s,k,v):self.data[s,k]=v
    def delete_password(self,s,k):del self.data[s,k]


def test_secrets_stay_in_vault_and_state_is_atomic(tmp_path):
    state=State(tmp_path);vault=Vault(backend=MemoryKeyring())
    vault.put('google',{'refresh_token':'never-in-settings'})
    state.resource('flow',stage='connecting');state.event('连接中')
    assert vault.get('google')['refresh_token']=='never-in-settings'
    assert 'never-in-settings' not in (tmp_path/'settings.json').read_text()
    assert State(tmp_path).get('resources')['flow']['stage']=='connecting'


def test_platform_rejects_remote_http_and_url_credentials():
    assert validate_site('http://127.0.0.1:3000/')=='http://127.0.0.1:3000'
    for value in ('http://example.com','https://user:pw@example.com','https://example.com/path','https://example.com/?token=x'):
        with pytest.raises(PlatformError):validate_site(value)


def test_start_replaces_removed_resource_key_but_preserves_live_key(tmp_path):
    import httpx
    from fmworker.platform import Platform
    state=State(tmp_path);state.set('account',{'id':2})
    vault=Vault(backend=MemoryKeyring());key='resource:https://nvmes.com:2:flow'
    old={'id':5,'secret':'revoked-secret'};vault.put(key,old)
    api=Platform(state,vault);sent=[];active=[]
    def handle(request):
        if request.method=='GET':return httpx.Response(200,json={'user':{'id':2},'resources':active})
        body=json.loads(request.content);sent.append(body)
        # The new key must already be durable when the server accepts it.
        assert vault.get(key)['secret']==body['secret']
        return httpx.Response(200,json={'id':6})
    api.client=httpx.Client(base_url=api.site,transport=httpx.MockTransport(handle))
    result=api.register('flow');assert result['id']==6 and result['secret']!=old['secret']
    active.append({'id':6});assert api.register('flow')['secret']==result['secret']
    assert sent[0]['secret']==sent[1]['secret'] and state.get('resources')['flow']['node']==6


def test_resource_not_found_is_not_reported_as_missing_platform_update(tmp_path):
    import httpx
    from fmworker.platform import Platform
    api=Platform(State(tmp_path),Vault(backend=MemoryKeyring()))
    api.client=httpx.Client(base_url=api.site,transport=httpx.MockTransport(lambda r:httpx.Response(404,json={'detail':'资源不存在'})))
    with pytest.raises(PlatformError,match='资源不存在'):api.request('PUT','/api/fmworker/resources/5')


def test_archive_rejects_paths_and_unverified_bytes(tmp_path):
    archive=tmp_path/'bad.tgz'
    with tarfile.open(archive,'w:gz') as package:
        item=tarfile.TarInfo('../escaped');item.size=1;package.addfile(item,io.BytesIO(b'x'))
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    with pytest.raises(RuntimeError):extract_verified(archive,tmp_path/'install',digest)
    assert not (tmp_path/'escaped').exists()
    with pytest.raises(RuntimeError):extract_verified(archive,tmp_path/'install','0'*64)


def test_cloud_rejects_refresh_token_and_expiry(tmp_path):
    path=tmp_path/'access.json';cache=DriveCache(path)
    path.write_text(json.dumps({'access_token':'x','expires_at':9999999999,'refresh_token':'forbidden'}))
    with pytest.raises(ValueError):cache.headers()
    path.write_text(json.dumps({'access_token':'x','expires_at':1}))
    with pytest.raises(RuntimeError):cache.headers()


def test_watchdog_has_absolute_deadline_and_offline_idle_release():
    config={'deadline':2000,'started_at':1000,'idle_minutes':15}
    assert reason(config,{'stage':'busy','ticket':'x','at':1999},{'at':1999},2000)=='maximum-runtime'
    assert reason(config,{'stage':'ready','at':1200,'last_busy':1190},{'at':1000},1200)=='controller-offline'
    assert reason(config,{'stage':'busy','ticket':'x','at':1200},{'at':1000},1200) is None
    assert reason(config,{'stage':'busy','ticket':'x','at':1000},{'at':1200},1200)=='worker-unresponsive'


def test_pinned_h3_assets_match_platform():
    lock=json.loads((ROOT/'resources/agent.lock.json').read_text())
    assert lock['workflow']=='h3-v6-native-inputs-turbo4'
    import os
    source=Path(os.environ.get('FMWORKER_PLATFORM_SOURCE') or ROOT/'vendor/platform')
    assert lock['files']['node_models.py']==hashlib.sha256((source/'node_models.py').read_bytes()).hexdigest()
    assert lock['files']['render.py']==hashlib.sha256((source/'agent/render.py').read_bytes()).hexdigest()


def test_drive_access_treats_google_naive_expiry_as_utc(tmp_path):
    from datetime import datetime,timezone
    from types import SimpleNamespace
    from fmworker.google import Google
    google=Google(State(tmp_path),Vault(backend=MemoryKeyring()))
    google.drive_credentials=lambda:SimpleNamespace(token='short',expiry=datetime(2026,11,10,12,0),refresh_token='never-export')
    value=google.drive_access()
    assert value=={'access_token':'short','expires_at':datetime(2026,11,10,12,0,tzinfo=timezone.utc).timestamp()}


def test_large_cookie_record_uses_bounded_keychain_items(monkeypatch):
    import fmworker.state as module
    monkeypatch.setattr(module.platform,"system",lambda:"Windows")
    backend=MemoryKeyring();vault=Vault(backend=backend)
    value={'cookies':['sensitive'*1000]*3}
    vault.put('flow',value)
    assert max(map(len,backend.data.values()))<=1800
    assert vault.get('flow')==value
    vault.put('flow',{'small':True})
    assert len(backend.data)==1 and vault.get('flow')=={'small':True}
    vault.delete('flow');assert not backend.data


def test_oauth_wrong_state_is_rejected_and_cancel_closes_listener(tmp_path,monkeypatch):
    import time,requests
    from fmworker.google import Google
    opened=[];monkeypatch.setattr('fmworker.google.webbrowser.open',lambda url:opened.append(url) or True)
    google=Google(State(tmp_path),Vault(backend=MemoryKeyring()))
    google.configuration=lambda:{'installed':{'client_id':'test','client_secret':'test','auth_uri':'https://accounts.google.com/o/oauth2/auth',
        'token_uri':'https://oauth2.googleapis.com/token','redirect_uris':['http://localhost']}}
    google.begin(lambda:pytest.fail('Cancelled OAuth must not complete'))
    port=google.server.server_port
    response=requests.get(f'http://127.0.0.1:{port}/?state=wrong&code=untrusted',timeout=3)
    assert response.status_code==400
    google.reopen();assert len(opened)==2 and opened[0]==opened[1]
    google.cancel()
    deadline=time.monotonic()+3
    while google.server and time.monotonic()<deadline:time.sleep(.05)
    assert google.server is None and google.authorization_url is None
    assert google.state.get('google')['stage']=='error'


def test_pause_remains_available_during_other_resource_operation(tmp_path):
    import time
    from fmworker.service import Service
    service=Service(state=State(tmp_path),vault=Vault(backend=MemoryKeyring()),start_thread=False)
    service.state.resource('flow',enabled=True,node=7,stage='ready')
    changes=[];service.api.configure=lambda kind,enabled:changes.append((kind,enabled))
    service.operations['colab.start']={'running':True}
    service.dispatch('resource.pause',{'kind':'flow'})
    deadline=time.monotonic()+2
    while service.operations.get('flow.pause',{}).get('running') and time.monotonic()<deadline:time.sleep(.01)
    assert changes==[('flow',False)]
    assert not service.state.get('resources')['flow']['enabled']


def test_cloud_cache_does_not_receive_broader_google_scopes(tmp_path,monkeypatch):
    from datetime import datetime
    from types import SimpleNamespace
    import fmworker.google as module
    google=module.Google(State(tmp_path),Vault(backend=MemoryKeyring()))
    google.credentials=lambda:SimpleNamespace(refresh_token='local-only',token_uri='https://oauth2.googleapis.com/token',client_id='test',client_secret='test')
    selected=[]
    class Narrow:
        def __init__(self,**kw):selected.extend(kw['scopes']);self.token='temporary';self.expiry=datetime(2026,11,10)
        def refresh(self,request):pass
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'scope':'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/colaboratory'}
    monkeypatch.setattr(module,'Credentials',Narrow)
    monkeypatch.setattr(module.requests,'get',lambda *a,**kw:Response())
    with pytest.raises(RuntimeError,match='独立 Drive'):google.drive_credentials()
    assert selected==['https://www.googleapis.com/auth/drive.file']


def test_uncertain_colab_allocation_retries_same_request_id(tmp_path):
    from types import SimpleNamespace
    from test_colab_lifecycle import worker
    colab, api, allocations, bootstraps = worker(tmp_path)
    ids = []
    def assign(request_id, **kwargs):
        ids.append(request_id)
        raise TimeoutError()
    colab.client = lambda: SimpleNamespace(assign=assign)
    for _ in range(2):
        with pytest.raises(RuntimeError, match='申请结果未确认'): colab.deploy()
    assert len(ids) == 2 and ids[0] == ids[1]
    records = colab.records()
    assert len(records) == 1 and next(iter(records.values()))['phase'] == 'uncertain'


def test_colab_reconciliation_keeps_its_runtime_without_releasing_any_assignment(tmp_path):
    from types import SimpleNamespace
    from colab_cli.client import Assignment
    from test_colab_lifecycle import worker, account
    colab, api, allocations, bootstraps = worker(tmp_path)
    record = colab.new_record('h3', account()['eligible_accelerators'][1])
    colab.update(record['id'], phase='uncertain')
    released = []
    own = Assignment(endpoint='owned', runtimeProxyInfo={'token':'short','tokenExpiresInSeconds':3600,'url':'https://example.invalid'})
    client = SimpleNamespace(_get_assignment=lambda *args, **kwargs: own,
        unassign=lambda endpoint: released.append(endpoint),
        list_assignments=lambda: [SimpleNamespace(endpoint='unrelated-user-notebook')])
    colab.client = lambda: client
    recovered = colab.reconcile_allocation(record['id'])
    assert recovered.endpoint == 'owned' and released == []
    assert colab.records()[record['id']]['phase'] == 'allocated'
    assert colab.saved(record['id']).endpoint == 'owned'


def test_drive_preflight_failure_does_not_allocate_gpu(tmp_path):
    from fmworker.colab import Colab
    from types import SimpleNamespace
    state=State(tmp_path);state.resource('colab',limits={})
    state.set('settings',{'gpu':'G4','drive_cache':True})
    def denied():raise RuntimeError('Drive scope unavailable')
    colab=Colab(state,Vault(backend=MemoryKeyring()),SimpleNamespace(drive_access=denied),None)
    colab.client=lambda:pytest.fail('A GPU must not be allocated before cache authorization succeeds')
    with pytest.raises(RuntimeError,match='Drive scope'):colab.deploy()
    assert state.get('managed_colab') is None


def test_colab_readiness_uses_runtime_proxy_protocol(monkeypatch):
    from types import SimpleNamespace
    import fmworker.colab as module
    seen=[]
    def get(url,**kwargs):
        seen.append(kwargs)
        authorized=kwargs.get('params',{}).get('colab-runtime-proxy-token')=='runtime-token' and kwargs['headers'].get('Authorization')=='Bearer runtime-token'
        return SimpleNamespace(status_code=200 if authorized else 403)
    monkeypatch.setattr(module.requests,'get',get)
    assert module.runtime_ready(SimpleNamespace(url='https://runtime.example.invalid/',token='runtime-token'))
    assert seen[0]['timeout']==10


def test_restart_does_not_restore_an_abandoned_oauth_listener(tmp_path):
    from fmworker.service import Service
    state=State(tmp_path);state.set('google',{'stage':'authorizing','detail':'waiting'})
    service=Service(state=state,vault=Vault(backend=MemoryKeyring()),start_thread=False)
    assert service.status()['google']['stage']=='error'
    assert service.google.server is None


def test_logout_clears_cached_financial_history(tmp_path):
    from fmworker.service import Service
    service=Service(state=State(tmp_path),vault=Vault(backend=MemoryKeyring()),start_thread=False)
    service.cache={'earned':12,'balance':5,'history':[{'job':99}],'history_loaded':True}
    service.api.logout=lambda:None
    service.dispatch('logout',{})
    assert service.status()['earned'] is None
    assert service.status()['history']==[] and not service.status()['history_loaded']


def test_flow_preserves_reference_image_type():
    from fmworker.flow import image_mime
    assert image_mime(b'\xff\xd8\xff\xe0jpeg')=='image/jpeg'
    assert image_mime(b'\x89PNG\r\n\x1a\nimage')=='image/png'
    assert image_mime(b'RIFF1234WEBPimage')=='image/webp'
    with pytest.raises(RuntimeError):image_mime(b'RIFF1234WAVEaudio')


def test_bridge_protocol_stays_utf8_under_legacy_windows_encoding():
    import subprocess,os
    result=subprocess.run([sys.executable,str(ROOT/'runtime/bridge.py'),'--self-test'],
        env=dict(os.environ,PYTHONIOENCODING='cp1252',PYTHONUTF8='0'),capture_output=True,check=True,timeout=30)
    value=json.loads(result.stdout.decode('utf-8'))
    assert value['stdio_encoding']=='utf-8' and value['language_probe']=='中文 / English'


def test_flow_finishing_a_paused_job_updates_visible_stage(tmp_path):
    from fmworker.flow import Flow
    state=State(tmp_path);state.resource('flow',enabled=False,stage='busy',current_job=42)
    flow=Flow(state,Vault(backend=MemoryKeyring()),None);flow.active={'id':42}
    flow.finish_job_state()
    assert flow.active is None and state.get('resources')['flow']['stage']=='paused'
    state.resource('flow',stage='error',detail='result uncertain',current_job=43)
    flow.finish_job_state()
    assert state.get('resources')['flow']['stage']=='error'
    assert state.get('resources')['flow']['detail']=='result uncertain'


def test_google_disconnect_preflight_preserves_flow_if_colab_active(tmp_path):
    from fmworker.service import Service
    service=Service(state=State(tmp_path),vault=Vault(backend=MemoryKeyring()),start_thread=False)
    service.state.set('managed_colab',{'endpoint':'owned'})
    calls=[];service.flow.close=lambda:calls.append('close')
    with pytest.raises(RuntimeError,match='释放 Colab'):service.dispatch('google.disconnect',{})
    assert calls==[]


def test_google_disconnect_does_not_stop_local_breeze(tmp_path):
    from fmworker.service import Service
    service=Service(state=State(tmp_path),vault=Vault(backend=MemoryKeyring()),start_thread=False)
    service.state.resource('breeze',enabled=True,stage='busy')
    calls=[];service.flow.close=lambda:calls.append('flow');service.google.disconnect=lambda:calls.append('google')
    service.dispatch('google.disconnect',{})
    assert calls==['flow','google'] and service.state.get('resources')['breeze']['enabled']


def test_flow_relogin_rejects_active_job_before_browser_changes(tmp_path):
    from fmworker.service import Service
    service=Service(state=State(tmp_path),vault=Vault(backend=MemoryKeyring()),start_thread=False)
    service.state.resource('flow',stage='busy',current_job=42,enabled=True)
    service.flow.active={'id':42}
    service.flow.start_backend=lambda:pytest.fail('Must not open a browser during generation')
    with pytest.raises(RuntimeError,match='当前任务完成'):service.flow.connect()
    with pytest.raises(RuntimeError,match='当前任务完成'):service.dispatch('flow.connect',{})
    assert service.status()['resources']['flow']['stage']=='busy'
    assert not service.operations


def test_background_relogin_race_preserves_active_job_state(tmp_path,monkeypatch):
    from fmworker.service import Service
    import fmworker.service as module
    from types import SimpleNamespace
    service=Service(state=State(tmp_path),vault=Vault(backend=MemoryKeyring()),start_thread=False)
    def claim_before_connect():
        service.state.resource('flow',stage='busy',current_job=42,enabled=True)
        service.flow.active={'id':42}
        service.flow.connect()
    monkeypatch.setattr(module.threading,'Thread',lambda target,**kw:SimpleNamespace(start=target))
    service.background('flow.connect',claim_before_connect)
    assert service.operations['flow.connect']['running'] is False
    assert '当前任务完成' in service.operations['flow.connect']['error']
    assert service.status()['resources']['flow']['stage']=='busy'
    assert service.status()['resources']['flow']['current_job']==42


def test_flow_claim_during_browser_request_preserves_busy_state(tmp_path):
    from fmworker.flow import Flow
    from types import SimpleNamespace
    state=State(tmp_path);state.resource('flow',stage='ready',enabled=True)
    flow=Flow(state,Vault(backend=MemoryKeyring()),None)
    flow.start_backend=lambda:None
    def claim_during_request(*args,**kwargs):
        flow.active={'id':42}
        state.resource('flow',stage='busy',current_job=42,detail='正在生成')
        import httpx
        return httpx.Response(200,json={'ok':True})
    flow.client=SimpleNamespace(post=claim_during_request)
    flow.connect()
    assert state.get('resources')['flow']['stage']=='busy'
    assert state.get('resources')['flow']['current_job']==42
    assert state.get('resources')['flow']['detail']=='正在生成'


def test_old_contribution_limits_are_removed_on_start(tmp_path):
    from fmworker.service import Service
    state=State(tmp_path);state.resource('colab',limits={'daily_tasks':0,'daily_units':0})
    service=Service(state,Vault(backend=MemoryKeyring()),start_thread=False)
    assert all('limits' not in r for r in service.status()['resources'].values())
    with pytest.raises(ValueError,match='未知操作'):service.dispatch('resource.limits',{'kind':'colab','limits':{}})


def test_existing_chrome_session_is_detected_without_opening_a_window(tmp_path):
    from fmworker.service import Service
    service=Service(State(tmp_path),Vault(backend=MemoryKeyring()),start_thread=False)
    service.state.set('google',{'stage':'connected'})
    service.chrome.status=lambda:{'connected':True}
    calls=[];service.background=lambda key,fn:calls.append((key,fn))
    service.detect_existing_flow();service.detect_existing_flow()
    assert calls==[('flow.connect',service.flow.detect)]
    service.last_flow_probe=0;service.flow.backend_ready=True
    service.detect_existing_flow();assert len(calls)==1


def test_mac_vault_uses_one_item_and_caches_authorized_reads(monkeypatch):
    import fmworker.state as module
    monkeypatch.setattr(module.platform,'system',lambda:'Darwin')
    class Counting(MemoryKeyring):
        def __init__(self):super().__init__();self.reads=0;self.writes=0
        def get_password(self,*args):self.reads+=1;return super().get_password(*args)
        def set_password(self,*args):self.writes+=1;return super().set_password(*args)
    backend=Counting();value={'cookie':'x'*20000}
    Vault(backend=backend).put('flow',value)
    assert len(backend.data)==1
    vault=Vault(backend=backend);before=backend.reads
    copy=vault.get('flow');copy['cookie']='changed'
    assert vault.get('flow')==value and backend.reads==before+1
    writes=backend.writes;vault.put('flow',value)
    assert backend.writes==writes
    vault.delete('flow');assert vault.get('flow') is None and not backend.data


def test_mac_vault_consolidates_legacy_chunks(monkeypatch):
    import fmworker.state as module
    backend=MemoryKeyring();value={'cookie':'x'*5000}
    monkeypatch.setattr(module.platform,'system',lambda:'Windows')
    Vault(backend=backend).put('flow',value);assert len(backend.data)>1
    monkeypatch.setattr(module.platform,'system',lambda:'Darwin')
    assert Vault(backend=backend).get('flow')==value
    assert len(backend.data)==1 and json.loads(backend.data['fmWorker','flow'])==value


def test_flow_session_uses_chrome_without_an_extra_keychain_cookie_copy(tmp_path):
    import httpx
    from fmworker.flow import Flow
    from types import SimpleNamespace
    class NoCookieVault:
        def put(self,*args):pytest.fail('Chrome cookies must not be duplicated into the keychain')
    state=State(tmp_path);state.set('google_identity',{'email':'user@example.com'});state.resource('flow',enabled=False)
    flow=Flow(state,NoCookieVault(),None)
    flow.client=SimpleNamespace(post=lambda *a,**kw:httpx.Response(200,json={'connected':True,'email':'user@example.com','cookies':[]}))
    flow.sync()
    assert state.get('google')['flow']=='connected'
