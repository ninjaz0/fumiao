"""Workspace-scoped conversations, credit-safe turns and explicit canvas adoption."""
import asyncio,json,re,time,uuid
from typing import Literal
import httpx
from fastapi import APIRouter,Request,HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel,ConfigDict,Field
from core import actor,admin,db,fail,now
from workspace_access import active_workspace,require_resource
from chat_models import CHAT_MODELS,PROVIDERS
import chat_storage as storage
import chat_runtime as runtime
import credits,model_policy

router=APIRouter()
class Strict(BaseModel):model_config=ConfigDict(extra='forbid')
class Context(Strict):
    project:str=Field(max_length=80)
    node:str=Field(max_length=80)
    expected_revision:int=Field(ge=1)
    writeback:bool=False
class New(Strict):
    model:str=Field(default='deepseek-flash',max_length=80)
    context:Context|None=None
class Rename(Strict):
    title:str=Field(min_length=1,max_length=80)
    expected_revision:int=Field(ge=1)
class Send(Strict):
    uid:uuid.UUID
    model:str=Field(max_length=80)
    text:str=Field(default='',max_length=12000)
    expected_revision:int=Field(ge=1)
    price_revision:int=Field(ge=1)
    retry:int|None=Field(default=None,gt=0)
    context:Context|None=None
class Apply(Strict):
    uid:uuid.UUID
    message:int=Field(gt=0)
    project:str=Field(max_length=80)
    expected_revision:int=Field(ge=1)
    mode:Literal['new','replace']='new'
    node:str=Field(default='',max_length=80)
    expected_text:str=Field(default='',max_length=12000)
class Key(Strict):key:str=Field(pattern=r'^sk-[A-Za-z0-9_-]{16,512}$')


def access(con,user,request,cid,deleted=False):
    return storage.require_chat(con,user,cid,active_workspace(con,user,request),deleted)


def canvas_context(con,user,wid,context):
    if context is None:return {}
    from canvas_api import project,check_revision
    p=project(con,context.project,user);require_resource(con,user,p,wid);check_revision(p,context.expected_revision)
    node=next((n for n in json.loads(p['document'])['nodes'] if n['id']==context.node),None)
    if not node or node['type'] not in ('text','sticky'):fail(409,'这个文本节点已被删除或修改')
    return {'project':p['id'],'node':node['id'],'title':node['title'],'text':node['text'],'writeback':context.writeback}


def snapshot(con,chat,user):
    return {'conversation':storage.public_chat(con,chat,user),'messages':storage.messages(con,chat['id'])}


@router.get('/api/chat/config')
def config(request:Request):
    user=actor(request)
    with db() as con:
        wid=active_workspace(con,user,request);flags=model_policy.effective(con,wid)
        return {'models':{k:v for k,v in CHAT_MODELS.items() if flags.get(k) and runtime.key(v['provider'])},'pricing':credits.prices(con),'credits':credits.wallet(con,wid)}


@router.get('/api/chats')
def listing(request:Request,project:str='',node:str=''):
    user=actor(request)
    with db() as con:
        wid=active_workspace(con,user,request)
        rows=con.execute('''SELECT c.* FROM conversations c WHERE workspace=? AND deleted_at IS NULL
          AND (?='' OR EXISTS(SELECT 1 FROM canvas_chat_links l WHERE l.conversation=c.id AND l.project=? AND l.node=?))
          ORDER BY updated DESC LIMIT 200''',(wid,project,project,node)).fetchall()
        return {'conversations':[storage.public_chat(con,dict(r),user) for r in rows]}


@router.post('/api/chats')
def create(body:New,request:Request):
    user=actor(request)
    if body.model not in CHAT_MODELS:fail(400,'未知对话模型')
    cid=uuid.uuid4().hex;stamp=time.time()
    with db(True) as con:
        wid=active_workspace(con,user,request);ctx=canvas_context(con,user,wid,body.context)
        if con.execute('SELECT count(*) FROM conversations WHERE workspace=? AND deleted_at IS NULL',(wid,)).fetchone()[0]>=500:fail(409,'对话数量已达 500，请先整理旧对话')
        con.execute('INSERT INTO conversations(id,workspace,owner,model,created,updated) VALUES(?,?,?,?,?,?)',(cid,wid,user['id'],body.model,stamp,stamp))
        if ctx:con.execute('INSERT INTO canvas_chat_links VALUES(?,?,?,?)',(ctx['project'],ctx['node'],cid,stamp))
        return snapshot(con,access(con,user,request,cid),user)


@router.get('/api/chats/{cid}')
def get(cid:str,request:Request):
    user=actor(request)
    with db() as con:return snapshot(con,access(con,user,request,cid),user)


@router.patch('/api/chats/{cid}')
def rename(cid:str,body:Rename,request:Request):
    user=actor(request)
    if not body.title.strip():fail(400,'请输入对话名称')
    with db(True) as con:
        chat=access(con,user,request,cid)
        if body.expected_revision!=chat['revision']:fail(409,'对话已更新，请重试')
        con.execute('UPDATE conversations SET title=?,custom_title=1,revision=revision+1 WHERE id=?',(body.title.strip(),cid))
        return snapshot(con,access(con,user,request,cid),user)


@router.delete('/api/chats/{cid}')
def delete(cid:str,request:Request):
    user=actor(request)
    with db(True) as con:
        chat=access(con,user,request,cid)
        if user['id']!=chat['owner'] and user['role']!='admin':fail(403,'只有创建者或管理员可以删除对话')
        if con.execute("SELECT 1 FROM chat_turns WHERE conversation=? AND state='running'",(cid,)).fetchone():fail(409,'请先停止回复，再删除对话')
        con.execute('UPDATE conversations SET deleted_at=?,revision=revision+1 WHERE id=?',(time.time(),cid))
    return {'ok':True}


@router.post('/api/chats/{cid}/restore')
def restore(cid:str,request:Request):
    user=actor(request)
    with db(True) as con:
        chat=access(con,user,request,cid,True)
        if user['id']!=chat['owner'] and user['role']!='admin':fail(403,'无法恢复对话')
        con.execute('UPDATE conversations SET deleted_at=NULL,revision=revision+1 WHERE id=?',(cid,))
        return snapshot(con,access(con,user,request,cid),user)


@router.post('/api/chats/{cid}/messages')
async def send(cid:str,body:Send,request:Request):
    user=actor(request);uid=str(body.uid);tid=uuid.uuid4().hex
    with db(True) as con:
        chat=access(con,user,request,cid)
        previous=con.execute('SELECT * FROM chat_turns WHERE uid=?',(uid,)).fetchone()
        if previous:
            original=con.execute('SELECT content FROM chat_messages WHERE id=?',(previous['user_message'],)).fetchone()[0]
            if previous['owner']!=user['id'] or previous['conversation']!=cid or previous['model']!=body.model or (not body.retry and original!=body.text.strip()):fail(409,'发送标识已使用')
            return snapshot(con,chat,user)
        if chat['revision']!=body.expected_revision:fail(409,'其他成员已更新这段对话，已为你载入最新内容，请再次发送')
        if body.model not in CHAT_MODELS:fail(400,'未知对话模型')
        model_policy.require_enabled(con,body.model,chat['workspace'])
        if not runtime.key(CHAT_MODELS[body.model]['provider']):fail(409,'这个对话服务尚未配置')
        if con.execute("SELECT 1 FROM chat_turns WHERE conversation=? AND state='running'",(cid,)).fetchone():fail(409,'这段对话正在回复，请等待完成')
        if con.execute("SELECT count(*) FROM chat_turns WHERE owner=? AND state='running'",(user['id'],)).fetchone()[0]>=3:fail(429,'最多同时进行 3 段对话')
        if con.execute("SELECT count(*) FROM chat_turns WHERE state='running'").fetchone()[0]>=20:fail(429,'对话服务繁忙，请稍后重试')
        if con.execute('SELECT count(*) FROM chat_messages WHERE conversation=?',(cid,)).fetchone()[0]>=1000:fail(409,'这段对话已很长，请新建对话')
        stamp=time.time();ctx=canvas_context(con,user,chat['workspace'],body.context)
        if body.retry:
            last=con.execute('SELECT * FROM chat_messages WHERE conversation=? AND superseded=0 ORDER BY id DESC LIMIT 1',(cid,)).fetchone()
            if not last or last['id']!=body.retry or last['role']!='assistant' or last['state'] not in ('failed','stopped','interrupted'):fail(409,'只能重试最后一条未完成的回复')
            mid=last['reply_to'];con.execute('UPDATE chat_messages SET superseded=1 WHERE id=?',(last['id'],))
        else:
            text=body.text.strip()
            if not text:fail(400,'请输入消息')
            mid=con.execute("INSERT INTO chat_messages(conversation,role,author,content,state,created,context) VALUES(?,'user',?,?,'complete',?,?)",(cid,user['id'],text,stamp,json.dumps(ctx,ensure_ascii=False))).lastrowid
        aid=con.execute("INSERT INTO chat_messages(conversation,role,content,state,model,created,reply_to) VALUES(?,'assistant','','running',?,?,?)",(cid,body.model,stamp,mid)).lastrowid
        con.execute("INSERT INTO chat_turns(id,uid,conversation,owner,user_message,assistant_message,model,state,created,updated) VALUES(?,?,?,?,?,?,?,'running',?,?)",(tid,uid,cid,user['id'],mid,aid,body.model,stamp,stamp))
        storage.reserve(con,tid,chat['workspace'],user['id'],body.model,body.price_revision)
        title=chat['title'] if chat['custom_title'] or chat['title']!='新对话' or body.retry else re.sub(r'\s+',' ',body.text.strip())[:32]
        con.execute('UPDATE conversations SET title=?,model=?,updated=?,revision=revision+1 WHERE id=?',(title,body.model,stamp,cid))
        result=snapshot(con,access(con,user,request,cid),user)
    runtime.start(tid)
    return result


@router.post('/api/chats/{cid}/stop')
async def stop(cid:str,request:Request):
    user=actor(request)
    with db(True) as con:
        access(con,user,request,cid)
        row=con.execute("SELECT * FROM chat_turns WHERE conversation=? AND state='running'",(cid,)).fetchone()
        if row:storage.finish(con,row['id'],'stopped')
        result=snapshot(con,access(con,user,request,cid),user)
    if row and row['id'] in runtime.TASKS:runtime.TASKS[row['id']].cancel()
    return result


@router.get('/api/chats/{cid}/events')
async def events(cid:str,request:Request):
    user=actor(request)
    with db() as con:access(con,user,request,cid)
    async def stream():
        previous='';heartbeat=time.monotonic()
        while not await request.is_disconnected():
            try:
                current=actor(request)
                with db() as con:value=snapshot(con,access(con,current,request,cid),current)
            except HTTPException:
                yield 'event: unavailable\ndata: {}\n\n';return
            data=json.dumps(value,ensure_ascii=False)
            if data!=previous:
                yield 'data: '+data+'\n\n';previous=data;heartbeat=time.monotonic()
            elif time.monotonic()-heartbeat>15:yield ': keepalive\n\n';heartbeat=time.monotonic()
            await asyncio.sleep(.35)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'X-Accel-Buffering':'no','Cache-Control':'no-cache'})


@router.post('/api/chats/{cid}/apply')
def apply(cid:str,body:Apply,request:Request):
    from canvas_api import project,check_revision,Document,Node,validate_document,public_project
    user=actor(request)
    with db(True) as con:
        chat=access(con,user,request,cid);p=project(con,body.project,user);require_resource(con,user,p,chat['workspace'])
        old=con.execute('SELECT * FROM chat_applications WHERE uid=?',(str(body.uid),)).fetchone()
        if old:
            if (old['owner'],old['conversation'],old['message'],old['project'],old['mode'])!=(user['id'],cid,body.message,body.project,body.mode):fail(409,'该采用标识已使用')
            return public_project(p,user)|{'applied_node':old['node']}
        check_revision(p,body.expected_revision)
        m=con.execute("SELECT * FROM chat_messages WHERE id=? AND conversation=? AND role='assistant' AND state='complete'",(body.message,cid)).fetchone()
        if not m:fail(409,'请等待回复完成后再采用')
        if len(m['content'])>12000:fail(400,'回复超过单个文本节点的长度上限，请让 AI 缩短后再采用')
        doc=Document.model_validate_json(p['document']);target=next((n for n in doc.nodes if n.id==body.node),None)
        if body.mode=='replace':
            if not target or target.type not in ('text','sticky'):fail(409,'文本节点已不存在')
            if target.text!=body.expected_text:fail(409,'节点文字已经更新，请重新查看后再采用')
            target.text=m['content'];nid=target.id
        else:
            nid=uuid.uuid4().hex
            x=min(99000,(target.x+target.width+48) if target else (max((n.x+n.width for n in doc.nodes),default=-368)+48))
            doc.nodes.append(Node(id=nid,type='text',title='AI 写作',text=m['content'],x=x,y=target.y if target else 0,width=360,height=320))
        doc=Document.model_validate(doc.model_dump());refs=validate_document(con,p['id'],doc,user,p['workspace'])
        con.execute('UPDATE canvas_projects SET document=?,revision=revision+1,updated=?,last_editor=? WHERE id=?',(doc.model_dump_json(),now(),user['id'],p['id']))
        con.execute('DELETE FROM canvas_media_refs WHERE project=?',(p['id'],));con.executemany('INSERT INTO canvas_media_refs VALUES(?,?,?)',refs)
        con.execute('INSERT OR IGNORE INTO canvas_chat_links VALUES(?,?,?,?)',(p['id'],nid,cid,time.time()))
        con.execute('INSERT INTO chat_applications VALUES(?,?,?,?,?,?,?,?)',(str(body.uid),user['id'],cid,m['id'],p['id'],nid,body.mode,time.time()))
        return public_project(project(con,p['id'],user),user)|{'applied_node':nid}


@router.get('/api/admin/chat')
def admin_config(request:Request):
    admin(request)
    return {'providers':{p:{'label':v['label'],'configured':bool(runtime.key(p))} for p,v in PROVIDERS.items()}}


@router.put('/api/admin/chat/{provider}')
async def configure(provider:str,request:Request):
    admin(request)
    try:body=Key.model_validate(await request.json())
    except ValueError:fail(400,'密钥格式无效')
    if provider not in PROVIDERS:fail(404,'未知服务')
    runtime.save_key(provider,body.key)
    return {'configured':True}


@router.post('/api/admin/chat/{provider}/test')
async def test_provider(provider:str,request:Request):
    admin(request)
    if provider not in PROVIDERS:fail(404,'未知服务')
    secret=runtime.key(provider)
    if not secret:fail(409,'请先配置密钥')
    try:
        async with httpx.AsyncClient(timeout=15,trust_env=False) as client:
            r=await client.get(PROVIDERS[provider]['models_url'],headers={'Authorization':'Bearer '+secret})
            ids={m['id'] for m in r.json().get('data',[])} if r.status_code==200 else set()
            if not ids:fail(502,'连接未通过，请检查密钥与服务状态')
            if not any(k in ids for k,v in CHAT_MODELS.items() if v['provider']==provider):fail(502,'连接成功，但当前密钥不可使用所选模型')
    except httpx.HTTPError:fail(502,'连接超时或服务不可用')
    return {'ok':True}
