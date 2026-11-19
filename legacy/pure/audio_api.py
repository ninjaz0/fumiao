"""Workspace-scoped Breeze speech jobs. Uses the same queue, ledger and GPU leases."""
import json
import secrets
import uuid
import wave
from array import array
from typing import Literal
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
import credits
import model_policy
import timing
from core import actor, db, fail, now, capacity, RESERVE
from workspace_access import active_workspace, require_resource
from node_models import GPU_MODELS

router=APIRouter()

def default_instruction(language):
    return '声音清晰自然、语速适中，使用普通话朗读。' if language=='zh' else 'A clear, natural narrator speaking at a moderate pace.'


class AudioDraft(BaseModel):
    uid: uuid.UUID
    model: str = Field(default='breeze-tts-2',max_length=80)
    prompt: str = Field(min_length=1,max_length=300)
    instruction: str = Field(default='',max_length=300)
    seed: int | None = Field(default=None,ge=0,le=2**32-1)
    parent: int | None = None
    price_revision: int | None = Field(default=None,ge=1)


def create_audio_job(con, body, user, workspace):
    if body.model not in GPU_MODELS or GPU_MODELS[body.model]['kind']!='audio':fail(400,'未知语音模型')
    workspace=active_workspace(con,user,workspace=workspace)
    idem=f"{user['id']}-audio-{body.uid}"
    old=con.execute('SELECT id,workspace FROM jobs WHERE uid=?',(idem,)).fetchone()
    if old:require_resource(con,user,old,workspace);return {'id':old['id']}
    model_policy.require_enabled(con,body.model,workspace)
    text=body.prompt.strip()
    if not text:fail(400,'请输入要朗读的文字')
    if body.parent:require_resource(con,user,con.execute('SELECT * FROM jobs WHERE id=? AND kind=\'audio\'',(body.parent,)).fetchone(),workspace)
    instruction=body.instruction.strip() or default_instruction('zh' if any('\u4e00'<=c<='\u9fff' for c in text) else 'en')
    capacity(con,RESERVE)
    jid=con.execute('''INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,parent,status,created,updated,kind,model,image_quality,workspace,audio_settings)
        VALUES(?,?,?,'[]','audio',0,0,?,0,0,?,'queued',?,?,'audio',?,'standard',?,?)''',
        (idem,user['id'],text,body.seed if body.seed is not None else secrets.randbits(31),body.parent,now(),now(),body.model,workspace,json.dumps({'instruction':instruction},ensure_ascii=False))).lastrowid
    credits.reserve(con,jid,body.price_revision);timing.save_submission_forecast(con,jid)
    return {'id':jid}


@router.post('/api/audio-jobs')
def submit(body:AudioDraft,request:Request):
    user=actor(request)
    with db(True) as con:return create_audio_job(con,body,user,active_workspace(con,user,request))


def validate_audio(path):
    try:
        with wave.open(str(path),'rb') as stream:
            frames=stream.getnframes();rate=stream.getframerate()
            if (stream.getnchannels(),stream.getsampwidth(),rate,stream.getcomptype())!=(1,2,24000,'NONE'):
                raise ValueError('unexpected audio format')
            duration=frames/rate
            if not .1<=duration<119.5:raise ValueError('duration')
            raw=stream.readframes(frames)
            if len(raw)!=frames*2:raise ValueError('truncated')
            samples=array('h');samples.frombytes(raw)
            if max(map(abs,samples),default=0)<32:raise ValueError('silent')
        return {'duration':round(duration,3),'sample_rate':rate,'channels':1,'format':'wav'}
    except (OSError,EOFError,wave.Error,ValueError):
        fail(422,'语音未通过完整性或时长校验；如达到时长上限，请缩短文字后重试')
