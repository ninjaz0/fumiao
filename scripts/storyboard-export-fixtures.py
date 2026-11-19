"""Pinned original function oracle, isolated SQLite and local synthetic media only."""
import os,sys,json,tempfile,uuid,shutil
from pathlib import Path
# Use the fixture's SQLite and disk storage even when run from a configured shell.
for key in list(os.environ):
    if key.startswith("FUMIAO_"):
        del os.environ[key]
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_MUSE_AUTOSTART='0',FUMIAO_FLOW_AUTOSTART='0',FUMIAO_PAYMENT_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'legacy/pure'))
import core,storyboard_export as api
from fastapi import HTTPException
video,voice=sys.argv[1:3]; pid='1'*32;v='2'*32;a='3'*32
with core.db(True) as con:
 con.execute("INSERT INTO users(name,role) VALUES('oracle','member')")
 user=dict(con.execute('SELECT * FROM users WHERE id=1').fetchone());wid=user['default_workspace']
 con.execute('INSERT INTO canvas_projects(id,title,owner,last_editor,created,updated,workspace) VALUES(?,\'test\',1,1,1,1,?)',(pid,wid))
 for key,path,kind,mime in [(v,video,'video','video/mp4'),(a,voice,'audio','audio/wav')]:
  core.store.path(key).write_bytes(Path(path).read_bytes());con.execute('INSERT INTO media(id,kind,size,mime,owner,workspace) VALUES(?,?,?,?,1,?)',(key,kind,Path(path).stat().st_size,mime,wid))
api.actor=lambda request:user
cases=[]
def attempt(document,revision=1):
 with core.db(True) as con:con.execute('UPDATE canvas_projects SET document=? WHERE id=?',(json.dumps(document),pid))
 try:api.create(pid,api.ExportDraft(uid=uuid.uuid4(),expected_revision=revision),None);cases.append({'status':200})
 except HTTPException as e:cases.append({'status':e.status_code,'error':e.detail})
node=dict(id='shot',type='video',title='镜头',x=0,y=0,use_media=True,media_id=v)
def doc(n=node):return dict(nodes=[n],edges=[],shots=['shot'])
attempt(doc(),2);attempt(dict(nodes=[],edges=[],shots=[]));attempt(doc(dict(node,media_id=None)));attempt(doc(dict(node,narration_text='旁白')))
# Real compose shares the exact same source files with the TypeScript fixture.
folder=Path(sandbox.name)/'compose';folder.mkdir()
result,srt,size,seconds=api.compose([dict(node='shot',title='镜头',video=v,voice=a,text='你好。😀!')],folder)
print(json.dumps(dict(cases=cases,srt=srt,size=size,seconds=seconds),ensure_ascii=False))
