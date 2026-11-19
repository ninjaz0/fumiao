"""Workspace reusable references; generation always stores an immutable snapshot."""
import json
import uuid
from typing import Literal
from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from core import actor, db, fail, now
from workspace_access import active_workspace, require_resource

router = APIRouter()
PURPOSES = {'subject': '人物外观', 'outfit': '服装', 'scene': '场景', 'style': '风格', 'product': '产品细节'}


class PackRef(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(pattern=r'^[a-f0-9]{32}$')
    revision: int = Field(ge=1)


class PackDraft(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=60)
    purpose: Literal['subject', 'outfit', 'scene', 'style', 'product']
    description: str = Field(default='', max_length=2000)
    media: list[str] = Field(min_length=1, max_length=9)
    expected_revision: int | None = Field(default=None, ge=1)


def get_pack(con, key, user, workspace=None):
    row = con.execute('SELECT * FROM asset_packs WHERE id=?', (key,)).fetchone()
    require_resource(con, user, row, workspace)
    return dict(row) | {'media': [m[0] for m in con.execute(
        'SELECT media FROM asset_pack_media WHERE pack=? ORDER BY position', (key,))]}


def validate_pack(con, draft, user, workspace):
    if not draft.name.strip():
        fail(400, '请输入素材包名称')
    if len(set(draft.media)) != len(draft.media):
        fail(400, '素材包中不能重复添加图片')
    for key in draft.media:
        media = con.execute("SELECT * FROM media WHERE id=? AND kind='ref'", (key,)).fetchone()
        require_resource(con, user, media, workspace)


@router.get('/api/asset-packs')
def listing(request: Request):
    user = actor(request)
    with db() as con:
        workspace = active_workspace(con, user, request)
        rows = con.execute('SELECT id FROM asset_packs WHERE workspace=? ORDER BY updated DESC,id', (workspace,)).fetchall()
        return {'packs': [get_pack(con, row['id'], user, workspace) for row in rows], 'purposes': PURPOSES}


@router.post('/api/asset-packs')
def create(body: PackDraft, request: Request):
    user = actor(request)
    with db(True) as con:
        workspace = active_workspace(con, user, request)
        validate_pack(con, body, user, workspace)
        if con.execute('SELECT count(*) FROM asset_packs WHERE workspace=?', (workspace,)).fetchone()[0] >= 200:
            fail(409, '素材包已达 200 个，请先整理')
        key = uuid.uuid4().hex
        con.execute('INSERT INTO asset_packs(id,workspace,owner,name,purpose,description,updated) VALUES(?,?,?,?,?,?,?)',
                    (key, workspace, user['id'], body.name.strip(), body.purpose, body.description.strip(), now()))
        con.executemany('INSERT INTO asset_pack_media VALUES(?,?,?)', [(key, m, i) for i, m in enumerate(body.media)])
        return get_pack(con, key, user, workspace)


@router.put('/api/asset-packs/{key}')
def update(key: str, body: PackDraft, request: Request):
    user = actor(request)
    with db(True) as con:
        current = get_pack(con, key, user, active_workspace(con, user, request))
        if body.expected_revision != current['revision']:
            fail(409, '素材包已被修改，请重新打开后编辑')
        validate_pack(con, body, user, current['workspace'])
        con.execute('UPDATE asset_packs SET name=?,purpose=?,description=?,revision=revision+1,updated=? WHERE id=?',
                    (body.name.strip(), body.purpose, body.description.strip(), now(), key))
        con.execute('DELETE FROM asset_pack_media WHERE pack=?', (key,))
        con.executemany('INSERT INTO asset_pack_media VALUES(?,?,?)', [(key, m, i) for i, m in enumerate(body.media)])
        return get_pack(con, key, user)


@router.delete('/api/asset-packs/{key}')
def delete(key: str, request: Request):
    user = actor(request)
    with db(True) as con:
        row = get_pack(con, key, user, active_workspace(con, user, request))
        if row['owner'] != user['id'] and user['role'] != 'admin':
            fail(403, '只有创建者或管理员可以删除素材包')
        if con.execute("SELECT 1 FROM canvas_projects p,json_each(p.document,'$.nodes') n,json_each(n.value,'$.asset_packs') a WHERE json_extract(a.value,'$.id')=? LIMIT 1", (key,)).fetchone():
            fail(409, '素材包正在画布中使用，请先在相关节点移除引用')
        con.execute('DELETE FROM asset_packs WHERE id=?', (key,))
    return {'ok': True}


def expand(con, draft, user, workspace):
    """Recheck selected revision and permissions, then freeze ordered media and description."""
    refs = list(draft.refs)
    prompts = [draft.prompt.strip()]
    snapshots = []
    if len({ref.id for ref in draft.asset_packs}) != len(draft.asset_packs):
        fail(400, '请勿重复引用素材包')
    for selected in draft.asset_packs:
        pack = get_pack(con, selected.id, user, workspace)
        if pack['revision'] != selected.revision:
            fail(409, f'素材包“{pack["name"]}”已更新，请重新选择后生成')
        for key in pack['media']:
            if key not in refs:
                refs.append(key)
        indexes = ', '.join(f'<Picture {refs.index(key) + 1}>' for key in pack['media'])
        prompts.append(f'{pack["name"]}（{PURPOSES[pack["purpose"]]}，{indexes}）：{pack["description"]}')
        snapshots.append({k: pack[k] for k in ('id', 'revision', 'name', 'purpose', 'description', 'media')})
    prompt = '\n\n'.join(prompts)
    if len(refs) > 9 or len(prompt) > 12000:
        fail(400, '参考图片合计最多 9 张，提示词和素材说明合计最多 12000 字')
    return draft.model_copy(update={'refs': refs, 'prompt': prompt, 'asset_packs': []}), snapshots


def freeze(con, job, snapshots):
    if snapshots:
        con.execute('UPDATE jobs SET reference_packs=? WHERE id=?', (json.dumps(snapshots, ensure_ascii=False), job))
