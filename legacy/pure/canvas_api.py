"""Shared canvas documents, optimistic saves and atomic links to existing generation jobs."""
import json
import uuid
from typing import Literal
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from core import actor, db, fail, now, reap
from generation import Draft, create_video_job
from h3_inputs import H3Inputs, MediaId, MEDIA_KINDS
from image_api import ImageDraft, create_image_job, WAKE
from library_api import archive_entry, archive_ticket
from model_policy import effective
from asset_packs import PackRef, get_pack
import timing
from workspace_access import active_workspace, require_resource

router = APIRouter()
Identifier = str


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


from flow_catalog import MODELS as FLOW_MODELS

class Params(Strict):
    h3: H3Inputs | None = None
    h3_refs: list[MediaId] = Field(default_factory=list, max_length=12)
    model: str = Field(default="", max_length=180)
    flow_source_job: int | None = Field(default=None, gt=0)
    ratio: Literal['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] = '16:9'
    quality: Literal[480, 768] = 480
    seconds: int = Field(default=5,ge=0,le=15)
    seed: int | None = Field(default=None, ge=0, le=2**53-1)
    sampling_steps: Literal[16,20,32,50] = 20
    fast_mode: bool = False
    resolution: Literal['1K', '2K', '4K'] = '1K'
    image_quality: Literal['low', 'medium', 'high'] = 'medium'


class Node(Strict):
    narration_text: str = Field(default='', max_length=300)
    narration_instruction: str = Field(default='', max_length=300)
    narration_job: int | None = Field(default=None, gt=0)
    narration_pending: int | None = Field(default=None, gt=0)
    asset_packs: list[PackRef] = Field(default_factory=list, max_length=9)
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    type: Literal['text', 'image', 'video', 'sticky']
    title: str = Field(default='', max_length=80)
    x: float = Field(ge=-100000, le=100000)
    y: float = Field(ge=-100000, le=100000)
    width: float = Field(default=320, ge=160, le=1600)
    height: float = Field(default=240, ge=100, le=1600)
    text: str = Field(default='', max_length=12000)
    prompt: str = Field(default='', max_length=12000)
    color: Literal['none', 'mint', 'blue', 'purple', 'orange', 'yellow'] = 'none'
    media_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    active_job: int | None = Field(default=None, gt=0)
    use_media: bool = False
    params: Params = Field(default_factory=Params)


class Edge(Strict):
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    source: str = Field(max_length=80)
    target: str = Field(max_length=80)


class Document(Strict):
    schemaVersion: Literal[1] = 1
    nodes: list[Node] = Field(default_factory=list, max_length=200)
    edges: list[Edge] = Field(default_factory=list, max_length=600)
    shots: list[Identifier] | None = Field(default=None, max_length=200, exclude_if=lambda value: value is None)


TEMPLATES = {
    'event': ('活动宣传片', '适合社团活动、展会与校园招募', (
        ('开场', '【活动主题】场地外景，镜头从入口缓慢推进，让观众看到现场规模。'),
        ('入场', '中景跟随【参与者】进入【地点】，捕捉自然的动作与期待感。'),
        ('活动细节', '近景拍摄【道具或展品】，从前景缓慢移焦至手部动作。'),
        ('高光时刻', '用侧向移动的镜头呈现【核心环节】，画面重点落在参与者的反应。'),
        ('现场氛围', '从观众视角拍摄【互动场面】，保留前景人物和背景灯光的层次。'),
        ('结束画面', '回到【活动场地或主题物】，逐渐停稳，留出空间供后期添加活动信息。'),
    )),
    'product': ('产品展示', '适合实物介绍、功能演示与新品预告', (
        ('产品亮相', '【产品】置于简洁背景中，侧光逐渐照亮轮廓，镜头缓慢推近。'),
        ('材质特写', '微距横移展示【材质或做工】，让纹理和边缘清晰可见。'),
        ('使用准备', '中近景呈现【使用者】在【场景】中拿起产品，动作自然连贯。'),
        ('功能演示', '对准【关键操作】，清楚展示从操作到【可见效果】的过程。'),
        ('场景展示', '拉远至【典型场景】，让产品与环境保持清晰的空间关系。'),
        ('定格画面', '产品正面居中，镜头停稳，留出空间供后期添加名称或卖点。'),
    )),
    'portrait': ('人物短片', '适合人物介绍、志愿者故事与团队记录', (
        ('人物登场', '在【地点】用中景介绍【人物】，让服装、神态和环境同时进入画面。'),
        ('工作细节', '近景拍摄人物的手和【道具】，突出一项具体动作。'),
        ('环境交代', '以较宽画幅展示【人物】与【场景】的关系，镜头轻缓移动。'),
        ('关键行动', '跟随人物完成【关键行动】，保持服装和环境设定一致。'),
        ('情绪落点', '人物停下看向【对象】，镜头从侧面缓慢靠近，保留自然表情。'),
        ('离场', '从背后拍摄人物走向【方向】，镜头逐渐拉远，为片尾留出空间。'),
    )),
}


class NewProject(Strict):
    title: str = Field(default='未命名画布', min_length=1, max_length=80)
    template: Literal['event', 'product', 'portrait'] | None = None
    ratio: Literal['16:9', '9:16'] = '16:9'


class Save(Strict):
    expected_revision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=80)
    document: Document


class Revision(Strict):
    expected_revision: int = Field(ge=1)


class Run(Revision):
    price_revision: int | None = Field(default=None,ge=1)
    uid: uuid.UUID


def project(con, pid, user):
    row = con.execute('SELECT * FROM canvas_projects WHERE id=?', (pid,)).fetchone()
    if not row:
        fail(404, '画布不存在或已删除')
    require_resource(con,user,row)
    return dict(row)


def check_revision(p, expected):
    if p['revision'] != expected:
        fail(409, '画布已被其他成员修改。你的修改已保留，请重新载入或下载本地副本。')


def media_for_node(con, pid, node):
    if node.use_media:
        return node.media_id
    if node.active_job:
        row = con.execute('''SELECT j.* FROM jobs j JOIN canvas_job_links l ON j.id=l.job
            WHERE l.project=? AND l.node=? AND j.id=?''', (pid, node.id, node.active_job)).fetchone()
    else:
        row = con.execute('''SELECT j.* FROM jobs j JOIN canvas_job_links l ON j.id=l.job
            WHERE l.project=? AND l.node=? ORDER BY l.id DESC LIMIT 1''', (pid, node.id)).fetchone()
    if row:
        if row['status'] != 'done' or not row['result']:
            return None
        return row['result']
    return node.media_id


def validate_document(con, pid, document, user, workspace):
    nodes = {n.id: n for n in document.nodes}
    if len(nodes) != len(document.nodes) or len({e.id for e in document.edges}) != len(document.edges):
        fail(400, '节点或连线标识重复')
    shots = document.shots or []
    if len(set(shots)) != len(shots) or any(nid not in nodes or nodes[nid].type != 'video' for nid in shots):
        fail(400, '镜头列表只能包含不同的视频节点')
    refs = []
    for node in document.nodes:
        attached=list(node.params.h3_refs)
        if node.params.h3:
            attached += [key for key in (node.params.h3.first_frame,node.params.h3.last_frame) if key]
        for key in set(attached):
            media=con.execute('SELECT * FROM media WHERE id=?',(key,)).fetchone()
            if not media or media['kind'] not in MEDIA_KINDS:fail(400,'参考素材不存在')
            require_resource(con,user,media,workspace)
            refs.append((pid,node.id,key))
        for selected in node.asset_packs:
            get_pack(con, selected.id, user, workspace)
        if node.type in ('image','video'):
            expected={'image':('','gpt-image-2.6-sunburst','muse-image'),'video':('','MiniMax H3','muse-video')}[node.type]
            expected=expected+tuple(k for k,v in FLOW_MODELS.items() if v['kind']==node.type)
            if node.params.model not in expected:fail(400,'节点模型与生成类型不匹配')
            if node.params.model.startswith('muse-'):
                from muse_provider import IMAGE_RATIOS, VIDEO_RATIOS, DURATIONS
                if node.params.ratio not in (IMAGE_RATIOS if node.type=='image' else VIDEO_RATIOS):fail(400,'Muse 画幅选项无效')
                if node.type=='video' and node.params.seconds not in DURATIONS:fail(400,'Muse 时长选项无效')
            elif node.params.model in FLOW_MODELS:pass
            elif node.type=='video' and node.params.seconds not in (5,10,15):fail(400,'MiniMax H3 时长选项无效')
        for voice_id in {node.narration_job, node.narration_pending} - {None}:
            voice = con.execute("SELECT j.* FROM jobs j JOIN canvas_job_links l ON l.job=j.id WHERE l.project=? AND l.node=? AND j.id=? AND j.kind='audio'", (pid, 'voice:'+node.id, voice_id)).fetchone()
            if node.type != 'video' or not voice:
                fail(400, '镜头旁白任务不存在')
            require_resource(con, user, voice, workspace)
            if voice['result']:
                refs.append((pid, node.id, voice['result']))
        if node.media_id:
            m = con.execute('SELECT * FROM media WHERE id=?', (node.media_id,)).fetchone()
            if not m or node.type not in ('image', 'video') or m['kind'] != ('video' if node.type == 'video' else 'ref'):
                fail(400, '节点素材不存在或类型不匹配')
            require_resource(con,user,m,workspace)
            refs.append((pid, node.id, node.media_id))
        if node.active_job and not con.execute('''SELECT 1 FROM canvas_job_links l JOIN jobs j ON j.id=l.job
            WHERE l.project=? AND l.node=? AND j.id=? AND j.kind=? AND j.status='done' AND j.result IS NOT NULL''',
            (pid, node.id, node.active_job, node.type)).fetchone():
            fail(400, '选中的生成版本不存在')
    seen, incoming, adjacent = set(), {}, {n: [] for n in nodes}
    for edge in document.edges:
        a, b = nodes.get(edge.source), nodes.get(edge.target)
        if not a or not b or a.id == b.id or a.type not in ('text', 'image') or b.type not in ('image', 'video'):
            fail(400, '这两个节点不能建立参考连线')
        pair = (a.id, b.id)
        if pair in seen:
            fail(400, '参考连线重复')
        seen.add(pair)
        adjacent[a.id].append(b.id)
        incoming[b.id] = incoming.get(b.id, 0) + (a.type == 'image')
        if incoming[b.id] > 9:
            fail(400, '每个节点最多连接 9 张参考图片')
    visited, visiting = set(), set()
    def visit(nid):
        if nid in visiting:
            fail(400, '参考连线不能形成循环')
        if nid in visited:
            return
        visiting.add(nid)
        for dest in adjacent[nid]:
            visit(dest)
        visiting.remove(nid)
        visited.add(nid)
    for nid in nodes:
        visit(nid)
    return refs


def public_project(p, user):
    return {k: p[k] for k in ('id', 'title', 'owner', 'created', 'updated', 'revision', 'last_editor', 'workspace')} | {
        'document': json.loads(p['document']),
        'can_delete': p['owner'] == user['id'] or user['role'] == 'admin',
    }


@router.get('/api/canvases')
def listing(request: Request):
    user = actor(request)
    with db() as con:
        workspace=active_workspace(con,user,request)
        projects = []
        for row in con.execute('SELECT * FROM canvas_projects WHERE workspace=? ORDER BY updated DESC,id DESC LIMIT 200',(workspace,)):
            p = dict(row)
            doc = Document.model_validate_json(p['document'])
            covers = []
            for node in doc.nodes:
                if node.type in ('image', 'video'):
                    key = media_for_node(con, p['id'], node)
                    if key:
                        covers.append({'id': key, 'type': node.type})
                if len(covers) == 4:
                    break
            entry = public_project(p, user)
            entry.pop('document')
            entry.update(count=len(doc.nodes), covers=covers)
            projects.append(entry)
        templates = [{'id': key, 'title': title, 'description': description, 'shots': len(scenes)}
                     for key, (title, description, scenes) in TEMPLATES.items()]
        return {'projects': projects, 'templates': templates}


@router.post('/api/canvases')
def create(body: NewProject, request: Request):
    user = actor(request)
    template = TEMPLATES[body.template] if body.template else None
    title = template[0] if template and 'title' not in body.model_fields_set else body.title.strip()
    if not title:
        fail(400, '请输入画布名称')
    pid = uuid.uuid4().hex
    doc = Document()
    if template:
        doc.shots = []
        doc.nodes.append(Node(id='reference', type='image', title='共用参考图', x=0, y=0))
        for index, (name, text) in enumerate(template[2], 1):
            x = index * 400
            script = Node(id=f'script-{index}', type='text', title=f'{index:02d} · {name}提示词', x=x, y=0, text=text)
            shot = Node(id=f'shot-{index}', type='video', title=f'{index:02d} · {name}', x=x, y=330,
                        params=Params(ratio=body.ratio))
            doc.nodes.extend((script, shot))
            doc.edges.append(Edge(id=f'prompt-{index}', source=script.id, target=shot.id))
            doc.shots.append(shot.id)
    with db(True) as con:
        workspace=active_workspace(con,user,request)
        if con.execute('SELECT count(*) FROM canvas_projects WHERE workspace=?',(workspace,)).fetchone()[0] >= 200:
            fail(409, '画布数量已达 200，请先整理旧画布')
        if template:
            access = effective(con, workspace)
            model = next((name for name in ('MiniMax H3', 'muse-video',*(k for k,v in FLOW_MODELS.items() if v['kind']=='video' and v['mode'] in ('t2v','omni'))) if access.get(name)), '')
            for node in doc.nodes:
                if node.type == 'video':
                    node.params.model = model
        con.execute('INSERT INTO canvas_projects(id,title,owner,last_editor,created,updated,workspace,document) VALUES(?,?,?,?,?,?,?,?)',
                    (pid, title, user['id'], user['id'], now(), now(), workspace, doc.model_dump_json()))
        return public_project(project(con, pid, user), user)


@router.get('/api/canvases/{pid}')
def get_project(pid: str, request: Request):
    user = actor(request)
    with db() as con:
        return public_project(project(con, pid, user), user)


@router.post('/api/canvases/{pid}/shots/download')
def export_shots(pid: str, body: Revision, request: Request):
    user = actor(request)
    with db(True) as con:
        p = project(con, pid, user)
        check_revision(p, body.expected_revision)
        doc = Document.model_validate_json(p['document'])
        if not doc.shots:
            fail(400, '请先添加镜头')
        nodes = {node.id: node for node in doc.nodes}
        manifest = []
        for index, nid in enumerate(doc.shots, 1):
            key = media_for_node(con, pid, nodes[nid])
            media = con.execute("SELECT * FROM media WHERE id=? AND kind='video'", (key,)).fetchone()
            if not media:
                fail(409, f'镜头 {index:02d} 还没有可导出的视频')
            require_resource(con, user, media, p['workspace'])
            manifest.append(archive_entry(media, f'镜头-{index:03d}'))
        return archive_ticket(con, user, manifest)


@router.put('/api/canvases/{pid}/document')
def save(pid: str, body: Save, request: Request):
    user = actor(request)
    title = body.title.strip()
    if not title:
        fail(400, '请输入画布名称')
    with db(True) as con:
        p = project(con, pid, user)
        check_revision(p, body.expected_revision)
        refs = validate_document(con, pid, body.document, user, p["workspace"])
        con.execute('UPDATE canvas_projects SET title=?,document=?,revision=revision+1,updated=?,last_editor=? WHERE id=?',
                    (title, body.document.model_dump_json(), now(), user['id'], pid))
        con.execute('DELETE FROM canvas_media_refs WHERE project=?', (pid,))
        con.executemany('INSERT INTO canvas_media_refs VALUES(?,?,?)', refs)
        return {'revision': p['revision']+1, 'updated': now(), 'title': title, 'document': body.document.model_dump()}


@router.delete('/api/canvases/{pid}')
def delete(pid: str, request: Request):
    user = actor(request)
    with db(True) as con:
        p = project(con, pid, user)
        if user['role'] != 'admin' and user['id'] != p['owner']:
            fail(403, '只有创建者或管理员可以删除画布')
        con.execute("DELETE FROM storyboard_exports WHERE project=? AND state!='done'", (pid,))
        con.execute('DELETE FROM canvas_projects WHERE id=?', (pid,))
    return {'ok': True}


@router.post('/api/canvases/{pid}/duplicate')
def duplicate(pid: str, request: Request):
    user = actor(request)
    with db(True) as con:
        p = project(con, pid, user)
        if con.execute('SELECT count(*) FROM canvas_projects WHERE workspace=?',(p['workspace'],)).fetchone()[0] >= 200:
            fail(409, '画布数量已达 200，请先整理旧画布')
        doc = Document.model_validate_json(p['document'])
        for node in doc.nodes:
            if node.type in ('image', 'video'):
                node.media_id = media_for_node(con, pid, node)
                node.active_job = None
                node.use_media = True
        new_id = uuid.uuid4().hex
        con.execute('INSERT INTO canvas_projects(id,title,owner,last_editor,created,updated,document) VALUES(?,?,?,?,?,?,?)',
                    (new_id, p['title'][:75]+' 副本', user['id'], user['id'], now(), now(), doc.model_dump_json()))
        con.execute('UPDATE canvas_projects SET workspace=? WHERE id=?',(p['workspace'],new_id))
        for node in doc.nodes:
            for voice_id in {node.narration_job, node.narration_pending} - {None}:
                source = con.execute('SELECT inputs FROM canvas_job_links WHERE project=? AND node=? AND job=?', (pid,'voice:'+node.id,voice_id)).fetchone()
                if source:
                    con.execute('INSERT INTO canvas_job_links(project,node,job,owner,uid,inputs,created) VALUES(?,?,?,?,?,?,?)',
                        (new_id,'voice:'+node.id,voice_id,user['id'],str(uuid.uuid4()),source['inputs'],now()))
        refs = validate_document(con, new_id, doc, user, p['workspace'])
        con.executemany('INSERT INTO canvas_media_refs VALUES(?,?,?)', refs)
        return public_project(project(con, new_id, user), user)


@router.get('/api/canvases/{pid}/runs')
def runs(pid: str, request: Request):
    user = actor(request)
    with db(True) as con:
        project(con, pid, user)
        reap(con)
        rows = [dict(row) for row in con.execute('''SELECT l.node,l.id AS link_id,l.inputs,j.id,j.owner,j.kind,j.prompt,j.refs,
            j.status,j.result,j.note,j.output_metadata,j.width,j.height,j.created,j.updated,j.model,j.quality,j.seconds,j.sampling_steps,j.seed,j.ratio,
            j.image_quality,j.node AS worker_node,j.attempts FROM canvas_job_links l JOIN jobs j ON j.id=l.job
            WHERE l.project=? ORDER BY l.id DESC''', (pid,))]
        batches = {}
        for batch in con.execute('SELECT uid,result FROM canvas_run_batches WHERE project=?', (pid,)):
            ids = json.loads(batch['result'])['ids']
            for index,jid in enumerate(ids,1):
                batches[jid] = {'uid':batch['uid'],'index':index,'count':len(ids)}
        # Timing uses the GPU node ID, distinct from the canvas node ID.
        for row in rows:
            row['canvas_node'] = row.pop('node')
            row['node'] = row.pop('worker_node')
            row['refs'] = json.loads(row['refs'])
            row['inputs'] = json.loads(row['inputs'])
            row['batch'] = batches.get(row['id'])
            row['actual'] = json.loads(row.pop('output_metadata'))
            row['model_label'] = FLOW_MODELS.get(row['model'],{}).get('label')
        queue_context = [dict(j) for j in con.execute('SELECT * FROM jobs')]
        for job in queue_context:
            job['refs'] = json.loads(job['refs'])
        timing.attach(con, queue_context)
        estimates = {j['id']: j for j in queue_context}
        for row in rows:
            row['eta'] = estimates[row['id']].get('eta')
            row['timing'] = estimates[row['id']].get('timing')
        return {'runs': rows}


def create_canvas_run(con, p, user, nid, body, *, allow_busy=False, seed_offset=0):
    pid = p['id']
    old = con.execute('SELECT project,node,job FROM canvas_job_links WHERE owner=? AND uid=?',
                      (user['id'], str(body.uid))).fetchone()
    if old:
        if old['project'] != pid or old['node'] != nid or not old['job']:
            fail(409, '这次提交已处理，请刷新画布')
        return {'id': old['job']}
    check_revision(p, body.expected_revision)
    doc = Document.model_validate_json(p['document'])
    nodes = {n.id: n for n in doc.nodes}
    node = nodes.get(nid)
    if not node or node.type not in ('image', 'video'):
        fail(400, '请选择图片或视频节点')
    if not allow_busy and con.execute('''SELECT 1 FROM canvas_job_links l JOIN jobs j ON l.job=j.id
        WHERE l.project=? AND l.node=? AND j.status IN ('queued','running')''', (pid, nid)).fetchone():
        fail(409, '这个节点还有生成任务，请等待完成')
    texts, refs, sources = [], [], []
    for edge in doc.edges:
        if edge.target != nid:
            continue
        source = nodes[edge.source]
        if source.type == 'text':
            if not source.text.strip():
                fail(409, f'参考文本“{source.title or "文本"}”还没有内容')
            texts.append(source.text.strip())
            sources.append({'node': source.id, 'text': source.text.strip()})
        else:
            key = media_for_node(con, pid, source)
            if not key:
                fail(409, f'参考图片“{source.title or "图片"}”尚未就绪')
            if key not in refs:
                refs.append(key)
            sources.append({'node': source.id, 'media': key})
    prompt = '\n\n'.join(texts + ([node.prompt.strip()] if node.prompt.strip() else []))
    if not prompt or len(prompt) > 12000:
        fail(400, '请输入提示词或连接文本，合计不超过 12000 字')
    params = node.params
    native=params.h3 if params.model in ('','MiniMax H3') and node.type=='video' else None
    if native:
        refs=list(dict.fromkeys(key for key in (native.first_frame,native.last_frame) if key)) if native.mode=='frames' else list(dict.fromkeys(refs+params.h3_refs))
    elif params.h3_refs and params.model not in ('','MiniMax H3'):fail(400,'请先移除 H3 参考素材后切换模型生成')
    common = dict(uid=body.uid, prompt=prompt, refs=refs, ratio=params.ratio, price_revision=body.price_revision, asset_packs=node.asset_packs)
    # A separate idempotency namespace prevents an ordinary studio UID from attaching a different job.
    common['uid'] = uuid.uuid5(uuid.NAMESPACE_URL, f'fumiao:canvas:{pid}:{nid}:{body.uid}')
    if node.type == 'image':
        result = create_image_job(con, ImageDraft(**common, model=params.model or "gpt-image-2.6-sunburst", resolution=params.resolution, image_quality=params.image_quality), user, p["workspace"])
    else:
        result = create_video_job(con, Draft(**common, h3=native, model=params.model or "MiniMax H3", flow_source_job=params.flow_source_job, quality=params.quality, seconds=params.seconds, seed=(params.seed + seed_offset) % (2**53) if params.seed is not None else None,sampling_steps=20 if params.model=='muse-video' else 4 if params.fast_mode else params.sampling_steps), user, p["workspace"])
    snapshot = dict(revision=p['revision'], prompt=prompt, refs=refs, sources=sources, params=params.model_dump(), asset_packs=[p.model_dump() for p in node.asset_packs])
    con.execute('INSERT INTO canvas_job_links(project,node,job,owner,uid,inputs,created) VALUES(?,?,?,?,?,?,?)',
                (pid, nid, result['id'], user['id'], str(body.uid), json.dumps(snapshot, ensure_ascii=False), now()))
    return result


@router.post('/api/canvases/{pid}/nodes/{nid}/runs')
def generate(pid: str, nid: str, body: Run, request: Request):
    user = actor(request)
    with db(True) as con:
        result = create_canvas_run(con, project(con, pid, user), user, nid, body)
    WAKE.set()
    return result


class CandidateRun(Run):
    count: Literal[1, 2] = 1


@router.post('/api/canvases/{pid}/nodes/{nid}/candidates')
def generate_candidates(pid: str, nid: str, body: CandidateRun, request: Request):
    user = actor(request)
    with db(True) as con:
        p = project(con, pid, user)
        old = con.execute('SELECT * FROM canvas_run_batches WHERE owner=? AND uid=?',
                          (user['id'], str(body.uid))).fetchone()
        if old:
            if old['project'] != pid or old['node'] != nid or old['count'] != body.count:
                fail(409, '这次提交已处理，请刷新后重试')
            return json.loads(old['result'])
        # One write transaction reserves the full batch or rolls it all back.
        ids = []
        for index in range(body.count):
            child = Run(expected_revision=body.expected_revision, price_revision=body.price_revision,
                        uid=uuid.uuid5(body.uid, f'candidate:{index}'))
            result = create_canvas_run(con, p, user, nid, child, allow_busy=index > 0, seed_offset=index)
            ids.append(result['id'])
        total = sum(con.execute('SELECT amount FROM credit_charges WHERE job=?', (jid,)).fetchone()[0]
                    for jid in ids)
        result = {'ids': ids, 'count': body.count, 'credits': total}
        con.execute('INSERT INTO canvas_run_batches(owner,uid,project,node,count,result) VALUES(?,?,?,?,?,?)',
                    (user['id'], str(body.uid), pid, nid, body.count, json.dumps(result)))
    WAKE.set()
    return result


@router.post('/api/canvases/{pid}/nodes/{nid}/narration')
def narrate(pid: str, nid: str, body: Run, request: Request):
    from audio_api import AudioDraft, create_audio_job
    user = actor(request)
    with db(True) as con:
        p = project(con, pid, user)
        uid = str(uuid.uuid5(body.uid, 'narration'))
        old = con.execute('SELECT * FROM canvas_job_links WHERE owner=? AND uid=?', (user['id'], uid)).fetchone()
        if old:
            if old['project'] != pid or old['node'] != 'voice:'+nid or not old['job']:
                fail(409, '这次提交已处理，请刷新后重试')
            return {'id': old['job']}
        check_revision(p, body.expected_revision)
        doc = Document.model_validate_json(p['document'])
        node = next((n for n in doc.nodes if n.id == nid and n.type == 'video'), None)
        if not node or not node.narration_text.strip():
            fail(400, '请先填写镜头旁白')
        if con.execute("SELECT 1 FROM canvas_job_links l JOIN jobs j ON j.id=l.job WHERE l.project=? AND l.node=? AND j.status IN ('queued','running')", (pid, 'voice:'+nid)).fetchone():
            fail(409, '这个镜头的旁白仍在生成')
        result = create_audio_job(con, AudioDraft(uid=uuid.uuid5(body.uid, f'voice:{pid}:{nid}'),
            prompt=node.narration_text, instruction=node.narration_instruction,
            price_revision=body.price_revision), user, p['workspace'])
        con.execute('INSERT INTO canvas_job_links(project,node,job,owner,uid,inputs,created) VALUES(?,?,?,?,?,?,?)',
                    (pid, 'voice:'+nid, result['id'], user['id'], uid, json.dumps({'text':node.narration_text,'instruction':node.narration_instruction,'revision':p['revision']},ensure_ascii=False), now()))
    return result
