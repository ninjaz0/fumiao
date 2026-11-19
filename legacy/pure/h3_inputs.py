"""Validated native H3 references and immutable input roles."""
import json
import math
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import unquote

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from starlette.concurrency import run_in_threadpool

MediaId = Annotated[str, StringConstraints(pattern=r'^[a-f0-9]{32}$')]
class H3Inputs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['reference','frames']
    first_frame: MediaId | None = None
    last_frame: MediaId | None = None
    video_audio: list[MediaId] = Field(default_factory=list,max_length=3)

router=APIRouter()
MEDIA_KINDS=('ref','ref_video','ref_audio')
_media_slots=threading.Semaphore(2)

def migrate(con):
    con.execute('''CREATE TABLE IF NOT EXISTS h3_reference_media(
        media TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        seconds REAL NOT NULL, fps REAL NOT NULL DEFAULT 0,
        has_audio INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '')''')

def _number(value, default=0):
    try:
        result=float(value)
        return result if math.isfinite(result) else default
    except (TypeError,ValueError):return default

def probe(path):
    command=['ffprobe','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,wav,mp3,flac,ogg,aac',
             '-show_entries','format=duration:stream=codec_type,width,height,duration,avg_frame_rate:stream_disposition=attached_pic','-of','json',str(path)]
    try:
        result=subprocess.run(command,capture_output=True,text=True,timeout=20,check=True)
        data=json.loads(result.stdout)
    except (OSError,subprocess.SubprocessError,ValueError):raise ValueError('无法读取这个视频或音频文件') from None
    streams=data.get('streams',[])
    video=next((s for s in streams if s.get('codec_type')=='video' and not s.get('disposition',{}).get('attached_pic')),None)
    audio=next((s for s in streams if s.get('codec_type')=='audio'),None)
    seconds=max([_number(data.get('format',{}).get('duration'))]+[_number(s.get('duration')) for s in streams])
    return {'seconds':seconds,'video':video,'audio':audio}

def normalize_media(source, kind):
    """Bound decode duration, strip metadata, and normalize to worker-safe files."""
    with _media_slots:
        meta=probe(source)
        if not 1.99<=meta['seconds']<=15.05:raise ValueError('参考视频和音频的时长需为 2–15 秒')
        if kind=='video' and not meta['video']:raise ValueError('请选择包含画面的视频文件')
        if kind=='audio' and not meta['audio']:raise ValueError('请选择包含声音的音频文件')
        if meta['video'] and int(meta['video'].get('width',0))*int(meta['video'].get('height',0))>33_177_600:
            raise ValueError('参考视频画面过大，请先缩小后上传')
        output=source.with_name(source.name+('.mp4' if kind=='video' else '.wav'))
        command=['ffmpeg','-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,wav,mp3,flac,ogg,aac',
                 '-i',str(source),'-t','15.5','-map_metadata','-1','-map_chapters','-1']
        if kind=='video':
            command+=['-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24,setsar=1",
                      '-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-threads','2',
                      '-c:a','aac','-ar','32000','-ac','2','-movflags','+faststart']
        else:command+=['-map','0:a:0','-vn','-c:a','pcm_s16le','-ar','32000','-ac','2']
        try:
            subprocess.run(command+[str(output)],capture_output=True,timeout=90,check=True)
            result=probe(output)
            if not 1.99<=result['seconds']<=15.05 or output.stat().st_size>(64<<20):
                raise ValueError('参考素材超过时长或大小限制，请先裁短后上传')
            video=result['video'] or {}
            return output,{'seconds':round(result['seconds'],4),'fps':24 if kind=='video' else 0,
                           'has_audio':bool(result['audio']),'w':int(video.get('width',0)),'h':int(video.get('height',0)),
                           'mime':'video/mp4' if kind=='video' else 'audio/wav'}
        except (OSError,subprocess.SubprocessError):
            output.unlink(missing_ok=True);raise ValueError('素材转换失败，请更换文件后重试') from None
        except BaseException:
            output.unlink(missing_ok=True);raise

@router.post('/api/h3/references')
async def upload(request:Request, kind:Literal['video','audio']):
    from core import actor,receive,db,capacity,store,fail
    from workspace_access import active_workspace
    user=actor(request);source,size=await receive(request,96<<20);output=None
    try:
        try:output,meta=await run_in_threadpool(normalize_media,source,kind)
        except ValueError as error:fail(400,str(error))
        name=Path(unquote(request.headers.get('X-File-Name',''))).name
        name=''.join(c for c in name if ord(c)>=32)[:120]
        key=uuid.uuid4().hex;size=output.stat().st_size
        with db(True) as con:
            workspace=active_workspace(con,user,request);capacity(con,size)
            con.execute('INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)',
                        (key,'ref_'+kind,size,meta['mime'],meta['w'],meta['h'],user['id'],workspace))
            con.execute('INSERT INTO h3_reference_media VALUES(?,?,?,?,?)',(key,meta['seconds'],meta['fps'],int(meta['has_audio']),name))
            store.put(output,key)
        return {'id':key,'kind':'ref_'+kind,'mime':meta['mime'],'w':meta['w'],'h':meta['h'],'size':size,
                'seconds':meta['seconds'],'has_audio':meta['has_audio'],'name':name,'owner':user['id']}
    finally:
        source.unlink(missing_ok=True)
        if output:output.unlink(missing_ok=True)

def prepare(con, draft, user, workspace):
    """Resolve and freeze all media server-side; clients cannot forge duration/type."""
    from core import fail
    from workspace_access import require_resource
    options=draft.h3
    if options is None:return None
    if draft.model!='MiniMax H3':fail(400,'当前模型不支持 H3 输入模式')
    if options.mode=='frames':
        if options.video_audio:fail(400,'首尾帧模式只接收图片')
        ids=list(dict.fromkeys(k for k in (options.first_frame,options.last_frame) if k))
        if set(draft.refs)-set(ids):fail(400,'首尾帧模式请在对应槽位选择图片')
    else:
        if options.first_frame or options.last_frame:fail(400,'请在首尾帧模式指定首帧和尾帧')
        ids=list(draft.refs)
        if len(ids)!=len(set(ids)):fail(400,'参考素材不能重复')
    files=[]
    for key in ids:
        row=con.execute('SELECT * FROM media WHERE id=?',(key,)).fetchone()
        if not row or row['kind'] not in MEDIA_KINDS:fail(400,'参考素材不存在或格式不受支持')
        require_resource(con,user,row,workspace)
        kind={'ref':'image','ref_video':'video','ref_audio':'audio'}[row['kind']]
        if options.mode=='frames' and kind!='image':fail(400,'首尾帧模式只接收图片')
        item={'id':key,'kind':kind,'mime':row['mime'],'w':row['w'],'h':row['h'],'suffix':{'image':'png','video':'mp4','audio':'wav'}[kind]}
        if kind!='image':
            meta=con.execute('SELECT * FROM h3_reference_media WHERE media=?',(key,)).fetchone()
            if not meta:fail(400,'参考素材信息缺失，请重新上传')
            item.update(seconds=meta['seconds'],fps=meta['fps'],has_audio=bool(meta['has_audio']),name=meta['name'])
        files.append(item)
    for kind,limit in [('image',9),('video',3),('audio',3)]:
        selected=[f for f in files if f['kind']==kind]
        if len(selected)>limit:fail(400,{'image':'最多选择 9 张图片','video':'最多选择 3 段视频','audio':'最多选择 3 段音频'}[kind])
        if kind!='image' and (any(not 1.99<=f['seconds']<=15.05 for f in selected) or sum(f['seconds'] for f in selected)>15.05):
            fail(400,'同类参考视频或音频的总时长不能超过 15 秒')
        if kind=='video' and any(f['seconds']>draft.seconds+.05 or f['fps']!=24 for f in selected):
            fail(400,'生成时长不能短于参考视频，请调整时长或裁短参考视频')
    if len(files)>12:fail(400,'最多选择 12 个参考素材')
    if not set(options.video_audio)<={f['id'] for f in files if f['kind']=='video' and f['has_audio']}:
        fail(400,'所选视频没有可引用的声音')
    if options.mode=='frames' and len(files)==2:
        a,b=files
        if abs(math.log((a['w']/a['h'])/(b['w']/b['h'])))>.035:fail(400,'请使用比例相同的首尾帧图片')
    return {'version':1,'mode':options.mode,'first_frame':options.first_frame,'last_frame':options.last_frame,
            'video_audio':list(dict.fromkeys(options.video_audio)),'files':files}

def decode(value):
    if isinstance(value,str):
        try:return json.loads(value)
        except ValueError:return {}
    return value if isinstance(value,dict) else {}
