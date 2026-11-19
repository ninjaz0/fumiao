"""Bounded CPU composition. The preview and download are the exact same MP4."""
import json
import logging
import math
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import actor, capacity, db, fail, now, stage_dir, store
from workspace_access import require_resource

router = APIRouter()
STOP = threading.Event()
WAKE = threading.Event()
RESERVE = 256 << 20


class ExportDraft(BaseModel):
    uid: uuid.UUID
    expected_revision: int = Field(ge=1)


def public(row):
    return {k:row[k] for k in ('id','state','result','error','revision','created','updated')}


@router.get('/api/canvases/{pid}/exports')
def listing(pid: str, request: Request):
    from canvas_api import project
    user=actor(request)
    with db() as con:
        project(con,pid,user)
        return {'exports':[public(r) for r in con.execute('SELECT * FROM storyboard_exports WHERE project=? ORDER BY created DESC,rowid DESC LIMIT 20',(pid,))]}


@router.post('/api/canvases/{pid}/exports')
def create(pid: str, body: ExportDraft, request: Request):
    from canvas_api import project, check_revision, Document, media_for_node
    user=actor(request)
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        fail(503,'成片合成服务尚未配置，请联系管理员')
    with db(True) as con:
        p=project(con,pid,user)
        old=con.execute('SELECT * FROM storyboard_exports WHERE owner=? AND uid=?',(user['id'],str(body.uid))).fetchone()
        if old:
            if old['project']!=pid:fail(409,'提交编号已使用')
            return public(old)
        check_revision(p,body.expected_revision)
        doc=Document.model_validate_json(p['document'])
        if not doc.shots or len(doc.shots)>30:fail(400,'合成需要 1–30 个镜头')
        if con.execute("SELECT 1 FROM storyboard_exports WHERE workspace=? AND state IN ('queued','running')",(p['workspace'],)).fetchone():
            fail(409,'当前空间已有成片在合成，请完成后再试')
        if con.execute("SELECT count(*) FROM storyboard_exports WHERE state IN ('queued','running')").fetchone()[0]>=10:
            fail(429,'合成队列已满，请稍后重试')
        nodes={n.id:n for n in doc.nodes};shots=[];keys=set()
        for index,nid in enumerate(doc.shots,1):
            n=nodes[nid];key=media_for_node(con,pid,n)
            media=con.execute("SELECT * FROM media WHERE id=? AND kind='video'",(key,)).fetchone()
            if not media:fail(409,f'镜头 {index} 的视频尚未就绪')
            require_resource(con,user,media,p['workspace']);keys.add(key)
            shot={'node':nid,'title':n.title,'video':key,'voice':None,'text':''}
            if n.narration_pending:
                pending=con.execute('SELECT status FROM jobs WHERE id=?',(n.narration_pending,)).fetchone()
                if pending and pending['status'] in ('queued','running'):
                    fail(409,f'镜头 {index} 的新旁白仍在生成，请完成后合成')
            if n.narration_job:
                job=con.execute("SELECT * FROM jobs WHERE id=? AND kind='audio'",(n.narration_job,)).fetchone()
                if not job or job['status']!='done' or not job['result']:fail(409,f'镜头 {index} 的旁白尚未就绪')
                require_resource(con,user,job,p['workspace'])
                if job['prompt'].strip()!=n.narration_text.strip():fail(409,f'镜头 {index} 的旁白文字已修改，请重新生成旁白或移除音轨')
                shot.update(voice=job['result'],text=job['prompt']);keys.add(job['result'])
            elif n.narration_text.strip():
                fail(409,f'镜头 {index} 已填写旁白，请先生成语音或清空旁白')
            shots.append(shot)
        capacity(con,RESERVE)
        input_bytes=sum(con.execute('SELECT size FROM media WHERE id=?',(key,)).fetchone()[0] for key in keys)
        if shutil.disk_usage(stage_dir).free < input_bytes + 2*RESERVE + (1<<30):
            fail(507,'合成空间不足，请先清理素材或联系管理员')
        key=uuid.uuid4().hex
        con.execute('INSERT INTO storyboard_exports(id,uid,owner,workspace,project,revision,snapshot,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
                    (key,str(body.uid),user['id'],p['workspace'],pid,p['revision'],json.dumps(shots,ensure_ascii=False),now(),now()))
        con.executemany('INSERT INTO storyboard_export_refs VALUES(?,?)',[(key,m) for m in keys])
        result=public(con.execute('SELECT * FROM storyboard_exports WHERE id=?',(key,)).fetchone())
    WAKE.set();return result


@router.get('/api/storyboard-exports/{key}/subtitles')
def subtitles(key: str, request: Request, format: Literal['srt','vtt']='srt'):
    user=actor(request)
    with db() as con:
        row=con.execute('SELECT * FROM storyboard_exports WHERE id=?',(key,)).fetchone()
        require_resource(con,user,row)
        if row['state']!='done':fail(409,'字幕尚未就绪')
        text=row['subtitles']
    if format=='vtt':
        return Response('WEBVTT\n\n'+re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})',r'\1.\2',text),media_type='text/vtt')
    return Response(text,media_type='application/x-subrip',headers={'Content-Disposition':'attachment; filename="subtitles.srt"'})


def run_command(args, timeout=180):
    result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if result.returncode:
        raise ValueError('素材解码或合成失败，请检查视频和音轨后重试')
    return result.stdout


def probe(path):
    return json.loads(run_command(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',str(path)],30))


def duration(info,kind):
    streams=[s for s in info['streams'] if s.get('codec_type')==kind]
    if not streams:raise ValueError('素材缺少所需的视频或音轨')
    value=float(streams[0].get('duration') or info['format'].get('duration') or 0)
    if not math.isfinite(value) or not .05<value<=120:raise ValueError('单段素材时长需在 0.05–120 秒之间')
    return value


def timestamp(seconds):
    ms=round(seconds*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def subtitle_cues(text,offset,length,start):
    # Sentence-weighted captions are deliberately not claimed as speech recognition.
    parts=[p.strip() for p in re.split(r'(?<=[。！？!?；;])|\n+',text) if p.strip()]
    total=sum(len(p) for p in parts);cursor=offset;out=[]
    for i,part in enumerate(parts,start):
        end=cursor+length*len(part)/total
        out.append(f'{i}\n{timestamp(cursor)} --> {timestamp(end)}\n{part}\n')
        cursor=end
    return out


def compose(snapshot,folder):
    paths={};segments=[];captions=[];total=0;size=None
    for shot in snapshot:
        if STOP.is_set():raise ValueError('服务已重启，请重新合成')
        for key in (shot['video'],shot['voice']):
            if not key or key in paths:continue
            path=folder/key
            with store.open(key) as source,path.open('wb') as dest:shutil.copyfileobj(source,dest,1024*1024)
            paths[key]=path
        video=paths[shot['video']];info=probe(video);vd=duration(info,'video')
        voice=paths.get(shot['voice']);ad=duration(probe(voice),'audio') if voice else 0
        length=math.ceil(max(vd,ad)*24-1e-4)/24
        total+=length
        if total>300:raise ValueError('成片总时长最多 5 分钟，请减少镜头或旁白')
        if size is None:
            stream=next(s for s in info['streams'] if s.get('codec_type')=='video')
            w,h=int(stream['width']),int(stream['height']);scale=min(1,1920/max(w,h));size=(max(2,int(w*scale)//2*2),max(2,int(h*scale)//2*2))
        w,h=size
        cmd=['ffmpeg','-v','error','-nostdin','-y','-threads','2','-protocol_whitelist','file,pipe','-i',str(video)]
        if voice:cmd+=['-protocol_whitelist','file,pipe','-i',str(voice)];audio='1:a:0'
        elif any(s.get('codec_type')=='audio' for s in info['streams']):audio='0:a:0'
        else:cmd+=['-f','lavfi','-i','anullsrc=r=48000:cl=stereo'];audio='1:a:0'
        vf=f'setpts=PTS-STARTPTS,scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,tpad=stop_mode=clone:stop_duration={length},trim=duration={length},format=yuv420p'
        af=f'asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={length}'
        segment=folder/f'shot-{len(segments):03d}.mp4'
        cmd+=['-filter_complex_threads','1','-filter_complex',f'[0:v:0]{vf}[v];[{audio}]{af}[a]',
              '-map','[v]','-map','[a]','-t',str(length),'-c:v','libx264','-preset','veryfast','-crf','21','-maxrate','4M','-bufsize','8M','-threads','2','-c:a','aac','-b:a','160k',str(segment)]
        run_command(cmd,300);segments.append(segment)
        if voice:captions+=subtitle_cues(shot['text'],total-length,ad,len(captions)+1)
    manifest=folder/'segments.txt';manifest.write_text(''.join(f"file '{s.name}'\n" for s in segments))
    result=folder/'result.mp4'
    picture=folder/'picture.mp4' if captions else result
    run_command(['ffmpeg','-v','error','-nostdin','-y','-f','concat','-safe','1','-i',str(manifest),'-c','copy','-movflags','+faststart',str(picture)],120)
    if captions:
        subtitle_file=folder/'subtitles.srt';subtitle_file.write_text('\n'.join(captions),encoding='utf-8')
        run_command(['ffmpeg','-v','error','-nostdin','-y','-i',str(picture),'-i',str(subtitle_file),'-map','0:v:0','-map','0:a:0','-map','1:0','-c','copy','-c:s','mov_text','-metadata:s:s:0','language=zho','-disposition:s:0','default','-movflags','+faststart',str(result)],120)
    actual=probe(result);vd=duration_unbounded(actual)
    if abs(vd-total)>.25 or result.stat().st_size>RESERVE:raise ValueError('合成结果时长或体积异常，请调整后重试')
    return result,'\n'.join(captions),size,vd


def duration_unbounded(info):
    value=float(info.get('format',{}).get('duration',0))
    if not math.isfinite(value):raise ValueError('成片时长无效')
    return value


def process_export(row):
    key=row['id'];media_key=uuid.uuid4().hex;stored=False
    try:
        with tempfile.TemporaryDirectory(prefix='storyboard-',dir=stage_dir) as temp:
            result,srt,size,seconds=compose(json.loads(row['snapshot']),Path(temp));length=result.stat().st_size
            with db(True) as con:
                current=con.execute('SELECT state FROM storyboard_exports WHERE id=?',(key,)).fetchone()
                if not current or current['state']!='running':return
                con.execute("UPDATE storyboard_exports SET state='done' WHERE id=?",(key,))
                capacity(con,length)
                store.put(result,media_key);stored=True
                con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,'video',?,'video/mp4',?,?,?,?)",(media_key,length,*size,row['owner'],row['workspace']))
                con.execute("""INSERT INTO jobs(uid,owner,workspace,prompt,refs,ratio,quality,seconds,seed,width,height,status,created,updated,kind,model,result,output_metadata)
                    VALUES(?,?,?,?,'[]',?,0,?,0,?,?,'done',?,?,'video','storyboard',?,?)""",
                    ('storyboard-export-'+key,row['owner'],row['workspace'],'镜头合成',f'{size[0]}:{size[1]}',seconds,*size,row['created'],now(),media_key,json.dumps({'width':size[0],'height':size[1],'duration':seconds,'storyboard_export':key,'canvas_project':row['project']})))
                con.execute("UPDATE storyboard_exports SET result=?,subtitles=?,updated=? WHERE id=?",(media_key,srt,now(),key))
                con.execute('DELETE FROM storyboard_export_refs WHERE export=?',(key,))
    except Exception as error:
        if stored:store.delete(media_key)
        logging.exception('Storyboard export %s failed',key)
        message=str(error) if isinstance(error,ValueError) else '合成中断，请检查素材后重试'
        with db(True) as con:
            con.execute("UPDATE storyboard_exports SET state='failed',error=?,updated=? WHERE id=?",(message[:300],now(),key))
            con.execute('DELETE FROM storyboard_export_refs WHERE export=?',(key,))


def loop():
    while not STOP.is_set():
        with db(True) as con:
            row=con.execute("SELECT * FROM storyboard_exports WHERE state='queued' ORDER BY created,rowid LIMIT 1").fetchone()
            if row:con.execute("UPDATE storyboard_exports SET state='running',updated=? WHERE id=?",(now(),row['id']))
        if row:process_export(dict(row))
        else:WAKE.wait(3);WAKE.clear()


def start():
    STOP.clear()
    # Only our interrupted intermediate folders; uploaded media lives elsewhere.
    for folder in stage_dir.glob('storyboard-*'):
        if folder.is_dir() and not folder.is_symlink():shutil.rmtree(folder)
    with db(True) as con:
        con.execute("UPDATE storyboard_exports SET state='failed',error='服务重启中断了合成，请重新合成',updated=? WHERE state='running'",(now(),))
        con.execute("DELETE FROM storyboard_export_refs WHERE export IN (SELECT id FROM storyboard_exports WHERE state='failed')")
    thread=threading.Thread(target=loop,name='storyboard-export',daemon=True);thread.start();return thread


def stop(thread):
    STOP.set();WAKE.set();thread.join(timeout=1)
