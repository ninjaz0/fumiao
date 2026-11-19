"""Server-side OpenAI images queue. Credentials never leave this process."""
import timing
import model_policy
import credits
from flow_catalog import MODELS as FLOW_MODELS
from workspace_access import active_workspace, require_resource
import base64
import binascii
import io
import json
import os
import re
import threading
import urllib.error
import urllib.request
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator
from core import dispatch_paused, DATA, RESERVE, SITE, actor, admin, capacity, db, fail, hashed, now, stage_dir, store

router = APIRouter()
MODELS = {
    "gpt-image-2.6-sunburst": "gpt-image-2.6",
}
SIZES = {
    "16:9": (1536, 864, 2048, 1152),
    "9:16": (864, 1536, 1152, 2048),
    "1:1": (1024, 1024, 2048, 2048),
    "4:3": (1152, 864, 2048, 1536),
    "3:4": (864, 1152, 1536, 2048),
    "21:9": (1792, 768, 2352, 1008),
}
DEFAULT_MODEL = "gpt-image-2.6-sunburst"
WAKE = threading.Event()
STOP = threading.Event()
MAX_IMAGE = 32 << 20


def api_key():
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        path = DATA / "openai.env"
        if path.is_file():
            for line in path.read_text().splitlines():
                if line.startswith("OPENAI_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip("\"'")
                    break
    return key if re.fullmatch(r"sk-[A-Za-z0-9_-]+", key) else ""


def configuration(con):
    row = con.execute("SELECT value FROM settings WHERE key='openai_images'").fetchone()
    value = json.loads(row[0]) if row else {}
    hidden=model_policy.hidden_models(con)
    return {
        "configured": bool(api_key()),
        "enabled": value.get("enabled", True),
        "default_model": DEFAULT_MODEL,
        "models": {key:label for key,label in (MODELS | {"muse-image":"Muse"} | {k:v["label"] for k,v in FLOW_MODELS.items() if v["kind"]=="image"}).items() if key not in hidden},
        "sizes": SIZES,
    }


class Settings(BaseModel):
    enabled: bool
    default_model: Literal["gpt-image-2.6-sunburst"]


@router.put("/api/settings/openai")
def settings(body: Settings, request: Request):
    admin(request)
    with db(True) as con:
        con.execute("INSERT INTO settings VALUES('openai_images',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (body.model_dump_json(),))
        flags=model_policy.read(con)['enabled']
        for model in ('gpt-image-2.6-sunburst','muse-image'):flags[model]=body.enabled
        model_policy.save(con,flags)
        result = configuration(con)
    WAKE.set()
    return result


class ProviderError(Exception):
    pass


def provider_call(endpoint, payload=None, files=None):
    key = api_key()
    if not key:
        raise ProviderError("图片生成尚未配置，请联系管理员")
    headers = {"Authorization": "Bearer " + key}
    body = None
    if files:
        boundary = "fumiao-" + uuid.uuid4().hex
        parts = []
        for name, value in payload.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        for i, (raw, mime) in enumerate(files):
            suffix = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
            parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-{i+1}.{suffix}"\r\nContent-Type: {mime}\r\n\r\n'.encode(), raw, b"\r\n"])
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    elif payload is not None:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request("https://api.openai.com/v1/" + endpoint, data=body, headers=headers)
    try:
        # Do not retry a generation: a timeout can still mean a billed request.
        with urllib.request.urlopen(req, timeout=600 if payload else 30) as res:
            raw = res.read(64 * 1024**2 + 1)
            if len(raw) > 64 * 1024**2:
                raise ProviderError("生成结果过大，未保存")
            return json.loads(raw), res.headers.get("x-request-id", "")
    except urllib.error.HTTPError as exc:
        try:
            error = json.loads(exc.read(65536)).get("error", {})
        except (ValueError, TypeError):
            error = {}
        code = str(error.get("code") or "")
        message = str(error.get("message") or "").lower()
        if code == "insufficient_quota":
            text = "OpenAI API 额度不足，请管理员检查额度"
        elif exc.code == 401:
            text = "OpenAI 密钥无效，请管理员检查配置"
        elif "verif" in message:
            text = "OpenAI 要求完成组织验证，请管理员在平台处理"
        elif code in ("content_policy_violation", "moderation_blocked", "image_generation_user_error") or "safety" in message:
            text = "这次请求未通过 OpenAI 内容审核，请调整提示词或参考图"
        elif exc.code == 429:
            text = "OpenAI 请求频率受限，请稍后重新生成"
        elif exc.code in (403, 404):
            text = "当前 OpenAI 项目没有该模型的调用权限"
        elif exc.code == 400:
            text = "OpenAI 未接受这次图片请求，请调整参数或参考图"
        else:
            text = "OpenAI 服务暂时不可用，请稍后重新生成"
        raise ProviderError(text) from None
    except (TimeoutError, urllib.error.URLError, ConnectionError, OSError):
        raise ProviderError("与 OpenAI 的连接中断，结果未确认；请检查平台记录后再重新生成") from None


@router.post("/api/settings/openai/check")
def check(request: Request):
    admin(request)
    with db() as con:
        config = configuration(con)
    try:
        provider_call("models/" + config["default_model"])
    except ProviderError as error:
        fail(502, str(error))
    return {"ok": True, "model": config["default_model"]}


from asset_packs import PackRef
import asset_packs


class ImageDraft(BaseModel):
    asset_packs: list[PackRef] = Field(default_factory=list, max_length=9)
    price_revision: int | None = Field(default=None,ge=1)
    uid: uuid.UUID
    prompt: str = Field(min_length=1, max_length=12000)
    refs: list[str] = Field(default_factory=list, max_length=9)
    ratio: str = "16:9"
    resolution: Literal["1K", "2K", "4K"] = "1K"
    image_quality: Literal["low", "medium", "high"] = "medium"
    model: str = Field(default=DEFAULT_MODEL, max_length=180)
    @field_validator('model')
    @classmethod
    def validate_model(cls, value):
        if value not in model_policy.MODELS or model_policy.MODELS[value]['kind'] != 'image':
            raise ValueError('未知image模型')
        return value

    parent: int | None = None


def _create_image_job(con, body: ImageDraft, user, workspace=None):
    workspace=active_workspace(con,user,workspace=workspace)
    if body.model in FLOW_MODELS:
        from flow_provider import create_job
        return create_job(con,body,user,'image',workspace)
    if body.model not in (DEFAULT_MODEL,'muse-image'):fail(400,'未知图片模型')
    if body.resolution not in ('1K','2K'):fail(400,'该模型不支持这个分辨率')
    if body.model=="muse-image":
        from muse_provider import create_job
        return create_job(con,body,user,"image",workspace)
    if not body.prompt.strip() or body.ratio not in SIZES or len(set(body.refs)) != len(body.refs):
        fail(400, "请检查提示词、画幅和参考图")
    idem = str(user["id"]) + "-image-" + str(body.uid)
    old = con.execute("SELECT id,workspace FROM jobs WHERE uid=?", (idem,)).fetchone()
    if old:
        require_resource(con,user,old,workspace)
        return {"id": old[0]}
    model_policy.require_enabled(con,body.model,workspace)
    config = configuration(con)
    if not config["configured"] or not config["enabled"]:
        fail(503, "图片生成尚未开启，请联系管理员")
    for key in body.refs:
        require_resource(con,user,con.execute("SELECT * FROM media WHERE id=? AND kind='ref'",(key,)).fetchone(),workspace)
    if body.parent:
        require_resource(con,user,con.execute("SELECT * FROM jobs WHERE id=? AND kind='image'",(body.parent,)).fetchone(),workspace)
    pending = con.execute("SELECT count(*),sum(owner=?) FROM jobs WHERE kind='image' AND model='gpt-image-2.6-sunburst' AND status IN ('queued','running')", (user["id"],)).fetchone()
    if pending[0] >= 20 or (pending[1] or 0) >= 3:
        fail(429, "待生成图片较多，请等待当前任务完成")
    capacity(con, RESERVE)
    offset = 0 if body.resolution == "1K" else 2
    w, h = SIZES[body.ratio][offset:offset+2]
    jid = con.execute("""INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,parent,status,created,updated,kind,model,image_quality)
        VALUES(?,?,?,?,?,?,0,0,?,?,?,'queued',?,?,'image',?,?)""", (
            idem, user["id"], body.prompt.strip(), json.dumps(body.refs), body.ratio, 1024 if offset == 0 else 2048,
            w, h, body.parent, now(), now(), body.model, body.image_quality,
        )).lastrowid
    con.execute("UPDATE jobs SET workspace=? WHERE id=?",(workspace,jid))
    credits.reserve(con,jid,body.price_revision)
    timing.save_submission_forecast(con, jid)
    return {"id": jid}


@router.post("/api/image-jobs")
def submit(body: ImageDraft, request: Request):
    user = actor(request)
    with db(True) as con:
        result = create_image_job(con, body, user, active_workspace(con,user,request))
    WAKE.set()
    return result


def run_one():
    if dispatch_paused():return False
    with db(True) as con:
        if not model_policy.enabled(con,DEFAULT_MODEL):return False
        config = configuration(con)
        if not config["enabled"] or not config["configured"]:
            return False
        for cancelled in con.execute("SELECT * FROM jobs WHERE kind='image' AND model='gpt-image-2.6-sunburst' AND status='queued' AND owner IN (SELECT id FROM users WHERE active=0)").fetchall():
            timing.end_run(con, cancelled, "cancelled")
        con.execute("UPDATE jobs SET status='cancelled',note='账户已停用',updated=? WHERE kind='image' AND model='gpt-image-2.6-sunburst' AND status='queued' AND owner IN (SELECT id FROM users WHERE active=0)", (now(),))
        row = con.execute("SELECT * FROM jobs WHERE kind='image' AND model='gpt-image-2.6-sunburst' AND status='queued' AND "+model_policy.allowed_sql()+" ORDER BY id LIMIT 1").fetchone()
        if not row:
            return False
        job = dict(row)
        con.execute("UPDATE jobs SET status='running',note='正在生成图片',updated=?,attempts=attempts+1 WHERE id=?", (now(), job["id"]))
        job = dict(con.execute("SELECT * FROM jobs WHERE id=?", (job["id"],)).fetchone())
        timing.start_run(con, job)
        references = [dict(con.execute("SELECT * FROM media WHERE id=?", (key,)).fetchone()) for key in json.loads(job["refs"])]
    key = None
    committed = False
    staged = stage_dir / (uuid.uuid4().hex + ".png")
    try:
        prompt = re.sub(r"<Picture (\d+)>", r"参考图片\1", job["prompt"])
        payload = {"model": job["model"], "prompt": prompt, "size": f'{job["width"]}x{job["height"]}',
                   "quality": job["image_quality"], "n": 1, "output_format": "png", "safety_identifier": hashed(SITE + ":" + str(job["owner"]))}
        files = [(store.read(ref["id"]), ref["mime"]) for ref in references]
        with db(True) as con:
            timing.mark_phase(con, job, "generating")
        result, request_id = provider_call("images/edits" if files else "images/generations", payload, files)
        with db(True) as con:
            timing.mark_phase(con, job, "finalizing")
        data = result.get("data", [])
        if len(data) != 1 or not isinstance(data[0].get("b64_json"), str):
            raise ProviderError("OpenAI 没有返回有效图片")
        raw = base64.b64decode(data[0]["b64_json"], validate=True)
        if len(raw) > MAX_IMAGE:
            raise ProviderError("生成图片超过 32 MB，未保存")
        with Image.open(io.BytesIO(raw)) as im:
            if im.format != "PNG" or im.width * im.height > 32_000_000:
                raise ProviderError("生成图片格式无效")
            width, height = im.size
            im.verify()
        # Force full decoding as well as PNG chunk validation.
        with Image.open(io.BytesIO(raw)) as im:
            im.load()
        staged.write_bytes(raw)
        key = uuid.uuid4().hex
        with db(True) as con:
            capacity(con, max(0, len(raw) - RESERVE))
            store.put(staged, key)
            con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner) VALUES(?,'ref',?,'image/png',?,?,?)", (key, len(raw), width, height, job["owner"]))
            con.execute("UPDATE media SET workspace=? WHERE id=?",(job["workspace"],key))
            con.execute("UPDATE jobs SET status='done',result=?,width=?,height=?,note='',updated=?,usage_json=?,provider_request=? WHERE id=? AND status='running'", (
                key, width, height, now(), json.dumps(result.get("usage", {})), request_id, job["id"],
            ))
            timing.end_run(con, job, "done")
        committed = True
    except Exception as error:
        message = str(error) if isinstance(error, ProviderError) else "图片处理失败，结果未保存；请检查平台记录后再重新生成"
        with db(True) as con:
            timing.end_run(con, job, "failed")
            con.execute("UPDATE jobs SET status='failed',note=?,updated=? WHERE id=? AND status='running'", (message, now(), job["id"]))
    finally:
        staged.unlink(missing_ok=True)
        if key and not committed:
            store.delete(key)
    return True


def run_queue():
    while not STOP.is_set():
        try:
            if run_one():
                continue
        except Exception:
            # DB/storage failures must not kill the queue or expose credentials.
            pass
        WAKE.wait(2)
        WAKE.clear()


@asynccontextmanager
async def lifespan(app):
    # A request may have been billed before a process stopped. Never replay it.
    with db(True) as con:
        for interrupted in con.execute("SELECT * FROM jobs WHERE kind='image' AND model='gpt-image-2.6-sunburst' AND status='running'").fetchall():
            timing.end_run(con, interrupted, "interrupted")
        con.execute("UPDATE jobs SET status='failed',note='服务重启，生成结果未确认；请检查 OpenAI 平台记录后再重新生成',updated=? WHERE kind='image' AND model='gpt-image-2.6-sunburst' AND status='running'", (now(),))
    import chat_runtime
    chat_runtime.recover()
    STOP.clear()
    thread = threading.Thread(target=run_queue, name="openai-images", daemon=True)
    thread.start()
    import muse_provider
    muse_thread=muse_provider.start()
    import flow_provider
    flow_thread=flow_provider.start()
    import storyboard_export
    export_thread=storyboard_export.start()
    try:
        yield
    finally:
        await chat_runtime.shutdown()
    STOP.set()
    WAKE.set()
    thread.join(timeout=1)
    muse_provider.stop(muse_thread)
    flow_provider.stop(flow_thread)
    storyboard_export.stop(export_thread)


def create_image_job(con, body: ImageDraft, user, workspace=None):
    workspace = active_workspace(con, user, workspace=workspace)
    draft = body
    if not draft.asset_packs:
        return _create_image_job(con, draft, user, workspace)
    prefix = '-flow-image' if draft.model in FLOW_MODELS else '-muse-image' if draft.model == 'muse-image' else '-image'
    old = con.execute('SELECT id,workspace FROM jobs WHERE uid=?',
                      (f"{user['id']}{prefix}-{draft.uid}",)).fetchone()
    if old:
        require_resource(con, user, old, workspace)
        return {'id': old['id']}
    draft, snapshots = asset_packs.expand(con, draft, user, workspace)
    result = _create_image_job(con, draft, user, workspace)
    asset_packs.freeze(con, result['id'], snapshots)
    return result
