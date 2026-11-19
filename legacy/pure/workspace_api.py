"""Administrator-managed team workspaces and per-user workspace selection."""
import sqlite3
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from core import actor, admin, db, fail, now
from workspace_access import active_workspace, require_workspace, visible_workspaces
router=APIRouter()


class Team(BaseModel):
    name: str = Field(min_length=1,max_length=40)
    members: list[int] = Field(default_factory=list,max_length=500)


class EditTeam(Team):
    expected_revision: int = Field(ge=1)


def validate(con, body):
    name=body.name.strip()
    if not name:
        fail(400,'请输入团队名称')
    members=sorted(set(body.members))
    for uid in members:
        if not con.execute('SELECT 1 FROM users WHERE id=? AND active=1 AND deleted_at IS NULL',(uid,)).fetchone():
            fail(400,'部分成员已停用或删除，请刷新后重试')
    return name,members


@router.get('/api/workspaces')
def listing(request: Request):
    user=actor(request)
    with db() as con:
        return {'workspaces':visible_workspaces(con,user),'workspace_id':active_workspace(con,user)}


@router.post('/api/workspaces')
def create(body: Team, request: Request):
    user=admin(request)
    with db(True) as con:
        name,members=validate(con,body)
        try:
            wid=con.execute("INSERT INTO workspaces(kind,name,created) VALUES('team',?,?)",(name,now())).lastrowid
        except sqlite3.IntegrityError:
            fail(409,'团队名称已存在')
        con.executemany('INSERT INTO workspace_members VALUES(?,?)',[(wid,uid) for uid in members])
        return next(w for w in visible_workspaces(con,user) if w['id']==wid)


@router.patch('/api/workspaces/{wid}')
def edit(wid:int, body:EditTeam, request:Request):
    user=admin(request)
    with db(True) as con:
        space=require_workspace(con,user,wid)
        if space['kind']!='team':fail(400,'个人空间不能分配成员')
        if space['revision']!=body.expected_revision:fail(409,'团队信息已更新，请重新打开后修改')
        name,members=validate(con,body)
        try:
            con.execute('UPDATE workspaces SET name=?,revision=revision+1 WHERE id=?',(name,wid))
        except sqlite3.IntegrityError:
            fail(409,'团队名称已存在')
        con.execute('DELETE FROM workspace_members WHERE workspace=?',(wid,))
        con.executemany('INSERT INTO workspace_members VALUES(?,?)',[(wid,uid) for uid in members])
        return next(w for w in visible_workspaces(con,user) if w['id']==wid)


@router.post('/api/workspaces/{wid}/select')
def select(wid:int, request:Request):
    user=actor(request)
    with db(True) as con:
        require_workspace(con,user,wid)
        con.execute('UPDATE users SET default_workspace=? WHERE id=?',(wid,user['id']))
    return {'workspace_id':wid}
