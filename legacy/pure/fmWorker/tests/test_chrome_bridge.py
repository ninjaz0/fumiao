import io
import json
import struct
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
from fmworker.chrome_bridge import ChromeBridge,extension_id,extension_manifest,MAX_PACKET
from fmworker.chrome_native import read_packet,run
from fmworker.state import State


def paired(tmp_path):
    bridge=ChromeBridge(State(tmp_path),start=False)
    bridge.dispatch({'op':'poll','client':'a'*24,'version':extension_manifest()['version']})
    return bridge


def wait_pending(bridge):
    deadline=time.monotonic()+1
    while not bridge.pending and time.monotonic()<deadline:time.sleep(.005)
    assert bridge.pending


def test_command_result_is_bound_to_owning_chrome_user(tmp_path):
    bridge=paired(tmp_path)
    with ThreadPoolExecutor() as executor:
        future=executor.submit(bridge.request,'open_flow',{},1)
        wait_pending(bridge)
        command=bridge.dispatch({'op':'poll','client':'a'*24,'version':extension_manifest()['version']})['commands'][0]
        with pytest.raises(RuntimeError,match='另一个 Chrome 用户'):
            bridge.dispatch({'op':'result','client':'b'*24,'id':command['id'],'result':{'ok':True}})
        bridge.dispatch({'op':'result','client':'a'*24,'id':command['id'],'result':{'ok':True}})
        assert future.result()=={'ok':True}
    assert not bridge.pending


def test_timed_out_command_is_never_replayed(tmp_path):
    bridge=paired(tmp_path)
    with pytest.raises(RuntimeError,match='响应超时'):bridge.request('session',timeout=.01)
    assert not bridge.pending
    assert not bridge.dispatch({'op':'poll','client':'a'*24,'version':extension_manifest()['version']})['commands']


def test_disconnect_unblocks_waiting_browser_request(tmp_path):
    bridge=paired(tmp_path)
    with ThreadPoolExecutor() as executor:
        future=executor.submit(bridge.request,'session',{},1);wait_pending(bridge)
        bridge.dispatch({'op':'disconnect','client':'a'*24})
        with pytest.raises(RuntimeError):future.result()
    assert not bridge.status()['connected']


def test_expired_or_old_extension_cannot_accept_new_work(tmp_path):
    bridge=paired(tmp_path)
    bridge.last_seen-=20
    with pytest.raises(RuntimeError,match='安装并连接'):bridge.request('session',timeout=.01)
    bridge.dispatch({'op':'poll','client':'a'*24,'version':'0.0.1'})
    assert bridge.status()['stage']=='update_required'
    with pytest.raises(RuntimeError,match='安装并连接'):bridge.request('session',timeout=.01)


def test_desktop_controls_expected_account_and_command_allowlist(tmp_path):
    bridge=paired(tmp_path);bridge.state.set('google_identity',{'email':'expected@example.com'})
    seen=[];bridge.request=lambda kind,payload,timeout:seen.append((kind,payload)) or {'ok':True}
    bridge.dispatch({'op':'browser','kind':'session','payload':{'expected_email':'other@example.com'}})
    assert seen[0][1]['expected_email']=='expected@example.com'
    with pytest.raises(ValueError):bridge.dispatch({'op':'browser','kind':'captcha','payload':{'action':'arbitrary_js'}})
    with pytest.raises(ValueError):paired(tmp_path).request('arbitrary_js')


def test_loopback_transport_requires_secret_and_rejects_page_origin(tmp_path):
    bridge=ChromeBridge(State(tmp_path))
    try:
        url=f'http://127.0.0.1:{bridge.port}/bridge'
        with httpx.Client(trust_env=False) as client:
            assert client.post(url,json={'op':'status'}).status_code==403
            headers={'Authorization':'Bearer '+bridge.secret}
            assert client.post(url,headers=headers,json={'op':'status'}).status_code==200
            assert client.post(url,headers=headers|{'Origin':'https://example.com'},json={'op':'status'}).status_code==403
            assert client.post(url,headers=headers,content=b'x'*(MAX_PACKET+1)).status_code==413
    finally:bridge.close()
    assert not (tmp_path/'chrome-bridge.json').exists()


def test_reference_upload_verification_round_trip_and_action_allowlist(tmp_path):
    bridge=ChromeBridge(State(tmp_path));bridge.state.set('google_identity',{'email':'expected@example.com'})
    client_id='upload-test-client-000000'
    bridge.dispatch({'op':'poll','client':client_id,'version':extension_manifest()['version']})
    try:
        url=f'http://127.0.0.1:{bridge.port}/bridge';headers={'Authorization':'Bearer '+bridge.secret}
        with httpx.Client(trust_env=False) as client,ThreadPoolExecutor() as pool:
            future=pool.submit(client.post,url,headers=headers,json={'op':'browser','kind':'captcha','payload':{'action':'UPLOAD_IMAGE','project_id':'test-project'}})
            wait_pending(bridge)
            command=bridge.dispatch({'op':'poll','client':client_id,'version':extension_manifest()['version']})['commands'][0]
            assert command['payload']['action']=='UPLOAD_IMAGE'
            assert command['payload']['expected_email']=='expected@example.com'
            bridge.dispatch({'op':'result','client':client_id,'id':command['id'],'result':{'ok':True,'token':'synthetic-upload-token'}})
            assert future.result().json()['result']['token']=='synthetic-upload-token'
            denied=client.post(url,headers=headers,json={'op':'browser','kind':'captcha','payload':{'action':'RUN_SCRIPT'}})
            assert 'error' in denied.json() and not bridge.pending
    finally:bridge.close()


def test_allowlist_covers_pinned_upstream_verification_actions():
    import ast,tarfile
    from fmworker.chrome_bridge import CAPTCHA_ACTIONS
    from fmworker.assets import bundled
    found=set()
    with tarfile.open(bundled('flow2api.tar.gz'),'r:gz') as archive:
        for member in archive.getmembers():
            if not member.isfile() or '/src/services/' not in member.name or not member.name.endswith('.py'):continue
            tree=ast.parse(archive.extractfile(member).read())
            for node in ast.walk(tree):
                if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Attribute) or node.func.attr!='_get_recaptcha_token':continue
                for kw in node.keywords:
                    if kw.arg=='action' and isinstance(kw.value,ast.Constant):found.add(kw.value.value)
    assert 'UPLOAD_IMAGE' in found and found <= CAPTCHA_ACTIONS


def test_native_framing_and_origin_do_not_start_a_controller():
    value={'type':'hello','label':'中文'};raw=json.dumps(value).encode()
    assert read_packet(io.BytesIO(struct.pack('=I',len(raw))+raw))==value
    for raw in (b'x',struct.pack('=I',MAX_PACKET+1),struct.pack('=I',4)+b'{}'):
        with pytest.raises(ValueError):read_packet(io.BytesIO(raw))
    assert run(['chrome-extension://'+'a'*32+'/'],io.BytesIO(),io.BytesIO())==2
    assert len(extension_id())==32


def test_extension_requests_only_flow_hosts_and_fixed_privileges():
    manifest=extension_manifest()
    assert set(manifest['host_permissions'])=={'https://flow.google.com/*','https://labs.google/*'}
    assert set(manifest['permissions'])=={'nativeMessaging','storage','alarms','cookies','scripting'}
    assert 'debugger' not in manifest['permissions']


def test_install_preparation_registers_only_bundled_extension(tmp_path,monkeypatch):
    import fmworker.chrome_bridge as module
    monkeypatch.setattr(module.platform,'system',lambda:'Darwin')
    monkeypatch.setattr(module.Path,'home',classmethod(lambda cls:tmp_path/'user'))
    executable=tmp_path/'fmworker';executable.write_text('test executable')
    monkeypatch.setenv('FMWORKER_NATIVE_EXECUTABLE',str(executable))
    bridge=ChromeBridge(State(tmp_path/'state'),start=False)
    result=bridge.prepare()
    assert result['prepared'] and not result['connected']
    host=json.loads((tmp_path/'user/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.nvmes.fmworker.json').read_text())
    assert host['allowed_origins']==['chrome-extension://'+extension_id()+'/']
    assert Path(host['path']).is_file()
    assert (bridge.folder/'manifest.json').read_text()==module.bundled('chrome-extension/manifest.json').read_text()


def test_missing_extension_cannot_enable_platform_resource(tmp_path):
    from fmworker.service import Service
    from fmworker.state import Vault
    class Memory:
        def get_password(self,*a):return None
    service=Service(State(tmp_path),Vault(backend=Memory()),start_thread=False)
    service.state.set('account',{'id':1})
    service.state.set('google',{'stage':'connected'})
    service.api.register=lambda *a:pytest.fail('Do not register or enable before the extension is ready')
    with pytest.raises(RuntimeError,match='安装并连接'):service.start('flow')


def test_extension_manager_targets_current_profile_not_profile_picker(tmp_path,monkeypatch):
    import fmworker.chrome_bridge as module
    monkeypatch.setattr(module.platform,'system',lambda:'Darwin')
    monkeypatch.setattr(module.Path,'home',classmethod(lambda cls:tmp_path/'user'))
    root=tmp_path/'user/Library/Application Support/Google/Chrome';root.mkdir(parents=True)
    (root/'Local State').write_text(json.dumps({'profile':{'last_used':'Profile 5','last_active_profiles':['Profile 5'],
        'info_cache':{'Profile 5':{'name':'Existing User'}}}}))
    monkeypatch.setattr(module,'chrome_binary',lambda:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    calls=[];monkeypatch.setattr(module.subprocess,'Popen',lambda command,**kwargs:calls.append(command))
    ChromeBridge(State(tmp_path/'state'),start=False).open_extensions()
    assert calls[0][1:]==['--profile-directory=Profile 5','chrome://extensions/']
    assert not any(arg.startswith('--user-data-dir') or arg=='--new-window' for arg in calls[0])
