import timing
import muse_provider
import flow_provider
from flow_catalog import MODELS as FLOW_MODELS
import model_policy
import credits
import invitations
import public_assets
import os
from pathlib import Path
import hmac
import json
import math
import re
import secrets
import shutil
import uuid
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool
from image_imports import import_reference, ImageImportError
from pydantic import BaseModel, Field, ConfigDict
from core import (
    DATA,
    QUOTA,
    RATIOS,
    RESERVE,
    ROOT,
    SITE,
    actor,
    admin,
    capacity,
    db,
    fail,
    hashed,
    now,
    password,
    protect_canvas_media,
    reap,
    receive,
    store,
    token,
    usage,
)
from worker_api import router
from worker_pool_api import router as worker_pool_router
from profiles import router as profiles_router, public_profile
from avatars import random_avatar, catalog
from image_api import router as images_router, configuration as image_configuration
from recharge import router as recharge_router, lifespan
from library_api import router as library_router, favorite_keys
from generation import Draft, create_video_job
from canvas_api import router as canvas_router
from asset_packs import router as asset_packs_router
from storyboard_export import router as storyboard_router
from workspace_api import router as workspace_router
from credits_api import router as credits_router
from audio_api import router as audio_router
from chat_api import router as chat_router
from h3_inputs import router as h3_inputs_router, H3Inputs, prepare as prepare_h3_inputs
from node_models import GPU_MODELS
from workspace_access import active_workspace, require_resource, visible_workspaces

STATIC_ROOT = Path(os.environ.get("FUMIAO_STATIC_DIR", str(ROOT / "static"))).resolve()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.include_router(router)
app.include_router(worker_pool_router)
app.include_router(profiles_router)
app.include_router(images_router)
app.include_router(library_router)
app.include_router(canvas_router)
app.include_router(asset_packs_router)
app.include_router(storyboard_router)
app.include_router(workspace_router)
app.include_router(credits_router)
app.include_router(recharge_router)
app.include_router(audio_router)
app.include_router(chat_router)
app.include_router(h3_inputs_router)


@app.middleware("http")
async def boundary(request, proceed):
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD") and origin and origin != SITE:
        return JSONResponse({"detail": "来源无效"}, 403)
    response = await proceed(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "private, no-store"
    if request.method in ("GET","HEAD") and response.status_code == 200 and public_assets.versioned(STATIC_ROOT, request.url.path, request.query_params.get("v")):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers["Cloudflare-CDN-Cache-Control"] = "public, max-age=86400"
    media_origin = getattr(store, "origin", "")
    response.headers["Content-Security-Policy"] = (
        f"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: {media_origin}; media-src 'self' blob: {media_origin}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    return response


class Login(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)
    code: str = Field(default="", max_length=128)


class Registration(Login):
    nickname: str = Field(min_length=1,max_length=40)


def sign_in(con, uid):
    value = token()
    con.execute("DELETE FROM sessions WHERE expires<?", (now(),))
    con.execute(
        "INSERT INTO sessions VALUES(?,?,?)", (hashed(value), uid, now() + 30 * 86400)
    )
    res = JSONResponse({"ok": True})
    res.set_cookie(
        "fm_session",
        value,
        max_age=30 * 86400,
        httponly=True,
        secure=SITE.startswith("https:"),
        samesite="strict",
    )
    return res


@app.post("/api/login")
def login(body: Login, request: Request):
    peer = request.client.host if request.client else "local"
    key = hashed(peer)
    with db(True) as con:
        con.execute("DELETE FROM tries WHERE until<=?", (now(),))
        con.execute(
            "INSERT INTO tries VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
            (key, now() + 600),
        )
        if (
            con.execute("SELECT count FROM tries WHERE key=?", (key,)).fetchone()[0]
            > 35
        ):
            fail(429, "尝试过于频繁，请稍后再试")
        u = con.execute(
            "SELECT * FROM users WHERE name=? AND active=1", (body.name.strip(),)
        ).fetchone()
    if not u or not hmac.compare_digest(password(body.password, u["salt"]), u["pw"]):
        fail(401, "用户名或密码有误")
    with db(True) as con:
        current = con.execute(
            "SELECT pw,active FROM users WHERE id=?", (u["id"],)
        ).fetchone()
        if (
            not current
            or not current["active"]
            or not hmac.compare_digest(current["pw"], u["pw"])
        ):
            fail(401, "用户名或密码有误")
        con.execute("DELETE FROM tries WHERE key=?", (key,))
        return sign_in(con, u["id"])


def registration_attempt(request):
    # Commit attempts independently so failed registrations cannot roll the limiter back.
    peer = request.client.host if request.client else "local"
    key = hashed('register:' + peer)
    with db(True) as con:
        con.execute("DELETE FROM tries WHERE until<=?", (now(),))
        con.execute("INSERT INTO tries VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1", (key, now()+600))
        count = con.execute("SELECT count FROM tries WHERE key=?", (key,)).fetchone()[0]
    if count > 35:
        fail(429, "尝试过于频繁，请 10 分钟后重试")


@app.post("/api/register")
def register(body: Registration, request: Request):
    registration_attempt(request)
    name = body.name.strip()
    nickname = body.nickname.strip()
    if not nickname or any(ord(c)<32 for c in nickname): fail(400, '请填写昵称')
    if len(body.password) < 10 or not re.fullmatch(r"[\w.\-\u4e00-\u9fff]{2,32}", name):
        fail(400, "用户名需 2–32 个中英文、数字或下划线等字符；密码至少 10 位")
    with db(True) as con:
        inv = con.execute("SELECT * FROM registration_codes WHERE code=? AND enabled=1 AND (expires IS NULL OR expires>?)", (invitations.normalize(body.code), now())).fetchone()
        if not inv:
            fail(403, "邀请码无效、已过期或已停用，请向管理员获取有效邀请码")
        if inv['role'] == 'admin' and (inv['uses'] or con.execute("SELECT 1 FROM users WHERE role='admin'").fetchone()):
            fail(403, '管理员初始化邀请码已失效')
        if inv['team_id'] is not None: invitations.validate_teams(con, [inv['team_id']])
        if con.execute("SELECT 1 FROM users WHERE name=?", (name,)).fetchone():
            fail(409, "用户名已被使用")
        salt = secrets.token_hex(16)
        uid = con.execute("INSERT INTO users(name,nickname,salt,pw,role,avatar) VALUES(?,?,?,?,?,?)", (name, nickname, salt, password(body.password,salt), inv['role'], random_avatar())).lastrowid
        if inv['team_id'] is not None:
            con.execute('INSERT INTO workspace_members(workspace,user) VALUES(?,?)', (inv['team_id'],uid))
            con.execute('UPDATE users SET default_workspace=? WHERE id=?', (inv['team_id'],uid))
        amount = inv['initial_credits'] if inv['grant_credits'] else 0
        if amount:
            personal = con.execute("SELECT id FROM workspaces WHERE kind='personal' AND owner=?", (uid,)).fetchone()[0]
            credits.adjust(con, personal, amount, '注册赠送 · '+inv['name'], 'registration:'+str(uid), inv['created_by'])
        con.execute('INSERT INTO registration_redemptions(user,invitation,credits,team_id,created) VALUES(?,?,?,?,?)', (uid,inv['id'],amount,inv['team_id'],now()))
        con.execute("UPDATE registration_codes SET uses=uses+1,enabled=CASE WHEN role='admin' THEN 0 ELSE enabled END WHERE id=?", (inv['id'],))
        return sign_in(con, uid)


@app.post("/api/logout")
def logout(request: Request):
    with db(True) as con:
        con.execute(
            "DELETE FROM sessions WHERE key=?",
            (hashed(request.cookies.get("fm_session", "")),),
        )
    res = JSONResponse({"ok": True})
    res.delete_cookie("fm_session")
    return res


class InviteOptions(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=40)
    expires: int | None = Field(default=None, ge=1, le=253402300799, strict=True)
    grant_credits: bool = Field(default=False, strict=True)
    initial_credits: int = Field(default=0, ge=0, le=1000000000, strict=True)
    team_id: int | None = Field(default=None, ge=1, strict=True)


class InviteUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = Field(default=None, min_length=1, max_length=40)
    expires: int | None = Field(default=None, ge=1, le=253402300799, strict=True)
    grant_credits: bool | None = Field(default=None, strict=True)
    initial_credits: int | None = Field(default=None, ge=0, le=1000000000, strict=True)
    team_id: int | None = Field(default=None, ge=1, strict=True)
    enabled: bool | None = Field(default=None, strict=True)
    expected_revision: int = Field(ge=1, strict=True)


@app.get('/api/invite-codes')
def invite_codes(request: Request):
    admin(request)
    with db() as con: return {'items': invitations.listing(con)}


@app.post('/api/invite-codes')
def create_invite_code(request: Request, body: InviteOptions):
    user = admin(request)
    with db(True) as con:
        values = invitations.validate_options(con, body.model_dump())
        code = invitations.generate_code()
        while con.execute('SELECT 1 FROM registration_codes WHERE code=?', (code,)).fetchone(): code = invitations.generate_code()
        i = con.execute('INSERT INTO registration_codes(code,name,expires,grant_credits,initial_credits,team_id,created_by) VALUES(?,?,?,?,?,?,?)', (code,values['name'],values['expires'],values['grant_credits'],values['initial_credits'],values['team_id'],user['id'])).lastrowid
        return invitations.public(con.execute('SELECT * FROM registration_codes WHERE id=?', (i,)).fetchone())


@app.patch('/api/invite-codes/{i}')
def update_invite_code(i: int, request: Request, body: InviteUpdate):
    admin(request)
    with db(True) as con:
        row = con.execute("SELECT * FROM registration_codes WHERE id=? AND role='member'", (i,)).fetchone()
        if not row: fail(404, '邀请码不存在')
        if row['revision'] != body.expected_revision: fail(409, '邀请码已被修改，请关闭后重新打开')
        changes = body.model_dump(exclude_unset=True)
        changes.pop('expected_revision')
        if any(changes.get(k, 0) is None for k in ('name','grant_credits','initial_credits','enabled')): fail(400, '设置值不能为空')
        values = dict(row) | changes
        # Pausing an expired code must remain possible; editing its policy requires a future expiry.
        if set(changes) - {'enabled'}:
            invitations.validate_options(con, values)
        elif changes.get('enabled') and row['expires'] is not None and row['expires'] <= now():
            fail(400, '邀请码已过期，请先编辑有效期')
        con.execute('UPDATE registration_codes SET name=?,expires=?,grant_credits=?,initial_credits=?,team_id=?,enabled=?,revision=revision+1 WHERE id=?', (values['name'],values['expires'],values['grant_credits'],values['initial_credits'],values['team_id'],values['enabled'],i))
        return invitations.public(con.execute('SELECT * FROM registration_codes WHERE id=?', (i,)).fetchone())


@app.post('/api/invites')
@app.post('/api/invites/{i}/revoke')
def retired_invites(request: Request, i: int | None = None):
    admin(request)
    fail(410, '邀请链接已停用，请前往设置中的邀请码管理')


@app.post("/api/users/{i}/disable")
def disable(i: int, request: Request):
    admin(request)
    with db(True) as con:
        con.execute("UPDATE users SET active=0 WHERE id=? AND role='member'", (i,))
        con.execute(
            "DELETE FROM sessions WHERE user=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=0)",
            (i, i),
        )
    return {"ok": True}


@app.get("/api/state")
def state(request: Request):
    u = actor(request)
    with db(True) as con:
        reap(con)
        workspace=active_workspace(con,u,request)
        spaces=visible_workspaces(con,u)
        used, reserved = usage(con)
        nodes = [
            dict(x)
            for x in con.execute(
                "SELECT n.id,n.name,n.stage,n.lastseen,n.control,n.detail,n.owner,n.models,n.ready_models,n.profile,COALESCE(NULLIF(u.nickname,''),u.name) AS contributor FROM nodes n JOIN users u ON u.id=n.owner WHERE n.control!='removed' ORDER BY n.id DESC"
            )
        ]
        for n in nodes:
            for key in ('models','ready_models','profile'):n[key]=json.loads(n[key])
            if now() - n["lastseen"] > 75:
                n["stage"] = "offline"
            if u["role"] != "admin" and n["owner"] != u["id"]:
                n.pop("detail", None)
        jobs = [
            dict(x)
            for x in con.execute(
                """SELECT j.id,j.workspace,j.output_metadata,j.audio_settings,j.h3_inputs,j.owner,COALESCE(NULLIF(u.nickname,''),u.name) AS author,j.prompt,j.refs,j.ratio,j.quality,j.seconds,j.sampling_steps,j.seed,j.width,j.height,j.parent,j.status,j.created,j.result,j.note,j.node,j.kind,j.model,j.image_quality,j.updated,j.attempts FROM jobs j JOIN users u ON j.owner=u.id ORDER BY j.id DESC"""
            )
        ]
        for j in jobs:
            j["refs"] = json.loads(j["refs"])
            j["actual"] = json.loads(j.pop("output_metadata"))
            j['audio_settings']=json.loads(j['audio_settings'])
            j['h3_inputs']=json.loads(j['h3_inputs'])
        pending = {"video": 0, "image": 0, "muse": 0,"audio":0,"flow":0}
        for j in reversed(jobs):
            if j["status"] == "queued":
                if not model_policy.enabled(con,j["model"],j['workspace']):
                    j["ahead"]=0; j["note"]="等待模型开放"; continue
                lane = "flow" if j["model"] in FLOW_MODELS else "muse" if j["model"] in muse_provider.MODELS else j["kind"]
                j["ahead"] = pending[lane]
                pending[lane] += 1
        server_time = timing.attach(con, jobs)
        jobs=[j for j in jobs if j["workspace"]==workspace]
        assets = [
            dict(x)
            for x in con.execute(
                """SELECT m.id,m.kind,m.mime,m.w,m.h,m.size,m.owner,m.workspace,
                   COALESCE(r.seconds,0) AS seconds,COALESCE(r.has_audio,0) AS has_audio,COALESCE(r.name,'') AS name
                   FROM media m LEFT JOIN h3_reference_media r ON r.media=m.id
                   WHERE m.kind IN ('ref','ref_video','ref_audio') AND m.workspace=? ORDER BY m.rowid DESC""",(workspace,)
            )
        ]
        model_catalog=model_policy.catalog(con)
        out = {
            "server_time": server_time,
            "workspace_id":workspace,
            "legacy_workspace_id":int(con.execute("SELECT value FROM settings WHERE key='workspaces_migrated_v1'").fetchone()[0]),
            "workspaces":spaces,
            "me": public_profile(u),
            "avatars": catalog(),
            "jobs": jobs,
            "assets": assets,
            "nodes": nodes
            if u["role"] == "admin"
            else [n for n in nodes if n["owner"] == u["id"]],
            "ratios": list(RATIOS),
            "sizes": RATIOS,
            "images": image_configuration(con),
            "video_models":{key:spec['label'] for key,spec in model_catalog.items() if spec['kind']=='video' and not spec.get('hidden')},
            "audio_models":{key:spec['label'] for key,spec in model_catalog.items() if spec['kind']=='audio' and not spec.get('hidden')},
            "model_catalog":model_catalog,
            "model_groups":model_policy.groups(con),
            "gpu_models":GPU_MODELS,
            "muse":muse_provider.configuration(con),
            "flow":flow_provider.configuration(con),
            "h3_limits":{"images":9,"videos":3,"audios":3,"total":12,"clip_seconds":15},
            "model_policy":model_policy.read(con),
            "model_access":model_policy.effective(con,workspace),
            "credits":credits.wallet(con,workspace),
            "credit_history":credits.history(con,workspace),
            "pricing":credits.prices(con),
            "favorites": favorite_keys(con, u["id"], workspace),
        }
        if u["role"] == "admin":
            out.update(used=used, reserved=reserved, quota=QUOTA)
            out["disk_free"] = shutil.disk_usage(DATA).free
            out["users"] = [
                public_profile(x) | {"active": x["active"]}
                for x in con.execute(
                    "SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id"
                )
            ]
            out['invite_codes'] = invitations.listing(con)
            out['team_model_policies']={str(s['id']):model_policy.team_policy(con,s['id']) for s in spaces if s['kind']=='team'}
            out['credit_accounts']=credits.accounts(con)
        return out


@app.post("/api/assets")
async def upload(request: Request):
    u = actor(request)
    tmp, size = await receive(request, 16 << 20)
    try:
        try:
            imported = await run_in_threadpool(import_reference, tmp)
        except ImageImportError as error:
            fail(400, str(error))
        size, w, h = imported['size'], imported['w'], imported['h']
        key = uuid.uuid4().hex
        with db(True) as con:
            workspace=active_workspace(con,u,request)
            source = request.headers.get('X-Frame-Source')
            frame = request.headers.get('X-Frame-Time')
            provenance = None
            if source is not None or frame is not None:
                if not source or frame is None:
                    fail(400, '取帧来源信息不完整')
                require_resource(con, u, con.execute("SELECT * FROM media WHERE id=? AND kind='video'", (source,)).fetchone(), workspace)
                try:
                    seconds = float(frame)
                    if not math.isfinite(seconds) or not 0 <= seconds <= 3600:
                        raise ValueError()
                except (TypeError, ValueError):
                    fail(400, '取帧时间无效')
                provenance = (source, seconds)
            capacity(con, size)
            con.execute(
                "INSERT INTO media(id,kind,size,mime,w,h,owner) VALUES(?,?,?,?,?,?,?)",
                (key, "ref", size, imported["mime"], w, h, u["id"]),
            )
            con.execute("UPDATE media SET workspace=? WHERE id=?",(workspace,key))
            store.put(tmp, key)
            if provenance:
                con.execute('INSERT INTO media_provenance VALUES(?,?,?,?)', (key,*provenance,now()))
        return {"id": key, **imported}
    finally:
        tmp.unlink(missing_ok=True)


@app.get("/media/{key}")
def media(key: str, request: Request, download: bool = False):
    u = actor(request)
    with db() as con:
        row = con.execute("SELECT * FROM media WHERE id=?", (key,)).fetchone()
        require_resource(con,u,row)
    if not row:
        fail(404, "文件不存在")
    return store.serve(
        key,
        row["mime"],
        filename="弗淼-" + key[:8] + {"audio/wav":".wav","video/mp4": ".mp4", "video/webm": ".webm", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(row["mime"], "") if download else None,
    )


@app.delete("/api/assets/{key}")
def remove_asset(key: str, request: Request):
    u = actor(request)
    with db(True) as con:
        m = con.execute(
            "SELECT * FROM media WHERE id=? AND kind IN ('ref','ref_video','ref_audio')", (key,)
        ).fetchone()
        if not m:
            fail(404, "素材不存在")
        require_resource(con,u,m,active_workspace(con,u,request))
        if m["owner"] != u["id"] and u["role"] != "admin":
            fail(403, "只能删除自己的素材")
        protect_canvas_media(con, key)
        if con.execute(
            "SELECT 1 FROM jobs,json_each(jobs.refs) r WHERE r.value=? LIMIT 1", (key,)
        ).fetchone():
            fail(409, "仍有作品或任务引用这张图，请先删除相关版本")
        if con.execute("SELECT 1 FROM jobs WHERE result=?", (key,)).fetchone():
            fail(409, "请从生成记录中删除这张图片")
        con.execute("DELETE FROM media WHERE id=?", (key,))
    store.delete(key)
    return {"ok": True}


@app.post("/api/jobs")
def submit(d: Draft, request: Request):
    u = actor(request)
    with db(True) as con:
        return create_video_job(con, d, u, active_workspace(con,u,request))


@app.post("/api/jobs/{i}/cancel")
@app.delete("/api/jobs/{i}")
def change_job(i: int, request: Request):
    u = actor(request)
    key = None
    with db(True) as con:
        j = con.execute("SELECT * FROM jobs WHERE id=?", (i,)).fetchone()
        if not j:
            fail(404, "任务不存在")
        require_resource(con,u,j,active_workspace(con,u,request))
        if j["owner"] != u["id"] and u["role"] != "admin":
            fail(403, "只能管理自己的版本")
        if request.method == "POST":
            if j["status"] != "queued":
                fail(409, "只能撤回尚未开始的任务")
            timing.end_run(con, j, "cancelled")
            con.execute(
                "UPDATE jobs SET status='cancelled',note='',updated=? WHERE id=?",
                (now(), i),
            )
        else:
            if j["status"] in ("queued", "running"):
                fail(409, "请先撤回排队任务或等待运行结束")
            key = j["result"]
            if key:
                protect_canvas_media(con, key)
            if key and con.execute("SELECT 1 FROM jobs,json_each(jobs.refs) r WHERE r.value=? LIMIT 1", (key,)).fetchone():
                fail(409, "仍有作品或任务引用这张图片，请先删除相关版本")
            con.execute("DELETE FROM jobs WHERE id=?", (i,))
            if key:
                con.execute("DELETE FROM media WHERE id=?", (key,))
    if key:
        store.delete(key)
    return {"ok": True}


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"service": "fumiao", "ok": True}


@app.get("/connect/{file}")
def script(file: str):
    if file not in ("install.sh", "agent.tgz", "agent.tgz.sha256"):
        fail(404, "文件不存在")
    return FileResponse(ROOT / "agent" / file, media_type="application/octet-stream")


STUDIO_QUERY_KEYS = ("workspace", "recharge")


@app.api_route("/", methods=["GET", "HEAD"])
def home(request: Request):
    # Legacy workbench links (/?workspace=…, /?recharge=…) keep their query on /studio;
    # fragments such as /#register are forwarded by home.js because servers never see them.
    if any(key in request.query_params for key in STUDIO_QUERY_KEYS):
        return RedirectResponse("/studio?" + request.url.query, 307)
    try:
        actor(request)
        signed_in = True
    except HTTPException:
        signed_in = False
    page = public_assets.html(STATIC_ROOT, "home.html", chat=False)
    return HTMLResponse(page.replace('data-session="guest"', 'data-session="member"', 1) if signed_in else page)


@app.api_route("/studio", methods=["GET", "HEAD"])
def studio_home():
    return HTMLResponse(public_assets.html(STATIC_ROOT, "index.html"))


@app.api_route("/studio/", methods=["GET", "HEAD"])
def studio_slash(request: Request):
    return RedirectResponse("/studio" + ("?" + request.url.query if request.url.query else ""), 308)


@app.get("/canvas")
@app.get("/canvas/{project_id}")
def canvas_home(project_id: str = ""):
    return HTMLResponse(public_assets.html(STATIC_ROOT, "canvas.html"))


@app.api_route("/static/{file}",methods=["GET","HEAD"])
def static(file: str):
    if file not in public_assets.NAMES:
        fail(404, "文件不存在")
    return FileResponse(STATIC_ROOT / file)


class EstimateRequest(BaseModel):
    model: str = ""
    kind: str = "video"
    ratio: str = "16:9"
    quality: int = 480
    seconds: int = 5
    sampling_steps: Literal[4,16,20,32,50] = 20
    resolution: str = "1K"
    image_quality: str = "medium"
    refs: list[str] = Field(default_factory=list, max_length=12)
    h3: H3Inputs | None = None
    text_chars: int = Field(default=1,ge=1,le=300)
    language: str = 'zh'
    audio_instruction: str = Field(default='',max_length=300)


@app.post("/api/estimate")
def estimate(body: EstimateRequest, request: Request):
    u = actor(request)
    native=None
    if body.h3 is not None:
        if body.kind!='video' or body.model not in ('','MiniMax H3'):fail(400,'当前模型不支持 H3 输入模式')
        body.model='MiniMax H3'
        with db() as con:native=prepare_h3_inputs(con,body,u,active_workspace(con,u,request))
        body.refs=[f['id'] for f in native['files']]
        if native['mode']=='frames' and native['files']:
            image=native['files'][0];aspect=image['w']/image['h']
            body.ratio=min(RATIOS,key=lambda r:abs(math.log(aspect/(int(r.split(':')[0])/int(r.split(':')[1])))))
    if body.kind=='audio':
        from audio_api import default_instruction
        if body.model not in GPU_MODELS or GPU_MODELS[body.model]['kind']!='audio' or body.language not in ('zh','en'):fail(400,'未知语音参数')
        job=dict(id=2**62,node=None,status='queued',kind='audio',model=body.model,width=0,height=0,ratio='audio',seconds=0,quality=0,image_quality='standard',refs=[],text_chars=body.text_chars,language=body.language,audio_settings={'instruction':body.audio_instruction.strip() or default_instruction(body.language)})
        with db() as con:
            job['workspace']=active_workspace(con,u,request)
            prediction=timing.submission_forecast(con,job)
            jobs=[dict(r) for r in con.execute("SELECT * FROM jobs WHERE status IN ('queued','running')")]
            plans=timing.queue_estimates(con,jobs+[job],timing.all_nodes(con),timing.read_runs(con),timing.Estimator(con),timing.time.time())
        return {'duration':prediction,'queue':plans[job['id']]}
    from image_api import SIZES, DEFAULT_MODEL
    flow = FLOW_MODELS.get(body.model)
    if flow:
        if body.kind != flow['kind']:fail(400,'模型与生成类型不匹配')
        job=dict(id=2**62,node=None,status='queued',kind=body.kind,model=body.model,width=0,height=0,
                 ratio=flow['ratio'],seconds=flow['seconds'],quality=0,image_quality='native',refs=body.refs,sampling_steps=20)
        with db() as con:
            workspace=active_workspace(con,u,request);job['workspace']=workspace
            for key in body.refs:require_resource(con,u,con.execute("SELECT * FROM media WHERE id=? AND kind='ref'",(key,)).fetchone(),workspace)
            prediction=timing.submission_forecast(con,job)
            jobs=[dict(row) for row in con.execute("SELECT * FROM jobs WHERE status IN ('queued','running')")]
            plans=timing.queue_estimates(con,jobs+[job],timing.all_nodes(con),timing.read_runs(con),timing.Estimator(con),timing.time.time())
        return {'duration':prediction,'queue':plans[job['id']]}
    muse = body.model in muse_provider.MODELS
    if muse and body.model != 'muse-'+body.kind:fail(400,'模型与生成类型不匹配')
    if body.kind not in ("video", "image") or body.ratio not in RATIOS:
        fail(400, "未知生成参数")
    supported = ("", "MiniMax H3", "muse-video") if body.kind == "video" else ("", DEFAULT_MODEL, "muse-image")
    if body.model not in supported:fail(400,'未知生成模型')
    if muse:
        if body.sampling_steps!=20:fail(400,'Muse 不支持采样步数设置')
        ratios=muse_provider.IMAGE_RATIOS if body.kind=='image' else muse_provider.VIDEO_RATIOS
        if body.ratio not in ratios or (body.kind=='video' and body.seconds not in muse_provider.DURATIONS):fail(400,'未知 Muse 参数')
        width,height=0,0
    elif body.kind == "video":
        if body.quality not in (480,768) or body.seconds not in (5,10,15):
            fail(400, "未知生成参数")
        offset = 0 if body.quality == 480 else 2
        width,height = RATIOS[body.ratio][offset:offset+2]
    else:
        if body.resolution not in ("1K","2K") or body.image_quality not in ("low","medium","high"):
            fail(400, "未知生成参数")
        offset = 0 if body.resolution == "1K" else 2
        width,height = SIZES[body.ratio][offset:offset+2]
    job = dict(id=2**62, node=None, status="queued", kind=body.kind, model=body.model if muse else DEFAULT_MODEL if body.kind=="image" else "MiniMax H3",
               width=width,height=height,ratio=body.ratio,seconds=body.seconds if body.kind=="video" else 0,quality=body.quality,
               image_quality=body.image_quality,refs=body.refs,sampling_steps=body.sampling_steps)
    if native:job['h3_inputs']=native
    with db() as con:
        workspace=active_workspace(con,u,request)
        job['workspace']=workspace
        for key in body.refs:
            require_resource(con,u,con.execute("SELECT * FROM media WHERE id=? AND kind IN ('ref','ref_video','ref_audio')" if native else "SELECT * FROM media WHERE id=? AND kind='ref'",(key,)).fetchone(),workspace)
        prediction = timing.submission_forecast(con, job)
        jobs = [dict(row) for row in con.execute("SELECT * FROM jobs WHERE status IN ('queued','running')")]
        plans = timing.queue_estimates(con,jobs+[job],timing.all_nodes(con),timing.read_runs(con),timing.Estimator(con),timing.time.time())
    return {"duration":prediction,"queue":plans[job["id"]]}


class ModelSwitch(BaseModel):
    model: str
    enabled: bool
    group: bool = False
    expected_revision: int = Field(ge=0)
    workspace: int | None = None


@app.patch("/api/settings/models")
def set_model(body: ModelSwitch, request: Request):
    admin(request)
    with db(True) as con:
        if body.group:
            policy=model_policy.save_group(con,body.model,body.enabled,body.expected_revision,body.workspace)
        else:
            if body.model not in model_policy.MODELS:fail(400,"未知模型")
            if body.model in model_policy.hidden_models(con) and body.enabled:fail(400,"该模型已隐藏")
            if body.workspace is not None:
                policy=model_policy.save_team(con,body.workspace,body.model,body.enabled,body.expected_revision)
            else:
                flags=model_policy.read(con)['enabled']
                flags[body.model]=body.enabled
                policy=model_policy.save(con,flags,body.expected_revision)
    from image_api import WAKE
    WAKE.set();muse_provider.WAKE.set();flow_provider.WAKE.set()
    with db() as con:
        image_enabled=any(model_policy.enabled(con,key) for key,value in model_policy.MODELS.items() if value['kind']=='image')
    return {"policy":policy,"image_enabled":image_enabled}
