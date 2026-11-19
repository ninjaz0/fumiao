import uuid
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StrictInt
import credits
from core import admin, actor, db
from workspace_access import active_workspace

router=APIRouter()

class Prices(BaseModel):
    values: dict[str, StrictInt | None]
    expected_revision: int = Field(ge=1)

class Adjustment(BaseModel):
    workspace: int
    amount: StrictInt
    note: str = Field(min_length=1,max_length=200)
    uid: uuid.UUID

@router.put('/api/settings/prices')
def pricing(body:Prices,request:Request):
    admin(request)
    with db(True) as con:return credits.save_prices(con,body.values,body.expected_revision)

@router.get('/api/credits')
def listing(request:Request,before:int|None=None):
    user=actor(request)
    with db() as con:
        wid=active_workspace(con,user,request)
        return {'wallet':credits.wallet(con,wid),'history':credits.history(con,wid,before)}

@router.get('/api/admin/credits')
def accounts(request:Request,workspace:int|None=None,before:int|None=None):
    admin(request)
    with db() as con:
        rows=credits.accounts(con)
        return {'accounts':rows,'history':credits.history(con,workspace,before) if workspace else []}

@router.post('/api/admin/credits/adjust')
def adjustment(body:Adjustment,request:Request):
    user=admin(request)
    with db(True) as con:return credits.adjust(con,body.workspace,body.amount,body.note,str(body.uid),user['id'])
