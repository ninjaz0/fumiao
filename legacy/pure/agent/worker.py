"""Outbound-only DSW node; private task state is retained until the server acknowledges the MP4."""

import fcntl
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from install_progress import InstallProgress
from job_progress import JobClock, WORKFLOW, sampling_steps, SUPPORTED_STEPS
from node_models import GPU_MODELS, LEGACY_MODELS, h3_pipeline_id
from hardware_probe import probe, kernel_probe

ROOT = Path(__file__).resolve().parent
NODE_STATE = ROOT / "state"
LANE=os.getenv('FUMIAO_LANE_MODEL','')
if LANE and LANE not in GPU_MODELS:raise RuntimeError('未知执行通道')
STATE = NODE_STATE/'lanes'/GPU_MODELS[LANE]['slug'] if LANE else NODE_STATE
ENGINE = ROOT / "engine"
SITE = os.environ.get("FUMIAO_SITE", "https://nvmes.com").rstrip("/")
USER_AGENT = "Fumiao-Worker/1.0"
CACHE = Path(os.environ.get("H3_CACHE", "/opt/fumiao-h3"))
ENV = dict(
    os.environ,
    H3_CACHE=str(CACHE),
    H3_PORT=os.getenv("H3_PORT", "18388"),
    PYTHONUNBUFFERED="1",
)
identity = NODE_STATE / "credential"
phase = "preparing"
detail = "正在检查魔搭环境"
ticket = ""
progress_start = None
progress_file = None
installation = None
job_clock = None
hardware = ""
hardware_profile = None
runtime_id = os.getenv('FUMIAO_RUNTIME_ID') or secrets.token_hex(12)
execution={'mode':'serial','policy':'gpu-budget-v1'}
server_protocol=0
server_execution='serial'
can_accept=True
last_mode = None
selected_models = list(LEGACY_MODELS)
installed_models = []
model_profiles = {}
device_index = 0
adapters = {}
lost = threading.Event()
stopped = threading.Event()


def save(path, obj):
    staged = path.with_suffix(".new")
    staged.write_text(json.dumps(obj, ensure_ascii=False))
    staged.replace(path)


def api(path, data=None, method="POST", ticket_value=None, raw=None, digest=None, timing_report=None, media_type="video/mp4"):
    headers = {"Authorization": "Bearer " + identity.read_text().strip(), "User-Agent": USER_AGENT}
    if LANE:headers["X-Model-Lane"]=LANE
    if ticket_value:
        headers["X-Job-Ticket"] = ticket_value
    body = raw
    if raw is None and method != "GET":
        headers["Content-Type"] = "application/json"
        body = json.dumps(data or {}).encode()
    if raw is not None:
        headers["Content-Type"] = media_type
        headers["X-SHA256"] = digest
        if timing_report:
            headers["X-Job-Timing"] = json.dumps(timing_report,separators=(",",":"))
    req = urllib.request.Request(SITE + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=165 if raw else 35) as r:
        return r.read() if method == "GET" else json.load(r)


def enroll(code):
    STATE.mkdir(parents=True,exist_ok=True, mode=0o700)
    pending = STATE / "pending-secret"
    pairing=NODE_STATE/'pairing.json'
    same_site=SITE=='https://nvmes.com'
    try:same_site=json.loads(pairing.read_text()).get('site')==SITE
    except (OSError,ValueError):pass
    reused=False
    if identity.is_file() and same_site:
        try:
            registered=json.loads(api('/agent/registration',method='GET'))
            if registered.get('paired_code_hash')==hashlib.sha256(code.encode()).hexdigest():
                secret=identity.read_text().strip();reused=True
        except (OSError,ValueError):pass
    if not reused:
        if not pending.exists():pending.write_text(secrets.token_urlsafe(42))
        secret=pending.read_text().strip()
    req = urllib.request.Request(
        SITE + "/agent/enroll",
        data=json.dumps({"code": code, "secret": secret}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=35) as r:
        result=json.load(r)
    requested=json.loads((STATE/'requested-models.json').read_text()) if (STATE/'requested-models.json').exists() else LEGACY_MODELS
    granted=result.get('models',LEGACY_MODELS)
    if granted!=requested:raise RuntimeError('接入模型与命令不符，请重新复制命令')
    save(STATE/'models.json',granted)
    if not reused:pending.replace(identity)
    save(pairing,{'site':SITE,'code_hash':hashlib.sha256(code.encode()).hexdigest(),'models':granted})
    if reused:print('沿用已验证的实例接入，无需重新注册',flush=True)


def sampling_progress(log_path, start):
    if progress_file and progress_file.exists():
        try:
            value = json.loads(progress_file.read_text())
            return {"step":value["step"],"steps":value["steps"]}
        except (OSError, ValueError, KeyError):
            pass
    if start is None or (job_clock and job_clock.steps != 20):
        return {}
    try:
        with log_path.open("rb") as log:
            end = log.seek(0, 2)
            log.seek(max(start, end - 8192))
            data = log.read(8192)
    except OSError:
        return {}
    entries = re.findall(
        rb"(?:^|[\r\n])\s*\d+%\|[^\r\n]{0,300}?\|\s*(\d+)/(\d+)\s+\[", data
    )
    if not entries:
        return {}
    step, total = map(int, entries[-1])
    return {"step": step, "steps": total} if 0 <= step <= total <= 100 else {}


def needs_render_verification(folder, job):
    verified = folder / "verified.json"
    if not verified.exists():
        return True
    if 'sampling_steps' in job:
        try:
            report=json.loads(verified.read_text())
            if report.get('sampling_steps')!=job['sampling_steps']:return True
            if job['sampling_steps']==4 and report.get('fast_mode') is not True:return True
        except (OSError,ValueError):return True
    from node_models import h3_input_metadata,h3_input_fingerprint
    if h3_input_metadata(job):
        report=json.loads(verified.read_text())
        return report.get('h3_input_fingerprint')!=h3_input_fingerprint(job) or report.get('keyframe_checks',{}).get('version')!=1
    if len(job["refs"]) != 1:
        return False
    report = json.loads(verified.read_text())
    check = report.get("quality_check")
    # A pre-fix receipt must pass the new quality check before it is uploaded.
    return not isinstance(check, dict) or check.get("version") != 1


def beat():
    global server_protocol,server_execution
    current = ticket
    body = {
        "stage": phase,
        "detail": installation.message
        if phase == "preparing" and installation
        else detail,
        "ticket": current,
        "hardware": hardware, "workflow": WORKFLOW, "runtime_id": runtime_id,
        "ready_models":installed_models, "model_profiles":model_profiles,
        "lane_model":LANE or None,"can_accept":can_accept,
        "video_steps":list(SUPPORTED_STEPS) if 'MiniMax H3' in selected_models else None,
        "execution_plan":execution if not LANE else None,
    }
    if hardware_profile:
        body["profile"] = hardware_profile
    if current and phase == "busy":
        if detail == "正在回传并校验成片":
            body["uploading"] = True
        elif job_clock and job_clock.steps != 1:
            body.update(
                sampling_progress(ENGINE / "state/logs/comfy.log", progress_start)
            )
        if job_clock:
            body["job_phase"], body["timing"] = job_clock.snapshot()
    answer = api("/agent/heartbeat", body)
    server_protocol=answer.get("protocol",1);server_execution=answer.get("execution_mode","serial")
    if current and current == ticket and not answer["held"]:
        lost.set()


def ticker():
    while not stopped.wait(12):
        try:
            beat()
        except urllib.error.HTTPError as e:
            if e.code == 403:
                lost.set()
                stopped.set()
        except (TimeoutError, OSError):
            pass


def restore_github_archive(work, revision):
    # GitHub serves a source snapshot without Git metadata. Verify the snapshot,
    # rebuild its Git tree, and require the exact signed upstream commit object.
    archive = STATE / "packages/comfy-github-651ca296.tgz"
    archive.parent.mkdir(exist_ok=True)
    expected = "0a015b6cac5b9170c493642e529df4a763a67aac059b07ff8c220a83f70cdc9a"
    if not archive.exists():
        from cache_manager import artifact_candidates
        for old in artifact_candidates(ROOT)[0]:
            old=Path(old)
            if old.is_file() and hashlib.sha256(old.read_bytes()).hexdigest()==expected:
                shutil.copy2(old,archive);break
    if (
        not archive.exists()
        or hashlib.sha256(archive.read_bytes()).hexdigest() != expected
    ):
        tmp = archive.with_suffix(".new")
        url = "https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/" + revision
        subprocess.run(
            [
                "curl",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--connect-timeout",
                "8",
                "--max-time",
                "60",
                url,
                "-o",
                str(tmp),
            ],
            check=True,
        )
        if hashlib.sha256(tmp.read_bytes()).hexdigest() != expected:
            tmp.unlink(missing_ok=True)
            raise ValueError("GitHub 压缩包摘要不符")
        tmp.replace(archive)
    work.mkdir()
    subprocess.run(
        ["tar", "-C", str(work), "--strip-components=1", "-xzf", str(archive)],
        check=True,
    )
    git = ["git", "-C", str(work)]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run(
        [
            *git,
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.filemode=true",
            "add",
            "-f",
            "--",
            ".",
        ],
        check=True,
    )
    tree = subprocess.check_output([*git, "write-tree"], text=True).strip()
    if tree != "d0185e72854a10df148afa0ef41dcd7283bf8836":
        raise ValueError("GitHub 源码树和固定版本不符")
    commit = subprocess.check_output(
        [
            *git,
            "hash-object",
            "-t",
            "commit",
            "-w",
            str(ENGINE / "assets/comfy-source.commit"),
        ],
        text=True,
    ).strip()
    if commit != revision:
        raise ValueError("GitHub 提交校验失败")
    (work / ".git/shallow").write_text(revision + "\n")
    subprocess.run([*git, "checkout", "-q", "--detach", revision], check=True)


def ensure_source():
    """Reuse a matching Git object database or resume the verified fallback download."""
    revision = "651ca296a73cd21c12a57eb8741d52e40dc6528f"
    target = ENGINE / "state/ComfyUI"
    quarantined_source=None
    if target.exists():
        from rocm_attention_patch import verify_checkout
        check=subprocess.run(['git','-C',str(target),'rev-parse','HEAD'],capture_output=True,text=True)
        try:
            if check.returncode or check.stdout.strip()!=revision:raise RuntimeError('源码版本不符')
            if target.is_symlink():raise RuntimeError('源码是外部软链接，保留后恢复独立检出')
            subprocess.run(['git','-C',str(target),'fsck','--no-reflogs','--no-dangling','HEAD'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            verify_checkout(target)
            return
        except (OSError,RuntimeError,subprocess.SubprocessError):
            quarantined_source=target.with_name('ComfyUI.invalid-'+str(time.time_ns()))
            target.rename(quarantined_source)
            from cache_manager import relocate_prefix
            relocate_prefix(target,quarantined_source,ROOT)
            installation.update('原源码不匹配，已保留并准备恢复固定版本')
    target.parent.mkdir(exist_ok=True)
    work = target.with_name("fumiao-source-staging")
    # The name belongs exclusively to this installer and is protected by the node lock.
    shutil.rmtree(work, ignore_errors=True)
    candidates = [
        Path("/mnt/workspace") / p / "ComfyUI"
        for p in ("minimax-h3-20261027", "videogen-h3")
    ]
    from cache_manager import artifact_candidates
    archives,source_dirs=artifact_candidates(ROOT)
    candidates += [Path(p) for p in source_dirs if Path(p).name=='ComfyUI']
    if quarantined_source:candidates.append(quarantined_source)
    for path in candidates:
        check = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
        )
        if check.returncode == 0 and check.stdout.strip() == revision:
            subprocess.run(
                [
                    "git",
                    "clone",
                    "--no-hardlinks",
                    "--no-checkout",
                    str(path),
                    str(work),
                ],
                check=True,
            )
            break
    else:
        try:
            restore_github_archive(work, revision)
            work.replace(target)
            return
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            print("GitHub 源码下载或校验失败，改用腾讯云镜像：", exc, flush=True)
            shutil.rmtree(work, ignore_errors=True)
        archive = STATE / "packages/comfy-651ca296.tgz"
        archive.parent.mkdir(exist_ok=True)
        expected = "eaa822a952de97a8683d5878f42be92a33ce7174f8017b1e1c0dffcbbeb6dcf3"

        def valid(path):
            return (
                path.exists()
                and hashlib.sha256(path.read_bytes()).hexdigest() == expected
            )

        if not valid(archive):
            for old in archives:
                if valid(Path(old)):shutil.copy2(old,archive);break
        if not valid(archive):
            partial = archive.with_suffix(".partial")
            subprocess.run(
                [
                    "curl",
                    "-fSL",
                    "--retry",
                    "4",
                    "--connect-timeout",
                    "15",
                    "-C",
                    "-",
                    SITE + "/connect/comfy-651ca296.tgz",
                    "-o",
                    str(partial),
                ],
                check=True,
            )
            if not valid(partial):
                partial.unlink(missing_ok=True)
                raise RuntimeError("ComfyUI 源码摘要不符，请重新运行安装器")
            partial.replace(archive)
        work.mkdir()
        subprocess.run(["tar", "-C", str(work), "-xzf", str(archive)], check=True)
    subprocess.run(
        ["git", "-C", str(work), "checkout", "-q", "--detach", revision], check=True
    )
    work.replace(target)


def prepare_h3():
    global detail
    python = os.environ.get("H3_PYTHON", sys.executable)
    subprocess.run(
        [
            python,
            "-c",
            "import sys,torch; assert sys.version_info[:2]>=(3,12) and torch.cuda.is_available(), '需要 Python 3.12 与可用的 CUDA/ROCm GPU'",
        ],
        check=True,
    )
    detail = "正在检查固定版本的 ComfyUI 源码"
    installation.update("准备固定版本的 ComfyUI 源码")
    ensure_source()
    detail = "正在准备两套工作流、校验与补齐模型"
    p = subprocess.Popen(
        ["bash", str(ENGINE / "scripts/restore.sh"), "both"],
        env=ENV | {"H3_PYTHON": python},
        cwd=ENGINE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    def relay():
        with p.stdout:
            for line in p.stdout:
                sys.stdout.write(line)
                installation.read_line(line)

    reader = threading.Thread(target=relay, daemon=True)
    reader.start()
    while p.poll() is None:
        if stopped.wait(2):
            p.terminate()
            raise RuntimeError("实例已移除")
    reader.join()
    if p.returncode:
        raise RuntimeError("模型恢复失败，查看实例中的 worker.log，再运行接入脚本重试")


def stop_render(p, folder):
    # This service has its own port and receives one cloud task at a time.
    if p.poll() is None:
        p.terminate()
    try:
        url = "http://127.0.0.1:" + ENV["H3_PORT"]
        req = urllib.request.Request(
            url + "/interrupt", data=b"{}", headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=4).close()
    except OSError:
        pass


def cleanup(folder):
    saved_job=folder/'job.json'
    if saved_job.exists() and json.loads(saved_job.read_text()).get('kind')=='audio':
        shutil.rmtree(folder);return
    run = folder.name
    inputs = ENGINE / "state/inputs/fumiao" / run
    shutil.rmtree(inputs, ignore_errors=True)
    output = ENGINE / "state/outputs/fumiao"
    job = json.loads((folder / "job.json").read_text())
    # Comfy history includes the prompt. Remove only this job's entry.
    submission = folder / "submission.json"
    if submission.exists():
        pid = json.loads(submission.read_text())["prompt_id"]
        req = urllib.request.Request(
            "http://127.0.0.1:" + ENV["H3_PORT"] + "/history",
            data=json.dumps({"delete": [pid]}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10):
            pass
    for path in output.glob(f"fm-{job['id']}_*.mp4"):
        path.unlink(missing_ok=True)
    shutil.rmtree(folder)


def execute(j):
    if j.get('model') in adapters:return execute_adapter(j,adapters[j['model']])
    for adapter in adapters.values():adapter.stop_service()
    global phase, detail, ticket, progress_start, progress_file, job_clock, last_mode
    progress_start = None
    phase = "busy"
    ticket = j["ticket"]
    detail = "正在处理任务 #" + str(j["id"])
    lost.clear()
    folder = STATE / ("job-" + str(j["id"]))
    folder.mkdir(exist_ok=True)
    progress_file = folder / "sampler-progress.json"
    progress_file.unlink(missing_ok=True)
    mode = h3_pipeline_id(j)
    job_clock = JobClock(steps=sampling_steps(j), cold=last_mode != mode, recovered=(folder / "submission.json").exists() or (folder / "verified.json").exists())
    ensure_video_service()
    old = folder / "job.json"
    receipt = folder / "submission.json"
    if receipt.exists() and not (folder / "verified.json").exists():
        pid = json.loads(receipt.read_text())["prompt_id"]
        url = "http://127.0.0.1:" + ENV["H3_PORT"]
        with urllib.request.urlopen(url + "/history/" + pid, timeout=10) as response:
            history = json.load(response)
        with urllib.request.urlopen(url + "/queue", timeout=10) as response:
            queue = json.load(response)
        if pid not in history and not any(
            row[1] == pid for row in queue["queue_running"] + queue["queue_pending"]
        ):
            receipt.unlink()
    save(old, j)
    inputs = ENGINE / "state/inputs/fumiao" / folder.name
    inputs.mkdir(parents=True, exist_ok=True)
    from node_models import h3_reference_files
    for i, ref in enumerate(h3_reference_files(j)):
        key=ref['id']
        path = inputs / (str(i) + '.' + ref['suffix'])
        raw = api(f"/agent/jobs/{j['id']}/ref/{key}", method="GET", ticket_value=ticket)
        path.write_bytes(raw)
    if needs_render_verification(folder, j):
        measuring=resource_metrics('MiniMax H3',reset=True) is not None if not receipt.exists() else False
        log_path = ENGINE / "state/logs/comfy.log"
        progress_start = log_path.stat().st_size if log_path.exists() else 0
        with (folder / "render.log").open("ab") as log:
            p = subprocess.Popen(
                [str(CACHE / "venv/bin/python"), str(ROOT / "render.py"), str(folder)],
                env=ENV,
                stdout=log,
                stderr=log,
            )
            while p.poll() is None:
                progress = sampling_progress(log_path, progress_start)
                job_clock.observe_sampling(progress.get("step"), progress.get("steps"))
                if lost.wait(1) or stopped.is_set():
                    stop_render(p, folder)
                    return
            if p.returncode:
                failure = folder / "failure.json"
                if failure.exists() and json.loads(failure.read_text()).get("code") == "invalid_video":
                    raise RuntimeError("生成画面异常：首帧退化为灰色噪点，请重新生成。")
                raise RuntimeError("生成未成功，请检查实例中该任务的 render.log")
        if measuring:
            measured=resource_metrics('MiniMax H3')
            if measured:job_clock.record_resources(measured)
    report = json.loads((folder / "verified.json").read_text())
    job_clock.finish_render(cached=report.get("sampler_cached", False))
    path = Path(report["path"])
    detail = "正在回传并校验成片"
    raw = path.read_bytes()
    job_clock.begin_upload()
    try:
        beat()
    except (TimeoutError, OSError):
        pass
    while not lost.is_set() and not stopped.is_set():
        try:
            api(
                f"/agent/jobs/{j['id']}/result",
                method="PUT",
                ticket_value=ticket,
                raw=raw,
                digest=report["sha256"],
                timing_report=job_clock.snapshot()[1] | ({"h3_input_fingerprint":report["h3_input_fingerprint"]} if report.get("h3_input_fingerprint") else {}),
            )
            (folder / "delivered").touch()
            last_mode = mode
            cleanup(folder)
            return
        except urllib.error.HTTPError as e:
            if e.code == 409:
                return
            if e.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(
                    f"服务器拒绝成片，HTTP {e.code}，请检查媒体校验"
                ) from e
        except (TimeoutError, OSError):
            pass
        time.sleep(5)


def recover_deliveries():
    for folder in STATE.glob("job-*"):
        try:
            if (folder / "delivered").exists():
                cleanup(folder)
            elif (folder / "verified.json").exists() and (folder / "job.json").exists():
                j = json.loads((folder / "job.json").read_text())
                response = api(
                    f"/agent/jobs/{j['id']}/receipt",
                    method="GET",
                    ticket_value=j["ticket"],
                )
                if json.loads(response)["delivered"]:
                    (folder / "delivered").touch()
                    cleanup(folder)
        except (OSError, ValueError):
            continue


def configure_execution(value,planned):
    global execution
    execution=value
    if value.get('mode')=='parallel':
        video=value['lanes']['MiniMax H3'];speech=value['lanes']['breeze-tts-2']
        ENV['H3_VRAM_BUDGET_GIB']=str(video['gpu_budget_gib'])
        ENV['H3_RESERVE_VRAM_GIB']=str(video['gpu_total_gib']-video['gpu_budget_gib'])
        os.environ['BREEZE_VRAM_BUDGET_GIB']=str(speech['gpu_budget_gib'])
        ENV['BREEZE_VRAM_BUDGET_GIB']=str(speech['gpu_budget_gib'])
        ENV['FUMIAO_CPU_THREADS']=str(max(1,planned.get('hardware',{}).get('cpu_cores',8)-4))
        index=video['device'];backend=video['backend']
    else:
        ENV.pop('H3_VRAM_BUDGET_GIB',None);ENV.pop('H3_RESERVE_VRAM_GIB',None);ENV.pop('BREEZE_VRAM_BUDGET_GIB',None)
        os.environ.pop('BREEZE_VRAM_BUDGET_GIB',None)
        index=planned.get('plan',{}).get('device',{}).get('index',0);backend=planned.get('plan',{}).get('device',{}).get('backend','cuda')
    visible=os.environ.get('ROCR_VISIBLE_DEVICES') or os.environ.get('HIP_VISIBLE_DEVICES') or os.environ.get('CUDA_VISIBLE_DEVICES','') if backend=='rocm' else os.environ.get('CUDA_VISIBLE_DEVICES','')
    mask=visible.split(',') if visible else []
    ENV['CUDA_VISIBLE_DEVICES']=mask[index] if len(mask)>index else str(index)
    if backend=='rocm':
        ENV['HIP_VISIBLE_DEVICES']=ENV['CUDA_VISIBLE_DEVICES']
        if os.getenv('ROCR_VISIBLE_DEVICES'):ENV['ROCR_VISIBLE_DEVICES']=ENV['CUDA_VISIBLE_DEVICES']


def model_profile(model,base):
    profile=dict(base or {})
    if execution.get('mode')=='parallel':
        lane=execution['lanes'][model]
        planned=json.loads((NODE_STATE/'hardware-plan.json').read_text())
        gpu=next(g for g in planned['hardware']['devices'] if g['index']==lane['device'])
        profile.update(gpu_name=gpu.get('name') or profile.get('gpu_name',''),vram_gib=gpu['vram_gib'],used_gpus=1,backend=gpu['backend'],memory_mode='parallel:allocator-'+str(lane['gpu_budget_gib'])+'GiB')
    return profile


def ensure_lane_service():
    if not LANE:return
    from resource_gate import valid_receipt
    lane=execution['lanes'][LANE]
    home=CACHE if LANE=='MiniMax H3' else Path(os.getenv('BREEZE_HOME','/opt/fumiao-breeze'))
    if valid_receipt(home/'memory-limit.json',lane['gpu_budget_gib']):return
    if LANE=='MiniMax H3':
        with (STATE/'service-recovery.log').open('ab') as log:
            subprocess.run([str(CACHE/'venv/bin/python'),str(ENGINE/'scripts/service.py'),'both'],env=ENV,stdout=log,stderr=log,check=True,timeout=180)
    else:adapters[LANE].ensure_service(lambda value:None,stopped.is_set,device_index)


def ensure_video_service():
    with (STATE/'service-recovery.log').open('ab') as log:
        subprocess.run([str(CACHE/'venv/bin/python'),str(ENGINE/'scripts/service.py'),'both'],env=ENV,stdout=log,stderr=log,check=True,timeout=180)


def release_video_for_audio():
    url='http://127.0.0.1:'+ENV['H3_PORT']
    try:
        with urllib.request.urlopen(url+'/queue',timeout=5) as response:queued=json.load(response)
        if queued.get('queue_running') or queued.get('queue_pending'):raise RuntimeError('视频任务仍在执行，暂不能切换到语音')
        request=urllib.request.Request(url+'/free',data=b'{"unload_models":true,"free_memory":true}',headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10):pass
    except urllib.error.URLError:
        return # Already stopped; the next video will restart its owned service.
    from resource_gate import memory_available
    for attempt in range(60):
        if stopped.is_set():raise RuntimeError('实例已停止')
        with urllib.request.urlopen(url+'/system_stats',timeout=5) as response:stats=json.load(response)
        gpu=stats['devices'][0];free=gpu['vram_free']-gpu['torch_vram_free'];ram=memory_available()
        if free>=14*2**30 and ram is not None and ram>=20*2**30:return
        if attempt>=5 and ram is not None and ram<20*2**30:
            from h3_service import stop_owned
            if stop_owned(ENGINE/'state/ComfyUI',ENGINE/'state/comfy-runtime.json',url):return
        stopped.wait(1)
    raise RuntimeError('视频模型尚未释放足够资源，请稍后重试')


def prepare_storage():
    from cache_manager import make_plan
    from runtime_cache import disk_reserve
    reserve=disk_reserve(selected_models,ROOT,(hardware_profile or {}).get('backend','cuda'),device_index)
    make_plan(selected_models,ROOT,installation.update,reserve)


def prepare():
    import importlib
    prepare_storage()
    for model in selected_models:
        spec=GPU_MODELS[model]
        if spec['adapter']=='h3':
            kernel_probe(os.environ.get('H3_PYTHON',sys.executable),device_index)
            prepare_h3();profile=model_profile(model,hardware_profile)
        else:
            adapter=importlib.import_module(spec['adapter']+'_adapter')
            device=execution.get('lanes',{}).get(model,{}).get('device',device_index)
            runtime=adapter.prepare(installation.update,stopped.is_set,device,sys.executable,(hardware_profile or {}).get('backend','cuda'))
            adapters[model]=adapter
            profile=model_profile(model,hardware_profile)
            profile.update(torch_version=runtime['torch'],runtime=runtime['runtime'],backend=runtime['backend'],precision='bf16',attention='eager',memory_mode=(profile.get('memory_mode','parallel') if execution.get('mode')=='parallel' else 'single-model')+':eager')
            if execution.get('mode')!='parallel' and 'MiniMax H3' in installed_models:release_video_for_audio()
            adapter.ensure_service(installation.update,stopped.is_set,device)
        model_profiles[model]=profile
        if len(selected_models)==1 and hardware_profile is not None:hardware_profile.update(profile)
        installed_models.append(model)
        beat()


def resource_metrics(model,reset=False):
    port=ENV['H3_PORT'] if model=='MiniMax H3' else os.getenv('BREEZE_PORT','18389')
    url='http://127.0.0.1:'+str(port)+'/fumiao/resources'+('/reset' if reset else '')
    try:
        request=urllib.request.Request(url,data=b'{}' if reset else None,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=3) as response:return json.load(response)
    except (OSError,ValueError):return None


def execute_adapter(j,adapter):
    global phase,detail,ticket,job_clock,last_mode
    phase='busy';ticket=j['ticket'];lost.clear()
    folder=STATE/('job-'+str(j['id']));folder.mkdir(exist_ok=True);save(folder/'job.json',j)
    recovered=(folder/'verified.json').exists()
    job_clock=JobClock(cold=not adapter.service_record(),recovered=recovered,steps=1)
    def stage(value):
        global detail
        if value=='generating':job_clock.observe_sampling(0,1);detail='正在生成语音'
        elif value=='finalizing':job_clock.finish_render();detail='正在保存语音'
        else:detail=value
    if not recovered:
        if 'MiniMax H3' in installed_models:release_video_for_audio()
        adapter.ensure_service(stage,lambda:lost.is_set() or stopped.is_set(),device_index)
        measuring=resource_metrics(j['model'],reset=True) is not None
        report=adapter.render(j,folder,lambda:lost.is_set() or stopped.is_set(),stage,device_index)
        if measuring:
            measured=resource_metrics(j['model'])
            if measured:job_clock.record_resources(measured)
        save(folder/'verified.json',report)
    else:report=json.loads((folder/'verified.json').read_text());job_clock.finish_render(cached=True)
    raw=Path(report['path']).read_bytes();detail='正在回传并校验成片';job_clock.begin_upload()
    while not lost.is_set() and not stopped.is_set():
        try:
            beat()
            api(f"/agent/jobs/{j['id']}/result",method='PUT',ticket_value=ticket,raw=raw,digest=report['sha256'],timing_report=job_clock.snapshot()[1] | ({"h3_input_fingerprint":report["h3_input_fingerprint"]} if report.get("h3_input_fingerprint") else {}),media_type=report['media_type'])
            (folder/'delivered').touch();last_mode=j['model'];cleanup(folder);return
        except urllib.error.HTTPError as e:
            if e.code==409:return
            if e.code not in (429,500,502,503,504):raise RuntimeError(f'语音回传被拒绝，HTTP {e.code}') from e
        except (TimeoutError,OSError):pass
        time.sleep(5)


def main():
    global phase, detail, ticket, installation, hardware, hardware_profile, selected_models, device_index,installed_models,model_profiles,can_accept
    STATE.mkdir(parents=True,exist_ok=True, mode=0o700)
    lock = (STATE / "lock").open("w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    granted=json.loads((NODE_STATE/'models.json').read_text()) if (NODE_STATE/'models.json').exists() else list(LEGACY_MODELS)
    if LANE and LANE not in granted:raise RuntimeError('执行通道不在实例授权中')
    selected_models=[LANE] if LANE else granted
    planned=json.loads((NODE_STATE/'hardware-plan.json').read_text()) if (NODE_STATE/'hardware-plan.json').exists() else {}
    device_index=planned.get('plan',{}).get('device',{}).get('index',0)
    configure_execution(planned.get('plan',{}).get('execution',{'mode':'serial','policy':'gpu-budget-v1'}),planned)
    if LANE:device_index=execution['lanes'][LANE]['device']
    installation = InstallProgress(
        STATE,
        ENGINE / "assets/models.lock.json" if "MiniMax H3" in selected_models else None,
        os.getenv("FUMIAO_INSTALL_RUN", "manual"),
    )
    try:
        probe = f"import torch,os,json; p=torch.cuda.get_device_properties({device_index}); print(json.dumps(dict(gpu_name=p.name,backend='rocm' if torch.version.hip else 'cuda',vram_gib=round(p.total_memory/1024**3,1),available_gpus=torch.cuda.device_count(),used_gpus=1,runtime=str(torch.version.hip or torch.version.cuda),torch_version=torch.__version__,cpu_cores=os.cpu_count() or 0,ram_gib=round(os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')/1024**3,1))))"
        hardware_profile = json.loads(subprocess.check_output([os.environ.get("H3_PYTHON",sys.executable),"-c",probe],text=True,timeout=30))
        if not hardware_profile['gpu_name'] and hardware_profile['backend'] == 'rocm':
            try:
                products = json.loads(subprocess.check_output(['rocm-smi','--showproductname','--json'],text=True,timeout=10))
                cards = [v for v in products.values() if isinstance(v,dict) and 'Card Model' in v]
                if len(cards) == 1:
                    product = cards[0]
                    hardware_profile['gpu_name'] = 'AMD ' + ' '.join(str(product[k]) for k in ('Card Model','Card SKU','GFX Version') if product.get(k) and product[k] != 'N/A')
            except (OSError,ValueError,subprocess.SubprocessError):
                pass
        if planned:
            hardware_profile['ram_gib']=planned['hardware']['ram_gib']
            hardware_profile['cpu_cores']=planned['hardware']['cpu_cores']
        hardware_profile.update(precision="weights-bf16/vae-fp16:auto",attention="pytorch",memory_mode="comfy-default:reserve-8GiB")
        try:
            if hardware_profile['backend'] == 'cuda':
                hardware_profile['driver'] = subprocess.check_output(['nvidia-smi','--query-gpu=driver_version','--format=csv,noheader'],text=True,timeout=5).splitlines()[0].strip()[:120]
            else:
                driver_file = Path('/sys/module/amdgpu/version')
                hardware_profile['driver'] = (driver_file.read_text().strip() if driver_file.is_file() else 'kernel:'+os.uname().release)[:120]
        except (OSError,subprocess.SubprocessError,IndexError):
            hardware_profile['driver'] = ''

        hardware = hardware_profile["gpu_name"][:180]
    except (OSError,ValueError,subprocess.SubprocessError):
        hardware = ""
        hardware_profile = None
    if hardware_profile is None and planned:
        gpu=planned['plan']['device'];facts=planned['hardware']
        hardware_profile=dict(gpu_name=gpu['name'],backend=gpu['backend'],vram_gib=gpu['vram_gib'],available_gpus=len(facts['devices']),used_gpus=1,cpu_cores=facts['cpu_cores'],ram_gib=facts['ram_gib'])
        hardware=gpu['name'][:180]
    threading.Thread(target=ticker, daemon=True).start()
    try:
        if LANE:
            from concurrent_node import boot
            prepared=json.loads((NODE_STATE/'prepared-models.json').read_text())
            if prepared['boot']!=boot() or prepared['runtime_id']!=os.getenv('FUMIAO_PARENT_RUN') or LANE not in prepared['models']:raise RuntimeError('并发准备记录失效，请重新运行接入命令')
            hardware_profile=prepared['profiles'][LANE];model_profiles={LANE:hardware_profile};installed_models=[LANE]
            if GPU_MODELS[LANE]['adapter']!='h3':
                import importlib
                adapters[LANE]=importlib.import_module(GPU_MODELS[LANE]['adapter']+'_adapter')
            phase='ready';beat()
            if server_protocol<2 or server_execution!='parallel':raise RuntimeError('服务器并发通道未就绪')
            save(STATE/'lane-ready.json',{'pid':os.getpid(),'runtime_id':runtime_id})
        else:
            beat()
            if server_protocol<2 and execution.get('mode')=='parallel':configure_execution({'mode':'serial','policy':'gpu-budget-v1'},planned)
            prepare()
            if execution.get('mode')=='parallel':
                from concurrent_node import serve
                phase='ready';serve(sys.modules[__name__]);return
        recover_deliveries()
        installation.update('安装完成，生成服务已就绪','ready')
        while not stopped.is_set():
            phase = "ready"
            detail = "就绪"
            ticket = ""
            try:
                can_accept=True
                if LANE:
                    ensure_lane_service()
                    from resource_gate import check
                    can_accept,detail=check(LANE,execution,ROOT)
                beat()
                j = api("/agent/claim")["job"]
                if j:
                    try:
                        execute(j)
                    except (urllib.error.URLError, TimeoutError, ConnectionError):
                        # Preserve local receipts. The same instance can reclaim the live ticket.
                        time.sleep(5)
                    except Exception as e:
                        print(type(e).__name__, str(e)[:180], flush=True)
                        if not lost.is_set():
                            api(
                                f"/agent/jobs/{j['id']}/error",
                                {"stage": "error", "detail": str(e)[:180]},
                                ticket_value=j["ticket"],
                            )
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    break
            except (TimeoutError, OSError):
                pass
            stopped.wait(2)
    except Exception as e:
        preparing = phase == "preparing"
        phase = "error"
        if preparing:
            detail = f"安装失败。最后进度：{installation.message}。请查看 worker.log"[
                :250
            ]
            installation.update(detail, "error")
        else:
            detail = str(e)[:200]
        print(str(e), flush=True)
        print(detail, flush=True)
        try:
            beat()
        except OSError:
            pass
        raise
    finally:
        stopped.set()
        for adapter in adapters.values():adapter.stop_service()


if __name__ == "__main__":
    os.umask(0o077)
    if "--enroll" in sys.argv:
        enroll(sys.stdin.readline().strip())
    else:
        main()
