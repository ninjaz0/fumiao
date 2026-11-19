"""Video submission shared by the studio and canvas, within the caller's transaction."""
import json
import math
import secrets
import uuid
from pydantic import BaseModel, Field, field_validator
from typing import Literal
from core import RATIOS, RESERVE, capacity, fail, now
import timing
import model_policy
import credits
from workspace_access import active_workspace, require_resource

from asset_packs import PackRef
import asset_packs
from h3_inputs import H3Inputs, prepare as prepare_h3


class Draft(BaseModel):
    asset_packs: list[PackRef] = Field(default_factory=list, max_length=9)
    price_revision: int | None = Field(default=None,ge=1)
    model: str = Field(default="MiniMax H3", max_length=180)
    flow_source_job: int | None = Field(default=None, gt=0)
    prompt: str = Field(min_length=1, max_length=12000)
    refs: list[str] = Field(default_factory=list, max_length=12)
    h3: H3Inputs | None = None
    ratio: str = "16:9"
    quality: int = 480
    seconds: int = 5
    sampling_steps: Literal[4,16,20,32,50] = 20
    seed: int | None = Field(default=None, ge=0, le=2**53 - 1)
    @field_validator('model')
    @classmethod
    def validate_model(cls, value):
        if value not in model_policy.MODELS or model_policy.MODELS[value]['kind'] != 'video':
            raise ValueError('未知video模型')
        return value

    parent: int | None = None
    uid: uuid.UUID


def _create_video_job(con, d: Draft, u, workspace=None):
    workspace = active_workspace(con, u, workspace=workspace)
    if d.h3 is not None and d.model!='MiniMax H3':fail(400,'当前模型不支持 H3 输入模式')
    from flow_catalog import MODELS as FLOW_MODELS
    if d.model in FLOW_MODELS:
        from flow_provider import create_job
        return create_job(con,d,u,'video',workspace)
    if d.model not in ('MiniMax H3','muse-video'):fail(400,'未知视频模型')
    if d.model=="muse-video":
        if d.sampling_steps!=20:fail(400,'Muse 不支持采样步数设置')
        from muse_provider import create_job
        return create_job(con,d,u,"video",workspace)
    if (
        not d.prompt.strip()
        or d.quality not in (480, 768)
        or d.seconds not in (5, 10, 15)
    ):
        fail(400, "请检查提示词、清晰度和时长")
    if d.ratio != "auto" and d.ratio not in RATIOS:
        fail(400, "未知画幅")
    idem = str(u["id"]) + "-" + str(d.uid)
    old = con.execute("SELECT id,workspace FROM jobs WHERE uid=?", (idem,)).fetchone()
    if old:
        require_resource(con,u,old,workspace)
        return {"id": old[0]}
    model_policy.require_enabled(con,d.model,workspace)
    native=prepare_h3(con,d,u,workspace)
    input_ids=[f['id'] for f in native['files']] if native else list(d.refs)
    if not native and len(input_ids)>9:fail(400,'最多选择 9 张参考图片')
    refs = []
    for ref in input_ids:
        m = con.execute(
            "SELECT * FROM media WHERE id=?" if native else "SELECT * FROM media WHERE id=? AND kind='ref'", (ref,)
        ).fetchone()
        if not m:
            fail(400, "参考图已不存在")
        require_resource(con,u,m,workspace)
        refs.append(m)
    ratio = 'auto' if native and native['mode']=='frames' and refs else d.ratio
    if ratio == "auto":
        visual=next((m for m in refs if m['w'] and m['h']),None)
        target = (visual["w"] / visual["h"]) if visual else 16 / 9
        ratio = min(
            RATIOS,
            key=lambda k: abs(
                math.log(target / (int(k.split(":")[0]) / int(k.split(":")[1])))
            ),
        )
    offset = 0 if d.quality == 480 else 2
    w, h = RATIOS[ratio][offset : offset + 2]
    capacity(con, RESERVE)
    requested_steps=d.sampling_steps
    if d.parent:
        parent=require_resource(con,u,con.execute("SELECT * FROM jobs WHERE id=?",(d.parent,)).fetchone(),workspace)
        if 'sampling_steps' not in d.model_fields_set and parent['model']=='MiniMax H3' and parent['sampling_steps'] in (4,16,20,32,50):
            requested_steps=parent['sampling_steps']
    i = con.execute(
        """INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,parent,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)""",
        (
            idem,
            u["id"],
            d.prompt.strip(),
            json.dumps(input_ids),
            ratio,
            d.quality,
            d.seconds,
            d.seed if d.seed is not None else secrets.randbits(53),
            w,
            h,
            d.parent,
            now(),
            now(),
        ),
    ).lastrowid
    con.execute("UPDATE jobs SET workspace=?,sampling_steps=? WHERE id=?",(workspace,requested_steps,i))
    if native:con.execute('UPDATE jobs SET h3_inputs=? WHERE id=?',(json.dumps(native,ensure_ascii=False),i))
    credits.reserve(con,i,d.price_revision)
    timing.save_submission_forecast(con, i)
    return {"id": i}


def create_video_job(con, d: Draft, u, workspace=None):
    user = u
    workspace = active_workspace(con, user, workspace=workspace)
    draft = d
    if draft.h3 and draft.h3.mode=='frames' and draft.asset_packs:fail(400,'首尾帧模式请在槽位中直接选择图片')
    if not draft.asset_packs:
        return _create_video_job(con, draft, user, workspace)
    from flow_catalog import MODELS as FLOW_MODELS
    prefix = '-flow-video' if draft.model in FLOW_MODELS else '-muse-video' if draft.model == 'muse-video' else ''
    old = con.execute('SELECT id,workspace FROM jobs WHERE uid=?',
                      (f"{user['id']}{prefix}-{draft.uid}",)).fetchone()
    if old:
        require_resource(con, user, old, workspace)
        return {'id': old['id']}
    draft, snapshots = asset_packs.expand(con, draft, user, workspace)
    result = _create_video_job(con, draft, user, workspace)
    asset_packs.freeze(con, result['id'], snapshots)
    return result
