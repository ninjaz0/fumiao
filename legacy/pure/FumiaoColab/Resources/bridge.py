"""Local Colab bridge. stdin JSON carries secrets; stdout contains only status/progress.

Allocation follows EasyColab; ownership, isolation, scoped release and recovery are
FumiaoColab changes. No account-wide adoption, kernel cleanup or stop-all operation.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time

ROOT = Path(os.environ.get("FUMIAOCOLAB_HOME", Path.home() / "Library/Application Support/FumiaoColab"))
RESOURCES = Path(__file__).resolve().parent
SITE = "https://nvmes.com"
os.umask(0o077)
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)


def save(path, value):
    path = Path(path)
    temp = path.with_suffix(".new")
    temp.write_text(json.dumps(value, ensure_ascii=False))
    temp.chmod(0o600)
    temp.replace(path)


def load(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def initialize():
    import colab_cli.auth as auth
    from colab_cli.common import state
    from colab_cli.history import HistoryLogger
    import colab_helpers as helper
    auth.TOKEN_CONFIG_PATH = str(ROOT / "google-token.json")
    helper.TOKEN_CONFIG_PATH = auth.TOKEN_CONFIG_PATH
    helper.ACCOUNT_PROFILE_CACHE_PATH = str(ROOT / "google-profile.json")
    state.config_path = str(ROOT / "sessions.json")
    state.client_oauth_config = str(ROOT / "oauth-config.json")
    state._history = HistoryLogger(str(ROOT / "history"))
    # Do not silently pick up another application's OAuth client configuration.
    from importlib import resources
    helper._load_client_config = lambda: json.loads(resources.files("colab_cli").joinpath("oauth_config.json").read_text())
    helper._sync_macos_system_proxies_to_env()
    return helper, state


def managed_record(owner):
    record = load(ROOT / "managed.json", {})
    if record and record.get("owner_id") != owner:
        raise ValueError("此实例属于另一个弗淼账号，请登录原账号管理。")
    return record


def require_auth(helper):
    if not helper._has_valid_token():
        raise ValueError("Google 授权已过期，请重新绑定账号。")


def current_session(state, record):
    if not record:
        return None
    sessions, _ = state.sync_sessions()  # Failure stays a failure, never a false zero.
    session = sessions.get(record["session_name"])
    if session and session.endpoint == record["endpoint"]:
        return session
    return None


def status(helper, state, data):
    if not helper._has_valid_token():
        return {"ok": True, "logged_in": False}
    info = state.client.get_consumption_user_info()
    record = managed_record(data.get("owner_id"))
    session = current_session(state, record)
    return {"ok": True, "logged_in": True, "email": helper._get_account_email(),
            "paid_balance": float(info.paid_compute_units_balance),
            "burn_rate_hourly": float(info.consumption_rate_hourly),
            "managed_active": bool(session), "node_name": record.get("node_name", ""),
            "started_at": record.get("started_at"), "idle_minutes": record.get("idle_minutes", 30)}


def auth_url(helper, state):
    record = load(ROOT / "managed.json", {})
    if record:
        require_auth(helper)
        if current_session(state, record):
            raise ValueError("请先释放当前实例，再更换 Google 账号。")
    from google_auth_oauthlib.flow import InstalledAppFlow
    flow = InstalledAppFlow.from_client_config(helper._load_client_config(), helper.PUBLIC_SCOPES)
    flow.redirect_uri = helper.REMOTE_REDIRECT_URI
    url, nonce = flow.authorization_url(prompt="select_account consent", token_usage="remote")
    save(ROOT / "oauth-pending.json", {"verifier": flow.code_verifier, "state": nonce, "created": time.time()})
    return {"ok": True, "auth_url": url}


def auth_code(helper, data):
    from google_auth_oauthlib.flow import InstalledAppFlow
    pending = load(ROOT / "oauth-pending.json", {})
    if not pending or time.time() - pending["created"] > 600:
        raise ValueError("授权页面已过期，请重新点击绑定。")
    code = str(data.get("code", "")).strip()
    if not code or len(code) > 8192:
        raise ValueError("请粘贴 Google 页面显示的授权码。")
    flow = InstalledAppFlow.from_client_config(helper._load_client_config(), helper.PUBLIC_SCOPES,
        state=pending["state"], code_verifier=pending["verifier"])
    flow.redirect_uri = helper.REMOTE_REDIRECT_URI
    flow.fetch_token(code=code, timeout=30)
    save(ROOT / "google-token.json", json.loads(flow.credentials.to_json()))
    for name in ("oauth-pending.json", "google-profile.json", "sessions.json", "managed.json"):
        (ROOT / name).unlink(missing_ok=True)
    return {"ok": True, "logged_in": True}


def execute(state, session, code, timeout=90):
    from colab_cli.runtime import ColabRuntime
    def kernel(value):
        session.kernel_id = value
        state.store.add(session)
    def sid(value):
        session.session_id = value
        state.store.add(session)
    runtime = ColabRuntime(session.url, session.token, session_name=session.name,
        kernel_id=session.kernel_id, session_id=session.session_id,
        on_kernel_started=kernel, on_session_started=sid)
    try:
        outputs = runtime.execute_code(code, allow_stdin=False, timeout=timeout)
        if any(item.get("output_type") == "error" for item in outputs):
            raise ValueError("云端初始化未完成，请释放实例后重试。")
        return outputs
    finally:
        runtime.stop(shutdown_kernel=False)


def validate_deployment(data):
    if data.get("site") != SITE or not isinstance(data.get("owner_id"), int) or data["owner_id"] <= 0:
        raise ValueError("请先登录弗淼 AIGC。")
    if not re.fullmatch(r"[A-Za-z0-9_-]{30,128}", data.get("code", "")):
        raise ValueError("弗淼接入凭据无效，请重新部署。")
    if data.get("gpu") not in ("G4", "H100", "A100"):
        raise ValueError("请选择支持的 GPU。")
    if data.get("idle_minutes") not in (0, 15, 30, 60):
        raise ValueError("闲置时间无效。")
    if not isinstance(data.get("node_name"), str) or not 1 <= len(data["node_name"]) <= 45:
        raise ValueError("实例名称无效。")


def deploy(helper, state, data):
    validate_deployment(data)
    require_auth(helper)
    previous = managed_record(data["owner_id"])
    if current_session(state, previous):
        raise ValueError("当前已有实例，请先释放后再部署。")
    from colab_cli.contents import ContentsClient
    name = "fumiao-" + str(data["owner_id"]) + "-" + str(int(time.time()))
    session = helper._allocate_fresh_session(name, data["gpu"])
    record = {"owner_id": data["owner_id"], "node_name": data["node_name"], "session_name": name,
              "endpoint": session.endpoint, "started_at": time.time(), "idle_minutes": data["idle_minutes"]}
    save(ROOT / "managed.json", record)  # Persist immediately, including on failed initialization.
    try:
        if not helper._wait_for_runtime_ready(session, timeout_s=90):
            raise ValueError("Colab 实例初始化超时，请重试。")
        print("PROGRESS:正在上传 MiniMax H3 部署组件…", flush=True)
        content = ContentsClient(session)
        execute(state, session, "import os; os.makedirs('/content/fumiaocolab', mode=0o700, exist_ok=True)")
        for filename in ("cloud_worker.py", "h3_engine.py", "h3_optimizations.py"):
            content.upload(str(RESOURCES / filename), "content/fumiaocolab/" + filename)
        with tempfile.TemporaryDirectory(prefix="fumiaocolab-") as tmp:
            config = Path(tmp) / "config.json"
            save(config, {k: data[k] for k in ("site", "code", "node_name", "idle_minutes")})
            content.upload(str(config), "content/fumiaocolab/config.json")
            drive = helper._build_rclone_drive_conf()
            if drive:
                path = Path(tmp) / "rclone.conf"
                path.write_text(drive); path.chmod(0o600)
                content.upload(str(path), "content/fumiaocolab/rclone.conf")
        output = execute(state, session, """
import os, sys, subprocess, time
root='/content/fumiaocolab'
os.chmod(root, 0o700)
for name in ('config.json', 'rclone.conf'):
    p=os.path.join(root,name)
    if os.path.exists(p): os.chmod(p,0o600)
with open(root+'/worker.log','ab') as log:
    p=subprocess.Popen([sys.executable,'-u',root+'/cloud_worker.py'],cwd=root,stdout=log,stderr=log,start_new_session=True)
time.sleep(2)
if p.poll() is not None: raise RuntimeError('Worker startup failed')
print('FUMIAO_STARTED')
""")
        if not any("FUMIAO_STARTED" in item.get("text", "") for item in output):
            raise ValueError("未收到云端启动确认，请重试。")
        return {"ok": True, "managed_active": True, "node_name": data["node_name"]}
    except Exception:
        try:
            state.client.unassign(session.endpoint)
            state.prune_session(session.name)
            (ROOT / "managed.json").unlink(missing_ok=True)
        except Exception:
            raise ValueError("部署失败且实例释放未确认。请刷新后释放实例，避免继续扣费。") from None
        raise


def stop(helper, state, data):
    require_auth(helper)
    record = managed_record(data.get("owner_id"))
    session = current_session(state, record)
    if session:
        state.client.unassign(session.endpoint)
        for _ in range(10):
            if not any(a.endpoint == session.endpoint for a in state.client.list_assignments()):
                state.prune_session(session.name)
                break
            time.sleep(2)
        else:
            raise ValueError("Colab 尚未确认释放，请稍后刷新。")
    (ROOT / "managed.json").unlink(missing_ok=True)
    return {"ok": True}


def idle(helper, state, data):
    minutes = data.get("minutes")
    if minutes not in (0, 15, 30, 60):
        raise ValueError("闲置时间无效。")
    require_auth(helper)
    record = managed_record(data.get("owner_id"))
    session = current_session(state, record)
    if not session:
        raise ValueError("实例已离线，请刷新状态。")
    execute(state, session, "from pathlib import Path; Path('/content/fumiaocolab/idle.json').write_text(" + repr(json.dumps({"minutes": minutes})) + ")")
    record["idle_minutes"] = minutes
    save(ROOT / "managed.json", record)
    return {"ok": True}


def main():
    data = json.load(sys.stdin)
    command = sys.argv[1]
    with (ROOT / "bridge.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        helper, state = initialize()
        try:
            if command == "auth_url": result = auth_url(helper, state)
            elif command == "auth_code": result = auth_code(helper, data)
            elif command == "status": result = status(helper, state, data)
            elif command == "deploy": result = deploy(helper, state, data)
            elif command == "stop": result = stop(helper, state, data)
            elif command == "idle": result = idle(helper, state, data)
            else: raise ValueError("未知操作。")
            print(json.dumps(result, ensure_ascii=False), flush=True)
        except ValueError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        except Exception as exc:
            # Do not echo request URLs, tokens, authorization codes or credentials.
            print(json.dumps({"ok": False, "error": "Google 连接失败（" + type(exc).__name__ + "），请检查网络或重新绑定。"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
