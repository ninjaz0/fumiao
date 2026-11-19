"""Flow media queue, shared by studio/canvas; credentials stay on the server."""
import base64
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from core import DATA, RESERVE, capacity, db, dispatch_paused, fail, now, stage_dir, store
from flow_catalog import MODELS
from workspace_access import active_workspace, require_resource
import credits
import model_policy
import timing

STOP = threading.Event()
WAKE = threading.Event()
LOCK = threading.Lock()


class FlowError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def config():
    values = {}
    path = DATA / 'flow.env'
    if path.is_file():
        for line in path.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                values[k.strip()] = v.strip().strip('\"\'')
    return (os.getenv('FUMIAO_FLOW_URL', values.get('FUMIAO_FLOW_URL', 'http://127.0.0.1:18611')).rstrip('/'),
            os.getenv('FUMIAO_FLOW_KEY', values.get('FUMIAO_FLOW_KEY', '')),
            os.getenv('FUMIAO_FLOW_PUBLIC_URL', values.get('FUMIAO_FLOW_PUBLIC_URL', 'https://backend.nvmes.com/flow')).rstrip('/'))


def configuration(con):
    base, key, _ = config()
    row = con.execute("SELECT value FROM settings WHERE key='flow_health'").fetchone()
    status = json.loads(row[0]) if row else {}
    return {'configured': bool(base and key), 'ready': bool(status.get('ready') and time.time()-status.get('checked',0)<90),
            'model_count': len(MODELS)}


def ready():
    base, key, _ = config()
    if not base or not key:
        return False
    try:
        req = urllib.request.Request(base+'/v1/models', headers={'Authorization': 'Bearer '+key})
        with urllib.request.build_opener(NoRedirect).open(req, timeout=8) as response:
            catalog = json.loads(response.read(256*1024))
        health_req=urllib.request.Request(base+'/health',headers={'Authorization':'Bearer '+key})
        with urllib.request.build_opener(NoRedirect).open(health_req,timeout=8) as response:
            health=json.loads(response.read(65536))
        result = bool(catalog.get('data') and health.get('backend_running') and health.get('has_active_tokens'))
    except (OSError, ValueError):
        result = False
    with db(True) as con:
        con.execute("INSERT INTO settings VALUES('flow_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (json.dumps({'ready':result,'checked':time.time()}),))
    return result


def create_job(con, body, user, kind, workspace=None):
    workspace = active_workspace(con, user, workspace=workspace)
    spec = MODELS.get(body.model)
    if not spec or spec['kind'] != kind or not body.prompt.strip():
        fail(400, 'Flow 模型与生成类型不匹配')
    idem = f"{user['id']}-flow-{kind}-{body.uid}"
    old = con.execute('SELECT * FROM jobs WHERE uid=?', (idem,)).fetchone()
    if old:
        require_resource(con, user, old, workspace)
        return {'id':old['id']}
    model_policy.require_enabled(con, body.model, workspace)
    if len(set(body.refs)) != len(body.refs):
        fail(400, '参考图片不能重复')
    if not spec['min_refs'] <= len(body.refs) <= spec['max_refs']:
        if not spec['max_refs']:
            fail(400, '这个 Flow 模型不接收参考图片，请移除参考图或选择图生视频模型')
        fail(400, f"这个 Flow 模型需要 {spec['min_refs']}–{spec['max_refs']} 张参考图片")
    total = 0
    for ref in body.refs:
        media = require_resource(con, user, con.execute("SELECT * FROM media WHERE id=? AND kind='ref'", (ref,)).fetchone(), workspace)
        total += media['size']
    if total > 32*1024*1024:
        fail(400, '本次 Flow 参考图总大小不能超过 32 MB')
    source_id = getattr(body, 'flow_source_job', None)
    inputs = {'source_job':None,'source_media_id':None}
    if spec['mode'] == 'extend':
        if not source_id:
            fail(400, '请选择一条已完成的 Flow 视频作为续写来源')
        source = require_resource(con, user, con.execute('SELECT * FROM jobs WHERE id=?', (source_id,)).fetchone(), workspace)
        metadata = json.loads(source['output_metadata'] or '{}')
        if source['status'] != 'done' or source['kind'] != 'video' or source['model'] not in MODELS or not metadata.get('flow_media_id'):
            fail(400, '续写来源必须是已完成并保留来源信息的 Flow 视频')
        if source['ratio'] != spec['ratio']:
            fail(400, '续写模型的画幅必须与来源视频一致')
        inputs = {'source_job':source_id,'source_media_id':metadata['flow_media_id']}
    elif source_id is not None:
        fail(400, '仅视频续写模型可以选择来源视频')
    if body.parent:
        require_resource(con, user, con.execute('SELECT * FROM jobs WHERE id=? AND kind=?',(body.parent,kind)).fetchone(), workspace)
    count = con.execute("SELECT count(*) FROM jobs WHERE owner=? AND model LIKE 'flow:%' AND status IN ('queued','running')", (user['id'],)).fetchone()[0]
    if count >= 20:
        fail(429, 'Flow 排队任务较多，请等待或取消部分任务')
    capacity(con, RESERVE)
    quality = {'2K':2048,'4K':4096}.get(spec['resolution'],0)
    metadata = {'flow_source_job':source_id} if source_id else {}
    jid = con.execute('''INSERT INTO jobs(uid,owner,prompt,refs,ratio,quality,seconds,seed,width,height,parent,status,created,updated,kind,model,image_quality,workspace,output_metadata)
        VALUES(?,?,?,?,?,?,?,0,0,0,?,'queued',?,?,?,?, 'native',?,?)''',
        (idem,user['id'],body.prompt.strip(),json.dumps(body.refs),spec['ratio'],quality,spec['seconds'],body.parent,now(),now(),kind,body.model,workspace,json.dumps(metadata))).lastrowid
    con.execute('INSERT INTO flow_tasks(job,input_json) VALUES(?,?)',(jid,json.dumps(inputs)))
    credits.reserve(con,jid,body.price_revision)
    timing.save_submission_forecast(con,jid)
    WAKE.set()
    return {'id':jid}


def payload(job, inputs):
    spec = MODELS[job['model']]
    content = [{'type':'text','text':job['prompt']}]
    with db() as con:
        for key in json.loads(job['refs']):
            media = con.execute("SELECT * FROM media WHERE id=? AND workspace=? AND kind='ref'",(key,job['workspace'])).fetchone()
            if not media:
                raise FlowError('参考图片已不存在，请重新选择')
            raw = store.read(key)
            content.append({'type':'image_url','image_url':{'url':'data:'+media['mime']+';base64,'+base64.b64encode(raw).decode()}})
    if inputs.get('source_media_id'):
        content.append({'type':'image_url','image_url':{'url':'extend://'+inputs['source_media_id']}})
    return {'model':spec['upstream'],'messages':[{'role':'user','content':content}],'stream':True}


def safe_error(status, text=''):
    message = text.lower()
    if 'public_error_unusual_activity' in message:
        return 'Google Flow 暂时拒绝生成（异常活动检查），请在官方页面核对账号状态后再试'
    if status == 401:
        return 'Flow 接口密钥失效，请管理员检查配置'
    if 'captcha' in message or 'recaptcha' in message:
        return 'Flow 验证码服务未通过，请管理员检查 YesCaptcha 配置与余额'
    if any(x in message for x in ('no available','no valid token','没有可用','无可用','token is expired')):
        return 'Flow 暂无可用账号，请管理员检查账号启用状态和 Google Flow 登录态'
    if any(x in message for x in ('quota','credit','余额','额度')):
        return 'Flow 账号额度不足或当前模型不可用，请管理员检查账号'
    if any(x in message for x in ('safety','policy','sensitive','unsafe','违规')):
        return 'Flow 未通过内容审核，请调整提示词或参考图'
    if status == 429:
        return 'Flow 请求频率受限，请稍后重新生成'
    if status in (400,403,404):
        return 'Flow 未接受当前模型或参数，请检查账号权限与所选模型'
    return 'Flow 生成失败，请稍后重试；详情可在 Flow 后台查看'


def generate(job, inputs):
    base, key, public = config()
    origin=urllib.parse.urlsplit(public)
    req = urllib.request.Request(base+'/v1/chat/completions',data=json.dumps(payload(job,inputs)).encode(),
            headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','X-Forwarded-Host':origin.netloc,'X-Forwarded-Proto':origin.scheme},method='POST')
    chunks = []; diagnostics = []; total = 0; last_progress = 0
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=600) as response:
            for raw in response:
                total += len(raw)
                if total > 8*1024*1024:
                    raise FlowError('Flow 返回内容过大，未保存结果')
                if not raw.startswith(b'data:'):
                    continue
                value = raw[5:].strip()
                if value == b'[DONE]':
                    break
                try:
                    data = json.loads(value)
                except ValueError:
                    continue
                if data.get('error'):
                    err=data['error'];message=err.get('message','') if isinstance(err,dict) else str(err)
                    raise FlowError(safe_error(502,message))
                for choice in data.get('choices',[]):
                    delta=choice.get('delta',choice.get('message',{}))
                    if isinstance(delta.get('reasoning_content'),str):diagnostics.append(delta['reasoning_content'])
                    content=delta.get('content','')
                    if isinstance(content,str):
                        chunks.append(content)
                if time.monotonic()-last_progress > 8:
                    last_progress=time.monotonic()
                    # Only local, fixed wording is shown to users; upstream bodies may include internals.
                    with db(True) as con:
                        con.execute("UPDATE jobs SET note='Flow 正在生成',updated=? WHERE id=? AND status='running'",(now(),job['id']))
                        con.execute("INSERT INTO settings VALUES('flow_health',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps({'ready':True,'checked':time.time()}),))
            text=''.join(chunks)
    except urllib.error.HTTPError as error:
        raw=error.read(65536).decode('utf-8','replace')
        raise FlowError(safe_error(error.code,raw)) from None
    except (OSError,TimeoutError):
        raise FlowError('与 Flow 的连接中断，生成结果未确认；请核对后台记录后再重新生成') from None
    video=re.search(r'<video\b[^>]*\bsrc=[\"\']([^\"\']+)',text)
    image=re.search(r'!\[[^\]]*\]\(([^\s)]+)\)',text)
    match=video if job['kind']=='video' else image
    if not match:
        # Some compatible builds return the final URL as plain text.
        urls=re.findall(r'https?://[^\s<>\"\')]+',text)
        url=urls[-1] if urls else None
        if not url:
            raise FlowError(safe_error(502,text+' '.join(diagnostics)))
    else:url=html.unescape(match.group(1))
    media_id=re.search(r'\bdata-media-id=[\"\']([A-Za-z0-9_./:-]{1,300})[\"\']',text)
    return {'url':url,'media_id':media_id.group(1) if media_id else None}


def download(url, job):
    base, key, public = config()
    parsed=urllib.parse.urlsplit(url)
    # Local cache URLs are mapped onto the configured Flow service, never arbitrary loopback URLs.
    for origin in (base,public,base.rstrip('/')+urllib.parse.urlsplit(public).path if not urllib.parse.urlsplit(base).path else base):
        allowed=urllib.parse.urlsplit(origin);prefix=allowed.path.rstrip('/')+'/tmp/'
        if parsed.netloc==allowed.netloc and parsed.path.startswith(prefix):
            name=parsed.path[len(prefix):]
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}',name) or '..' in name or parsed.query or parsed.fragment:
                raise FlowError('Flow 返回的缓存地址无效')
            target=base+'/tmp/'+name
            headers={'Authorization':'Bearer '+key}
            break
    else:
        host=(parsed.hostname or '').lower()
        if (parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443)
                or not (host in {'storage.googleapis.com','flow-content.google'} or host.endswith('.googleusercontent.com'))):
            raise FlowError('Flow 返回的媒体地址不受支持')
        target=url;headers={}
    path=stage_dir/f'flow-{job["id"]}.download'
    try:
        req=urllib.request.Request(target,headers=headers)
        with urllib.request.build_opener(NoRedirect).open(req,timeout=90) as response,path.open('wb') as out:
            size=0
            while chunk:=response.read(256*1024):
                size+=len(chunk)
                if size>RESERVE:raise FlowError('Flow 成品超过 64 MB，未保存')
                out.write(chunk)
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def complete(job,result):
    from muse_provider import inspect_media
    path=download(result['url'],job);key=None;committed=False
    try:
        try:mime,actual=inspect_media(path,job['kind'])
        except ValueError as error:raise FlowError(str(error).replace('Muse','Flow')) from None
        if result.get('media_id'):actual['flow_media_id']=result['media_id']
        old=json.loads(job['output_metadata'] or '{}')
        if old.get('flow_source_job'):actual['flow_source_job']=old['flow_source_job']
        key=uuid.uuid4().hex;size=path.stat().st_size
        with db(True) as con:
            current=con.execute('SELECT * FROM jobs WHERE id=?',(job['id'],)).fetchone()
            if not current or current['status']!='running':return
            capacity(con,max(0,size-RESERVE));store.put(path,key)
            con.execute('INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)',
                        (key,'ref' if job['kind']=='image' else 'video',size,mime,actual['width'],actual['height'],job['owner'],job['workspace']))
            con.execute("UPDATE jobs SET status='done',result=?,width=?,height=?,output_metadata=?,updated=?,note='' WHERE id=?",
                        (key,actual['width'],actual['height'],json.dumps(actual),now(),job['id']))
            con.execute("UPDATE flow_tasks SET state='done',result_json='{}' WHERE job=?",(job['id'],))
            timing.end_run(con,job,'done')
        committed=True
    finally:
        path.unlink(missing_ok=True)
        if key and not committed:store.delete(key)


def failed(job,message):
    with db(True) as con:
        con.execute("UPDATE jobs SET status='failed',note=?,updated=? WHERE id=? AND status='running'",(message,now(),job['id']))
        con.execute("UPDATE flow_tasks SET state='failed' WHERE job=?",(job['id'],))
        timing.end_run(con,job,'failed')


def tick():
    if dispatch_paused():return False
    # Reuse completed upstream output after a local save interruption; never generate it twice.
    with db() as con:
        pending=con.execute("SELECT j.*,f.result_json FROM jobs j JOIN flow_tasks f ON f.job=j.id WHERE j.status='running' AND f.state='finalizing' ORDER BY j.id LIMIT 1").fetchone()
    if pending:
        job=dict(pending)
        try:complete(job,json.loads(job['result_json']))
        except Exception:failed(job,'Flow 成品保存失败，请从后台检查生成结果')
        return True
    with db(True) as con:
        con.execute("UPDATE jobs SET status='cancelled',note='账户已停用',updated=? WHERE model LIKE 'flow:%' AND status='queued' AND owner IN (SELECT id FROM users WHERE active=0)",(now(),))
    if not ready():return False
    with db(True) as con:
        row=con.execute("SELECT j.*,f.input_json FROM jobs j JOIN flow_tasks f ON f.job=j.id WHERE j.status='queued' AND "+model_policy.allowed_sql('j')+" ORDER BY j.id LIMIT 1").fetchone()
        if not row:return False
        import worker_pool
        if worker_pool.has_ready_flow(con,row['model']):return False
        job=dict(row)
        con.execute("UPDATE jobs SET status='running',attempts=attempts+1,note='Flow 正在生成',updated=? WHERE id=?",(now(),job['id']))
        con.execute("UPDATE flow_tasks SET state='dispatching' WHERE job=?",(job['id'],))
        job=dict(con.execute('SELECT * FROM jobs WHERE id=?',(job['id'],)).fetchone())
        timing.start_run(con,job)
        inputs=json.loads(row['input_json'])
    try:
        result=generate(job,inputs)
        with db(True) as con:
            con.execute("UPDATE flow_tasks SET state='finalizing',result_json=? WHERE job=?",(json.dumps(result),job['id']))
            con.execute("UPDATE job_runs SET phase='finalizing',finalizing=? WHERE job=? AND status='running'",(time.time(),job['id']))
        complete(job,result)
    except FlowError as error:failed(job,str(error))
    except Exception:failed(job,'Flow 生成或保存失败，请从后台检查结果后重试')
    return True


def recover():
    with db(True) as con:
        rows=con.execute("SELECT j.* FROM jobs j JOIN flow_tasks f ON f.job=j.id WHERE j.status='running' AND f.state='dispatching'").fetchall()
        for row in rows:
            con.execute("UPDATE jobs SET status='failed',note='服务重启，Flow 生成结果未确认；请核对后台记录后再重新生成',updated=? WHERE id=?",(now(),row['id']))
            con.execute("UPDATE flow_tasks SET state='uncertain' WHERE job=?",(row['id'],))
            timing.end_run(con,row,'interrupted')


def run_queue():
    while not STOP.is_set():
        try:
            with LOCK:tick()
        except Exception:pass
        WAKE.wait(3);WAKE.clear()


def start():
    if os.getenv('FUMIAO_FLOW_AUTOSTART',os.getenv('FUMIAO_MUSE_AUTOSTART','1'))!='1':return None
    recover();STOP.clear();thread=threading.Thread(target=run_queue,name='flow-queue',daemon=True);thread.start();return thread


def stop(thread):
    STOP.set();WAKE.set()
    if thread:thread.join(timeout=1)
