"""Durable Muse queue. Admission outages never consume a GPU or discard a queued job."""
import base64
import json
import math
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from PIL import Image, ImageOps
from core import dispatch_paused, DATA, RESERVE, capacity, db, fail, now, stage_dir, store, token
from workspace_access import active_workspace, require_resource
import timing
import model_policy
import credits

MODELS={'muse-image':'Muse','muse-video':'Muse'}
MUSE_PUBLIC_URL='https://backend.nvmes.com/muse'
LEGACY_MUSE_PUBLIC_URL='https://muse.nvmes.com'
IMAGE_RATIOS=('1:1','16:9','9:16','4:3','3:4')
VIDEO_RATIOS=('16:9','9:16')
DURATIONS=(5,6,8,10)
STOP=threading.Event()
WAKE=threading.Event()
RUN_LOCK=threading.Lock()
SCHEDULER={"capacity":1,"maintenance":0,"tasks":[]}


def config():
    values={}
    path=DATA/'muse.env'
    if path.is_file():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k,v=line.split('=',1);values[k.strip()]=v.strip().strip('\"\'')
    base=os.getenv('FUMIAO_MUSE_URL',values.get('FUMIAO_MUSE_URL',MUSE_PUBLIC_URL)).rstrip('/')
    key=os.getenv('FUMIAO_MUSE_KEY',values.get('FUMIAO_MUSE_KEY',''))
    public=os.getenv('FUMIAO_MUSE_PUBLIC_URL',values.get('FUMIAO_MUSE_PUBLIC_URL',MUSE_PUBLIC_URL)).rstrip('/')
    return base,key,public


def configuration(con):
    base,key,_=config()
    row=con.execute("SELECT value FROM settings WHERE key='muse_health'").fetchone()
    value=json.loads(row[0]) if row else {}
    return {'configured':bool(base and key),'ready':bool(value.get('ready') and time.time()-value.get('checked',0)<90),
            'image_ratios':list(IMAGE_RATIOS),'video_ratios':list(VIDEO_RATIOS),'durations':list(DURATIONS)}


class TransportError(Exception):
    def __init__(self,status=0):self.status=status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def request(path,body=None,method=None,idempotency=None):
    base,key,_=config()
    headers={'Authorization':'Bearer '+key}
    if idempotency:headers['Idempotency-Key']=idempotency
    data=None
    if body is not None:
        data=json.dumps(body,ensure_ascii=False).encode();headers['Content-Type']='application/json'
    try:
        req=urllib.request.Request(base+path,data=data,headers=headers,method=method)
        with urllib.request.build_opener(NoRedirect).open(req,timeout=120 if body is not None else 5) as response:
            raw=response.read(2*1024*1024+1)
        if len(raw)>2*1024*1024:raise ValueError('response too large')
        return json.loads(raw)
    except urllib.error.HTTPError as error:raise TransportError(error.code) from None
    except (OSError,ValueError):raise TransportError() from None


def create_job(con, body, user, kind, workspace=None):
    workspace=active_workspace(con,user,workspace=workspace)
    d=body.model_dump();model='muse-'+kind
    if d.get('model')!=model or not d['prompt'].strip():fail(400,'请检查 Muse 模型和提示词')
    ratios=IMAGE_RATIOS if kind=='image' else VIDEO_RATIOS
    if d['ratio'] not in ratios:fail(400,'Muse 不支持这个画幅选项')
    if kind=='video' and d['seconds'] not in DURATIONS:fail(400,'Muse 时长可选 5、6、8、10 秒')
    idem=f"{user['id']}-muse-{kind}-{d['uid']}"
    old=con.execute('SELECT * FROM jobs WHERE uid=?',(idem,)).fetchone()
    if old:
        require_resource(con,user,old,workspace);return {'id':old['id']}
    model_policy.require_enabled(con,model,workspace)
    total=0
    for ref in d['refs']:
        media=require_resource(con,user,con.execute("SELECT * FROM media WHERE id=? AND kind='ref'",(ref,)).fetchone(),workspace)
        total+=media['size']
    if total>100*1024*1024:fail(400,'Muse 参考图总大小不能超过 100 MB')
    if d.get('parent'):
        require_resource(con,user,con.execute('SELECT * FROM jobs WHERE id=? AND kind=?',(d['parent'],kind)).fetchone(),workspace)
    if con.execute("SELECT count(*) FROM jobs WHERE owner=? AND model IN ('muse-image','muse-video') AND status IN ('queued','running')",(user['id'],)).fetchone()[0]>=20:
        fail(429,'Muse 排队任务较多，请等待或取消部分任务')
    capacity(con,RESERVE)
    jid=con.execute('''INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,parent,status,created,updated,kind,model,image_quality,workspace)
        VALUES(?,?,?,?,?,0,?,0,0,0,?,'queued',?,?,?,?,'native',?)''',
        (idem,user['id'],d['prompt'].strip(),json.dumps(d['refs']),d['ratio'],d.get('seconds',0) if kind=='video' else 0,d.get('parent'),now(),now(),kind,model,workspace)).lastrowid
    con.execute('INSERT INTO provider_tasks(job,dispatch_key) VALUES(?,?)',(jid,uuid.uuid4().hex))
    credits.reserve(con,jid,d.get('price_revision'))
    timing.save_submission_forecast(con,jid)
    WAKE.set()
    return {'id':jid}


def payload(job):
    refs=[]
    with db() as con:
        for key in json.loads(job['refs']):
            media=con.execute('SELECT * FROM media WHERE id=? AND workspace=?',(key,job['workspace'])).fetchone()
            if not media:raise ValueError('参考图已不存在')
            refs.append('data:'+media['mime']+';base64,'+base64.b64encode(store.read(key)).decode())
    result={'model':job['model'],'prompt':re.sub(r'<Picture (\d+)>',r'[图\1]',job['prompt']),
            'aspect_ratio':job['ratio'],'images':refs}
    if job['kind']=='video':result.update(duration=job['seconds'],timeout=600)
    else:result.update(response_format='url',timeout=600)
    return result


def set_health(ready):
    with db(True) as con:
        con.execute("INSERT INTO settings VALUES('muse_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps({'ready':ready,'checked':time.time(),**SCHEDULER}),))


def ready():
    base,key,_=config()
    if not base or not key:return False
    try:
        value=request('/readyz')
        if value.get('status')!='ready' or not value.get('accounts'):return False
        # readyz is public; do not claim ready with an invalid management key.
        authenticated=bool(request('/v1/models').get('data'))
        if authenticated:
            try:
                snapshot=request('/v1/queue')
                SCHEDULER.update(capacity=max(0,min(16,int(snapshot.get('capacity',1)))),
                                 maintenance=max(0,int(snapshot.get('maintenance',0))),
                                 tasks=[{k:t.get(k) for k in ('id','status','phase','created_at','started_at','generating_at')} for t in snapshot.get('tasks',[])])
            except (TransportError,TypeError,ValueError):
                SCHEDULER.update(capacity=1,maintenance=0,tasks=[])
        return authenticated
    except TransportError:return False


def queued_note(note):
    with db(True) as con:
        con.execute("UPDATE jobs SET note=? WHERE model IN ('muse-image','muse-video') AND status='queued' AND note!=?",(note,note))


def reject(job,message):
    with db(True) as con:
        con.execute("UPDATE jobs SET status='failed',note=?,updated=? WHERE id=? AND status='running'",(message,now(),job['id']))
        con.execute("UPDATE provider_tasks SET state='failed' WHERE job=?",(job['id'],))
        timing.end_run(con,job,'failed')


def uncertain(job):
    with db(True) as con:
        timing.end_run(con,job,'interrupted')
        con.execute("UPDATE jobs SET status='failed',note='Muse 提交结果待确认，请联系管理员核对后再重试',updated=? WHERE id=?",(now(),job['id']))
        con.execute("UPDATE provider_tasks SET state='uncertain' WHERE job=?",(job['id'],))


def _media_name(url, origins):
    parsed = urllib.parse.urlsplit(url)
    if parsed.query or parsed.fragment:
        raise ValueError('Muse 返回了无效的成品地址')
    for origin in origins:
        allowed = urllib.parse.urlsplit(origin)
        if parsed.netloc and parsed.netloc != allowed.netloc:
            continue
        prefix = allowed.path.rstrip('/') + '/v1/media/'
        if parsed.path.startswith(prefix):
            name = parsed.path[len(prefix):]
            if re.fullmatch(r'[A-Za-z0-9_.-]{1,200}', name) and '..' not in name:
                return name
    raise ValueError('Muse 返回了无效的成品地址')


def download(url,job):
    base,key,public=config()
    # An in-flight task may still carry an old URL. Always download from the configured backend.
    name = _media_name(url, (base, public, LEGACY_MUSE_PUBLIC_URL))
    path=stage_dir/('muse-'+str(job['id'])+'.download')
    try:
        req=urllib.request.Request(base+'/v1/media/'+name,headers={'Authorization':'Bearer '+key})
        with urllib.request.build_opener(NoRedirect).open(req,timeout=45) as response,path.open('wb') as out:
            size=0
            while chunk:=response.read(256*1024):
                size+=len(chunk)
                if size>RESERVE:raise ValueError('Muse 成品超过 64 MB，未保存')
                out.write(chunk)
        return path
    except (urllib.error.URLError,TimeoutError,OSError):
        path.unlink(missing_ok=True);raise TransportError() from None
    except BaseException:
        path.unlink(missing_ok=True);raise


def inspect_media(path,kind):
    if kind=='image':
        with Image.open(path) as im:
            mime={'PNG':'image/png','JPEG':'image/jpeg','WEBP':'image/webp'}.get(im.format)
            if not mime or im.width*im.height>32_000_000:raise ValueError('Muse 返回的图片格式或尺寸无效')
            im.load();width,height=ImageOps.exif_transpose(im).size
        return mime,{'width':width,'height':height}
    try:
        with path.open('rb') as stream:header=stream.read(32)
        demuxer='mov' if header[4:8]==b'ftyp' else 'matroska' if header.startswith(b'\x1aE\xdf\xa3') else None
        if demuxer is None:raise ValueError()
        value=json.loads(subprocess.check_output(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-f',demuxer,'-show_streams','-show_format','-of','json',str(path)],timeout=30,stderr=subprocess.DEVNULL))
        video=next(s for s in value['streams'] if s['codec_type']=='video')
        width,height=video['width'],video['height'];seconds=float(value['format']['duration'])
        if not (0<width<=8192 and 0<height<=8192 and math.isfinite(seconds) and 0<seconds<=120):raise ValueError()
        if any(abs(float(s.get('rotation',0)))%360 for s in video.get('side_data_list',[])) or abs(float(video.get('tags',{}).get('rotate',0)))%360:raise ValueError()
        fmt=value['format']['format_name'];mime='video/mp4' if 'mp4' in fmt or 'mov' in fmt else 'video/webm' if 'webm' in fmt else None
        if mime is None:raise ValueError()
        subprocess.run(['ffmpeg','-v','error','-protocol_whitelist','file,pipe','-f',demuxer,'-i',str(path),'-map','0:v:0','-frames:v','1','-f','null','-'],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return mime,{'width':width,'height':height,'duration':round(seconds,3),'fps':video.get('avg_frame_rate')}
    except (OSError,ValueError,KeyError,StopIteration,subprocess.SubprocessError):raise ValueError('Muse 返回的视频无法验证或方向异常') from None


def complete(job,remote):
    value=remote.get('result') or {};url=remote.get('url') or value.get('url')
    if not url and remote.get('data'):url=remote['data'][0].get('url')
    if not isinstance(url,str):raise ValueError('Muse 未返回可下载的成品')
    path=download(url,job)
    key=None
    committed=False
    try:
        mime,actual=inspect_media(path,job['kind']);key=uuid.uuid4().hex;size=path.stat().st_size
        with db(True) as con:
            current=con.execute('SELECT * FROM jobs WHERE id=?',(job['id'],)).fetchone()
            if not current or current['status']!='running':return
            capacity(con,max(0,size-RESERVE))
            store.put(path,key)
            con.execute('INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)',
                        (key,'ref' if job['kind']=='image' else 'video',size,mime,actual['width'],actual['height'],job['owner'],job['workspace']))
            con.execute("UPDATE jobs SET status='done',result=?,width=?,height=?,output_metadata=?,updated=?,note='' WHERE id=?",(key,actual['width'],actual['height'],json.dumps(actual),now(),job['id']))
            con.execute("UPDATE provider_tasks SET state='done' WHERE job=?",(job['id'],))
            timing.end_run(con,job,'done')
        committed=True
    finally:
        path.unlink(missing_ok=True)
        if key and not committed:store.delete(key)


def sync_timing(con,job,remote):
    """Use provider timestamps, not polling time, to separate admission and execution."""
    run=timing.current_run(con,job['id'])
    if not run:return
    details=json.loads(run['details'] or '{}');stamp=time.time()
    def valid(value):
        return isinstance(value,(int,float)) and math.isfinite(value) and job['created']-2<=value<=stamp+2
    start=remote.get('started_at')
    if not valid(start) and remote.get('status')=='completed' and valid(remote.get('updated_at')):
        elapsed=remote.get('elapsed')
        if isinstance(elapsed,(int,float)) and math.isfinite(elapsed) and elapsed>0:
            start=max(remote.get('created_at',job['created']),remote['updated_at']-elapsed)
            details.update(source='observed',provider_elapsed=elapsed)
    if valid(start):
        start=max(job['created'],start)
        details.setdefault('admitted_at',run['started'] or remote.get('accepted_at',job['created']))
        if remote.get('started_at'):details['source']='provider'
        phase=remote.get('phase') or ('generating' if remote.get('status')=='processing' else run['phase'])
        if phase in ('completed','failed'):phase='finalizing'
        if phase not in timing.PHASES:phase='preparing'
        if run['status'] in ('done','failed','cancelled'):phase=run['phase']
        con.execute('UPDATE job_runs SET started=?,phase=?,details=? WHERE id=?',(start,phase,json.dumps(details),run['id']))
        for name,key in [('generating','generating_at'),('finalizing','finished_at')]:
            if valid(remote.get(key)):
                con.execute(f'UPDATE job_runs SET {name}=? WHERE id=?',(max(start,remote[key]),run['id']))
        # Integer timestamps in old versions only locate the start to about one second.
        if not remote.get('generating_at') and run['generating'] is not None and run['generating']<start:
            con.execute('UPDATE job_runs SET generating=NULL WHERE id=?',(run['id'],))
    elif remote.get('status')=='queued' and remote.get('phase')=='queued':
        details.setdefault('admitted_at',run['started'] or stamp)
        con.execute("UPDATE job_runs SET started=NULL,phase='queued',details=? WHERE id=?",(json.dumps(details),run['id']))


def poll(job,record):
    endpoint='/v1/images/tasks/' if job['kind']=='image' else '/v1/videos/'
    try:remote=request(endpoint+record['task_id'])
    except TransportError as error:
        if error.status==404:
            reject(job,'Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成')
        return
    with db(True) as con:sync_timing(con,job,remote)
    status=remote.get('status')
    if status in ('completed','done','succeeded','success'):
        with db(True) as con:
            timing.mark_phase(con,job,'finalizing')
            con.execute("UPDATE jobs SET note='正在保存 Muse 成品' WHERE id=?",(job['id'],))
        try:complete(job,remote)
        except TransportError:return # Download outage: keep polling the same result.
        except Exception as error:
            reject(job,str(error) if isinstance(error,ValueError) else 'Muse 成品保存失败，请检查后重新生成')
    elif status=='failed':
        # The wrapper may already have attempted a generation before losing an account.
        # A terminal upstream failure is not proof that a new POST would be free of side effects.
        reject(job,'Muse 生成未成功，请检查服务端任务记录后重新生成')
    elif status=='processing':
        with db(True) as con:
            if 'phase' not in remote:timing.mark_phase(con,job,'generating')
            note='正在准备 Muse' if remote.get('phase')=='preparing' else 'Muse 生成中'
            con.execute("UPDATE jobs SET note=? WHERE id=?",(note,job['id']))
    elif status=='queued':
        with db(True) as con:con.execute("UPDATE jobs SET note='等待 Muse 空闲账号' WHERE id=?",(job['id'],))


def tick():
    if dispatch_paused():return
    with db(True) as con:
        disabled=list(con.execute("SELECT * FROM jobs WHERE model IN ('muse-image','muse-video') AND status='queued' AND owner IN (SELECT id FROM users WHERE active=0)"))
        for job in disabled:
            timing.end_run(con,job,'cancelled')
            con.execute("UPDATE jobs SET status='cancelled',note='账户已停用',updated=? WHERE id=?",(now(),job['id']))
        running=[(dict(j),dict(con.execute('SELECT * FROM provider_tasks WHERE job=?',(j['id'],)).fetchone())) for j in con.execute("SELECT * FROM jobs WHERE model IN ('muse-image','muse-video') AND status='running'")]
    for job,record in running:
        if record['task_id']:poll(job,record)
        elif record['state']=='submitting':
            # The API has no video idempotency contract. Never blindly resubmit a lost acknowledgement.
            uncertain(job)
    available=ready();set_health(available)
    if not available:
        queued_note('等待 Muse 就绪');return
    with db() as con:
        own=[dict(r) for r in con.execute("SELECT p.task_id FROM provider_tasks p JOIN jobs j ON j.id=p.job WHERE j.status='running' AND j.model IN ('muse-image','muse-video')")]
    own_ids={r['task_id'] for r in own if r['task_id']}
    outside=sum(t['id'] not in own_ids for t in SCHEDULER.get('tasks',[]))
    capacity=max(0,SCHEDULER.get('capacity',1)-SCHEDULER.get('maintenance',0)-outside)
    for _ in range(max(0,capacity-len(own))):
        if not dispatch_one(capacity):break


def dispatch_one(capacity):
    with db(True) as con:
        if con.execute("SELECT count(*) FROM jobs WHERE model IN ('muse-image','muse-video') AND status='running'").fetchone()[0]>=capacity:return False
        setting=con.execute("SELECT value FROM settings WHERE key='openai_images'").fetchone()
        image_enabled=not setting or json.loads(setting[0]).get('enabled',True)
        row=con.execute("""SELECT j.* FROM jobs j JOIN provider_tasks p ON p.job=j.id JOIN users u ON u.id=j.owner
          WHERE j.model IN ('muse-image','muse-video') AND j.status='queued' AND u.active=1 AND p.retry_at<=?
          AND (j.kind='video' OR ?) AND """+model_policy.allowed_sql('j')+" ORDER BY j.id LIMIT 1",(time.time(),int(image_enabled))).fetchone()
        if not row:return
        job=dict(row);record=dict(con.execute('SELECT * FROM provider_tasks WHERE job=?',(job['id'],)).fetchone())
        con.execute("UPDATE jobs SET status='running',note='正在提交 Muse',attempts=attempts+1,ticket=?,updated=? WHERE id=?",(token(),now(),job['id']))
        con.execute("UPDATE provider_tasks SET state='submitting' WHERE job=?",(job['id'],))
        job=dict(con.execute('SELECT * FROM jobs WHERE id=?',(job['id'],)).fetchone());timing.start_run(con,job)
    try:body=payload(job)
    except Exception:
        reject(job,'参考图读取失败，请检查素材后重新生成');return
    try:
        remote=request('/v1/images/tasks' if job['kind']=='image' else '/v1/videos',body,idempotency=record['dispatch_key'])
        task_id=remote.get('task_id') or remote.get('id')
        if not isinstance(task_id,str) or not re.fullmatch(r'task_[a-f0-9]{20,64}',task_id):raise TransportError()
    except TransportError as error:
        with db(True) as con:
            if error.status in (401,403,429):
                timing.end_run(con,job,'interrupted')
                con.execute("UPDATE jobs SET status='queued',note='等待 Muse 就绪',updated=? WHERE id=?",(now(),job['id']))
                con.execute("UPDATE provider_tasks SET state='waiting',retry_at=? WHERE job=?",(time.time()+60,job['id']))
            elif error.status in (400,413,422):
                timing.end_run(con,job,'failed')
                con.execute("UPDATE jobs SET status='failed',note='Muse 拒绝了生成参数或参考图',updated=? WHERE id=?",(now(),job['id']))
                con.execute("UPDATE provider_tasks SET state='failed' WHERE job=?",(job['id'],))
            else:
                timing.end_run(con,job,'interrupted')
                con.execute("UPDATE provider_tasks SET state='uncertain' WHERE job=?",(job['id'],))
                con.execute("UPDATE jobs SET status='failed',note='Muse 提交结果待确认，请联系管理员核对后再重试',updated=? WHERE id=?",(now(),job['id']))
        return
    with db(True) as con:
        con.execute("UPDATE provider_tasks SET task_id=?,state='submitted' WHERE job=?",(task_id,job['id']))
        con.execute('UPDATE jobs SET provider_request=?,note=? WHERE id=?',(task_id,'等待 Muse 空闲账号',job['id']))
        sync_timing(con,job,remote)
    return True


def run_queue():
    while not STOP.is_set():
        try:
            with RUN_LOCK:tick()
        except Exception:
            # Keep queue contents intact; no credential/response body enters application logs.
            pass
        WAKE.wait(2);WAKE.clear()


def start():
    if os.getenv('FUMIAO_MUSE_AUTOSTART','1')!='1':return None
    STOP.clear();thread=threading.Thread(target=run_queue,name='muse-queue',daemon=True);thread.start();return thread


def stop(thread):
    STOP.set();WAKE.set()
    if thread:thread.join(timeout=1)
