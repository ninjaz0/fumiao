import hmac
import shlex
import json
import re
import subprocess
import uuid
from fractions import Fraction
from typing import Literal
import timing
import model_policy
import gpu_lanes
import worker_pool
from node_models import GPU_MODELS, LEGACY_MODELS, model_list, ready_models, can_run_job
from core import dispatch_paused

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from core import (
    LEASE,
    RESERVE,
    SITE,
    actor,
    admin,
    db,
    fail,
    hashed,
    now,
    reap,
    receive,
    store,
    token,
)
import hashlib

router = APIRouter()


class Pair(BaseModel):
    name: str = Field(default="", max_length=45)
    models: list[str] = Field(default_factory=lambda:list(LEGACY_MODELS),max_length=20)


def next_node_number(con):
    saved = con.execute("SELECT value FROM settings WHERE key='node_name_sequence'").fetchone()
    largest = int(saved[0]) if saved else 0
    for row in con.execute("SELECT label FROM pairs UNION SELECT name FROM nodes"):
        match = re.fullmatch(r"弗淼([0-9]{1,9})", row[0] or "")
        if match:
            largest = max(largest, int(match[1]))
    return largest + 1


@router.get("/api/pairs/default-name")
def default_name(request: Request):
    actor(request)
    with db() as con:
        return {"name": f"弗淼{next_node_number(con):03d}"}


@router.post("/api/pairs")
def pair(body: Pair, request: Request):
    u = actor(request)
    try:selected=model_list(body.models)
    except ValueError as exc:fail(400,str(exc))
    code = token()
    with db(True) as con:
        number = next_node_number(con)
        label = body.name.strip() or f"弗淼{number:03d}"
        numbered = re.fullmatch(r"弗淼([0-9]{1,9})", label)
        if numbered:
            if con.execute("SELECT 1 FROM pairs WHERE label=? UNION SELECT 1 FROM nodes WHERE name=?", (label, label)).fetchone():
                fail(409, "实例名称已使用，请更换名称")
            con.execute(
                "INSERT INTO settings VALUES('node_name_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(max(number - 1, int(numbered[1]))),),
            )
        con.execute(
            "INSERT INTO pairs(key,owner,label,deadline,expires,models) VALUES(?,?,?,?,?,?)",
            (
                hashed(code),
                u["id"],
                label,
                None,
                now() + 1800,
                json.dumps(selected),
            ),
        )
    return {
        "command": f"curl -fsSL {shlex.quote(SITE + '/connect/install.sh')} -o /tmp/fumiao-install.sh && FUMIAO_SITE={shlex.quote(SITE)} bash /tmp/fumiao-install.sh --models={','.join(GPU_MODELS[m]['slug'] for m in selected)} {code}",
        "expires": now() + 1800,
        "name": label,
        "models": selected,
    }


class Enroll(BaseModel):
    code: str = Field(min_length=30, max_length=128)
    secret: str = Field(min_length=40, max_length=128)


@router.post("/agent/enroll")
def enroll(b: Enroll):
    key = hashed(b.secret)
    with db(True) as con:
        p = con.execute(
            "SELECT p.* FROM pairs p JOIN users u ON u.id=p.owner WHERE p.key=? AND u.active=1",
            (hashed(b.code),),
        ).fetchone()
        if not p:
            fail(403, "配对码已过期或无效")
        if p["claimed"]:
            if not hmac.compare_digest(p["claimed"], key):
                fail(403, "配对码已使用")
            if not con.execute("SELECT 1 FROM nodes WHERE key=? AND control!='removed'",(key,)).fetchone():fail(403,'实例接入已撤销，请获取新的接入命令')
            return {"ok": True,"models":json.loads(p['models'])}
        if p['expires']<=now():fail(403,'配对码已过期或无效')
        con.execute(
            "INSERT INTO nodes(owner,name,key,deadline,lastseen,stage,models,ready_models) VALUES(?,?,?,?,?,'preparing',?,'[]')",
            (p["owner"], p["label"], key, None, now(),p['models']),
        )
        con.execute("UPDATE pairs SET claimed=? WHERE id=?", (key, p["id"]))
    return {"ok": True,"models":json.loads(p['models'])}


def authenticate(con, request):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        fail(401, "缺少实例凭据")
    node = con.execute(
        "SELECT * FROM nodes WHERE key=? AND control!='removed'", (hashed(auth[7:]),)
    ).fetchone()
    if not node:
        fail(403, "实例凭据已撤销")
    return node


@router.get('/agent/registration')
def registration(request: Request):
    with db() as con:
        node=authenticate(con,request)
        pair=con.execute('SELECT key FROM pairs WHERE claimed=? ORDER BY id DESC LIMIT 1',(node['key'],)).fetchone()
        return {'id':node['id'],'models':json.loads(node['models']),'paired_code_hash':pair['key'] if pair else None,'control':node['control']}


class HardwareProfile(BaseModel):
    gpu_name: str = Field(max_length=120)
    backend: Literal["rocm", "cuda", "cpu", "other"]
    vram_gib: float = Field(ge=0, le=2048, allow_inf_nan=False)
    available_gpus: int = Field(ge=0, le=128)
    used_gpus: int = Field(ge=1, le=128)
    runtime: str = Field(default="", max_length=80)
    driver: str = Field(default="", max_length=120)
    torch_version: str = Field(default="", max_length=80)
    precision: str = Field(default="", max_length=80)
    attention: str = Field(default="", max_length=80)
    memory_mode: str = Field(default="", max_length=80)
    cpu_cores: int = Field(default=0, ge=0, le=4096)
    ram_gib: float = Field(default=0, ge=0, le=65536, allow_inf_nan=False)


class TimingReport(BaseModel):
    h3_input_fingerprint: str | None = Field(default=None,pattern=r'^[a-f0-9]{64}$')
    sampling_steps: int | None = Field(default=None,ge=1,le=100)
    fast_mode: bool | None = None
    peak_vram_bytes: int | None = Field(default=None,ge=0,le=2**50)
    peak_allocated_vram_bytes: int | None = Field(default=None,ge=0,le=2**50)
    prepare_s: float | None = Field(default=None, ge=0, le=172800, allow_inf_nan=False)
    generate_s: float | None = Field(default=None, ge=0, le=172800, allow_inf_nan=False)
    finalize_s: float | None = Field(default=None, ge=0, le=172800, allow_inf_nan=False)
    cold: bool | None = None
    recovered: bool = False


class Beat(BaseModel):
    lane_model: str | None = Field(default=None,max_length=80)
    can_accept: bool = True
    execution_plan: dict | None = None
    stage: str = Field(max_length=20)
    detail: str = Field(default="", max_length=300)
    ticket: str = Field(default="", max_length=128)
    step: int | None = Field(default=None, ge=0, le=100)
    steps: int | None = Field(default=None, ge=1, le=100)
    uploading: bool = False
    hardware: str = Field(default="", max_length=180)
    workflow: str = Field(default="", max_length=80)
    runtime_id: str = Field(default="", max_length=96)
    job_phase: Literal["preparing", "generating", "finalizing", "uploading"] | None = None
    timing: TimingReport | None = None
    profile: HardwareProfile | None = None
    ready_models: list[str] | None = Field(default=None,max_length=20)
    model_profiles: dict[str,HardwareProfile] | None = None
    video_steps: list[Literal[4,16,20,32,50]] | None = Field(default=None,min_length=1,max_length=5)


@router.post("/agent/heartbeat")
def heartbeat(b: Beat, request: Request):
    if b.stage not in ("preparing", "ready", "busy", "error"):
        fail(400, "状态无效")
    with db(True) as con:
        node = authenticate(con, request)
        selected=json.loads(node['models'])
        if b.video_steps is not None:
            if 'MiniMax H3' not in selected:fail(400,'实例没有接入视频模型')
            if b.lane_model and b.lane_model!='MiniMax H3':fail(400,'通道不能修改视频能力')
            con.execute('UPDATE nodes SET video_steps=? WHERE id=?',(json.dumps(sorted(set(b.video_steps))),node['id']))
        elif not b.lane_model and 'MiniMax H3' in selected:
            con.execute("UPDATE nodes SET video_steps='[20]' WHERE id=?",(node['id'],))
        if not b.lane_model and b.runtime_id and b.runtime_id!=node['runtime_id']:
            # A new parent revalidates the deployment before starting its lanes.
            con.execute('DELETE FROM node_lanes WHERE node=?',(node['id'],))
        if b.execution_plan is not None:
            gpu_lanes.set_plan(con,node,b.execution_plan)
            node=con.execute('SELECT * FROM nodes WHERE id=?',(node['id'],)).fetchone()
        execution=gpu_lanes.read(node)
        if b.lane_model and (execution.get('mode')!='parallel' or b.lane_model not in execution.get('lanes',{})):fail(400,'实例没有这个并发执行通道')
        if b.ready_models is not None:
            if not set(b.ready_models)<=set(selected):fail(400,'实例没有接入这些模型')
            if not b.lane_model:con.execute('UPDATE nodes SET ready_models=? WHERE id=?',(json.dumps(list(dict.fromkeys(b.ready_models))),node['id']))
        elif not b.lane_model and b.stage=='ready' and selected==LEGACY_MODELS:
            # Old H3 agents predate model advertisements and report ready only
            # after their fixed H3 restore completes. They cannot claim TTS work.
            con.execute('UPDATE nodes SET ready_models=? WHERE id=?',(json.dumps(LEGACY_MODELS),node['id']))
        if b.model_profiles is not None:
            if not set(b.model_profiles)<=set(selected):fail(400,'模型运行环境与接入配置不符')
            profiles=json.loads(node['model_profiles']) if b.lane_model else {}
            if b.lane_model and set(b.model_profiles)!={b.lane_model}:fail(400,'并发通道只能上报自己的模型环境')
            profiles.update({m:p.model_dump() for m,p in b.model_profiles.items()})
            con.execute('UPDATE nodes SET model_profiles=? WHERE id=?',(json.dumps(profiles),node['id']))
        con.execute(
            "UPDATE nodes SET lastseen=?,stage=?,detail=? WHERE id=?",
            (now(), b.stage, b.detail, node["id"]),
        )
        if not b.lane_model and (b.hardware or b.workflow or b.runtime_id):
            con.execute("UPDATE nodes SET hardware=CASE WHEN ?='' THEN hardware ELSE ? END,workflow=CASE WHEN ?='' THEN workflow ELSE ? END,runtime_id=CASE WHEN ?='' THEN runtime_id ELSE ? END WHERE id=?", (b.hardware,b.hardware,b.workflow,b.workflow,b.runtime_id,b.runtime_id,node["id"]))
        if b.profile and not b.lane_model:
            profile = b.profile.model_dump()
            con.execute("UPDATE nodes SET profile=?,hardware=? WHERE id=?", (json.dumps(profile),timing.hardware_signature(profile),node["id"]))
        held = False
        if b.ticket:
            note = "正在回传并校验成片" if b.uploading else ""
            if not b.uploading and b.step is not None and b.steps and b.step <= b.steps:
                note = f"采样 {b.step} / {b.steps} 步"
            current=con.execute('SELECT * FROM jobs WHERE node=? AND ticket=?',(node['id'],b.ticket)).fetchone()
            if current and (not b.lane_model or current['model']==b.lane_model):
                resumable=current['status']=='queued' and node['control']=='active' and gpu_lanes.slot_free(con,node,current['model'])
                held=current['status']=='running' or resumable
                if held:con.execute("UPDATE jobs SET lease=?,status='running',note=? WHERE id=?",(now()+LEASE,note,current['id']))
            if held:
                job = dict(con.execute("SELECT * FROM jobs WHERE node=? AND ticket=?", (node["id"],b.ticket)).fetchone())
                timing.observe(con, job, b.model_dump(exclude_none=True))
        if b.lane_model:
            lane_stage=b.stage if b.ready_models is None or b.lane_model in b.ready_models else 'preparing'
            con.execute("""INSERT INTO node_lanes(node,model,stage,detail,lastseen,runtime_id,can_accept,profile) VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(node,model) DO UPDATE SET stage=excluded.stage,detail=excluded.detail,lastseen=excluded.lastseen,
              runtime_id=excluded.runtime_id,can_accept=excluded.can_accept,profile=excluded.profile""",
              (node['id'],b.lane_model,lane_stage,b.detail,now(),b.runtime_id,int(b.can_accept),json.dumps(b.profile.model_dump() if b.profile else {})))
        if execution.get('mode')=='parallel':gpu_lanes.summarize(con,node,now())
    return {"control": node["control"], "held": held,"protocol":2,"execution_mode":execution.get('mode','serial')}


def payload(j):
    return {
        k: j[k]
        for k in (
            "id",
            "ticket",
            "prompt",
            "seed",
            "width",
            "height",
            "seconds",
            "sampling_steps",
            "quality",
            "attempts",
        )
    } | {"refs": json.loads(j["refs"]),"model":j['model'],"kind":j['kind'],"audio_settings":json.loads(j['audio_settings']),"h3_inputs":json.loads(j['h3_inputs'])}


@router.post("/agent/claim")
def claim(request: Request):
    with db(True) as con:
        n = authenticate(con, request)
        reap(con)
        execution=gpu_lanes.read(n);lane=request.headers.get('x-model-lane')
        if execution.get('mode')=='parallel':
            if not lane:return {'job':None,'protocol':2}
            if lane not in execution.get('lanes',{}):fail(400,'执行通道未授权')
            current=con.execute("SELECT * FROM jobs WHERE node=? AND model=? AND status='running'",(n['id'],lane)).fetchone()
            lane_row=con.execute('SELECT * FROM node_lanes WHERE node=? AND model=?',(n['id'],lane)).fetchone()
            fresh=bool(lane_row and lane_row['lastseen']>=now()-75 and lane_row['stage']=='ready' and lane_row['can_accept'])
            installed={lane} & set(ready_models(n))
        else:
            if lane:fail(409,'服务器当前只允许单通道执行')
            current=con.execute("SELECT * FROM jobs WHERE node=? AND status='running'",(n['id'],)).fetchone()
            fresh=n['stage']=='ready' and n['lastseen']>=now()-75
            installed=set(ready_models(n)) & set(json.loads(n['models']))
        if current:
            return {'job':payload(current) if can_run_job(n,current) else None,'protocol':2}
        if dispatch_paused() or not installed or n['control']!='active' or not fresh:return {'job':None,'protocol':2}
        for j in con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY id"):
            if j['model'] not in installed:continue
            if not can_run_job(n,j):continue
            if not worker_pool.can_claim(con,n,j):continue
            if not model_policy.enabled(con,j['model'],j['workspace']):continue
            con.execute(
                "UPDATE jobs SET status='running',attempts=attempts+1,node=?,ticket=?,lease=?,updated=?,note='' WHERE id=?",
                (n["id"], token(), now() + LEASE, now(), j["id"]),
            )
            current = con.execute(
                "SELECT * FROM jobs WHERE id=?", (j["id"],)
            ).fetchone()
            timing.start_run(con, current, n)
            worker_pool.assigned(con, n, current)
            if lane:
                con.execute("UPDATE node_lanes SET stage='busy' WHERE node=? AND model=?",(n['id'],lane))
                gpu_lanes.summarize(con,n,now())
            return {"job": payload(current)}
    return {"job": None}


def assignment(con, request, i, completed=False):
    n = authenticate(con, request)
    ticket = request.headers.get("x-job-ticket", "")
    j = con.execute(
        "SELECT * FROM jobs WHERE id=? AND node=? AND ticket=?", (i, n["id"], ticket)
    ).fetchone()
    lane=request.headers.get('x-model-lane')
    if j and lane and j['model']!=lane:fail(409,'任务不属于这个执行通道')
    if not j or j["status"] not in (("running", "done") if completed else ("running",)):
        fail(409, "该任务已由其他实例接管或已结束")
    return j


@router.get("/agent/jobs/{i}/receipt")
def receipt(i: int, request: Request):
    with db() as con:
        j = assignment(con, request, i, True)
        return {"delivered": j["status"] == "done"}


@router.get("/agent/jobs/{i}/ref/{key}")
def ref(i: int, key: str, request: Request):
    with db() as con:
        j = assignment(con, request, i)
        if key not in json.loads(j["refs"]):
            fail(403, "素材不属于本任务")
    return store.serve(key, "application/octet-stream")


@router.post("/agent/jobs/{i}/error")
def error(i: int, b: Beat, request: Request):
    with db(True) as con:
        j = assignment(con, request, i)
        timing.end_run(con, j, "failed")
        con.execute(
            "UPDATE jobs SET status='failed',note=?,updated=?,lease=NULL WHERE id=?",
            (b.detail[:220] or "生成失败", now(), j["id"]),
        )
    return {"ok": True}


def validate_video(path, j):
    opts = ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", "mov"]
    try:
        meta = json.loads(
            subprocess.check_output(
                [
                    "ffprobe",
                    *opts,
                    "-show_streams",
                    "-show_format",
                    "-of",
                    "json",
                    str(path),
                ],
                stderr=subprocess.DEVNULL,
                timeout=15,
            )
        )
        v = next(s for s in meta["streams"] if s["codec_type"] == "video")
        a = next(s for s in meta["streams"] if s["codec_type"] == "audio")
        rotations = [v.get("tags", {}).get("rotate", 0)]
        rotations.extend(item["rotation"] for item in v.get("side_data_list", []) if "rotation" in item)
        if any(float(angle) % 360 != 0 for angle in rotations):
            raise ValueError("Unexpected video rotation metadata")
        frames = {5: 124, 10: 243, 15: 362}[j["seconds"]]
        if (
            v["width"],
            v["height"],
            v["codec_name"],
            Fraction(v["avg_frame_rate"]),
            int(v["nb_frames"]),
            a["codec_name"],
            a["channels"],
            int(a["sample_rate"]),
        ) != (j["width"], j["height"], "h264", 24, frames, "aac", 2, 32000):
            raise ValueError()
        if abs(float(meta["format"]["duration"]) - frames / 24) > 0.16:
            raise ValueError()
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-xerror",
                *opts,
                "-threads",
                "2",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-map",
                "0:a:0",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            check=True,
            timeout=90,
        )
    except (ValueError, KeyError, StopIteration, subprocess.SubprocessError):
        fail(422, "成片未通过分辨率、音视频或完整解码校验")


@router.put("/agent/jobs/{i}/result")
async def finish(i: int, request: Request):
    with db() as con:
        j = assignment(con, request, i, True)
        if j["status"] == "done":
            return {"ok": True, "id": j["result"]}
    telemetry = None
    try:telemetry=TimingReport.model_validate_json(request.headers.get('x-job-timing','{}')).model_dump(exclude_none=True)
    except ValueError:pass
    if j['model']=='MiniMax H3':
        from node_models import h3_input_fingerprint
        expected=h3_input_fingerprint(dict(j))
        if expected and (telemetry or {}).get('h3_input_fingerprint')!=expected:fail(422,'成片参考模式与任务不一致，请更新实例后重试')
        observed=(telemetry or {}).get('sampling_steps')
        if (observed is None and j['sampling_steps']!=20) or (observed is not None and observed!=j['sampling_steps']):
            fail(422,'成片采样步数与任务不一致，请更新实例后重新生成')
        fast=(telemetry or {}).get('fast_mode')
        if (j['sampling_steps']==4 and fast is not True) or (fast is not None and fast!=(j['sampling_steps']==4)):
            fail(422,'成片快速模式与任务不一致，请更新实例后重新生成')
    with db(True) as con:
        timing.mark_phase(con, j, "uploading")
    tmp, size = await receive(request, RESERVE)
    try:
        digest = request.headers.get("x-sha256", "")
        with tmp.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if not hmac.compare_digest(actual, digest):
            fail(422, "成片摘要不符")
        with db(True) as con:
            timing.mark_phase(con, j, "validating")
        if j['kind']=='audio':
            from audio_api import validate_audio
            metadata=await run_in_threadpool(validate_audio,tmp)
        else:
            await run_in_threadpool(validate_video, tmp, j)
            metadata={'sampling_steps':j['sampling_steps'],'fast_mode':j['sampling_steps']==4}
            if (telemetry or {}).get('h3_input_fingerprint'):metadata['h3_input_fingerprint']=telemetry['h3_input_fingerprint']
        with db(True) as con:
            j = assignment(con, request, i, True)
            if j["status"] == "done":
                return {"ok": True, "id": j["result"]}
            key = uuid.uuid4().hex
            con.execute(
                "INSERT INTO media(id,kind,size,mime,w,h,owner) VALUES(?,?,?,?,?,?,?)",
                (key, "audio" if j['kind']=='audio' else "video", size, "audio/wav" if j['kind']=='audio' else "video/mp4", j["width"], j["height"], j["owner"]),
            )
            con.execute("UPDATE media SET workspace=? WHERE id=?",(j["workspace"],key))
            store.put(tmp, key)
            con.execute(
                "UPDATE jobs SET status='done',result=?,lease=NULL,note='',updated=?,output_metadata=? WHERE id=?",
                (key, now(), json.dumps(metadata),i),
            )
            timing.end_run(con, j, "done", telemetry=telemetry)
            worker_pool.settle_reward(con, i)
            reap(con)
        return {"ok": True, "id": key}
    finally:
        tmp.unlink(missing_ok=True)


@router.post("/api/nodes/{i}/{action}")
def manage(i: int, action: str, request: Request):
    admin(request)
    control = {
        "drain": "draining",
        "resume": "active",
        "stop": "paused",
        "remove": "removed",
    }.get(action)
    if not control:
        fail(400, "未知操作")
    with db(True) as con:
        if not con.execute(
            "UPDATE nodes SET control=? WHERE id=? AND control!='removed'", (control, i)
        ).rowcount:
            fail(404, "实例不存在")
        if action in ("stop", "remove"):
            for job in con.execute("SELECT * FROM jobs WHERE status='running' AND node=?", (i,)).fetchall():
                timing.end_run(con, job, "interrupted")
            con.execute(
                """UPDATE jobs SET status=CASE WHEN attempts<2 THEN 'queued' ELSE 'failed' END,
                note='管理员已断开实例',node=NULL,ticket=NULL,lease=NULL,updated=? WHERE status='running' AND node=?""",
                (now(), i),
            )
        reap(con)
    return {"ok": True}
