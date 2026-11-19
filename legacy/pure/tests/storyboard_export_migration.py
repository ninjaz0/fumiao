"""Upgrade the pre-release composition FK contract without dropping outputs/captions."""
import os,sys,tempfile
from pathlib import Path
sandbox=tempfile.TemporaryDirectory();os.environ['FUMIAO_DATA']=sandbox.name
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core
with core.db(True) as con:
 con.execute("INSERT INTO users(name,role) VALUES('migration','member')")
 wid=con.execute("SELECT id FROM workspaces WHERE kind='personal' AND owner=1").fetchone()[0]
 con.execute("INSERT INTO canvas_projects(id,title,owner,last_editor,created,updated,workspace) VALUES('p','source',1,1,1,1,?)",(wid,))
 con.execute("INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES('m','video',1,'video/mp4',2,2,1,?)",(wid,))
 con.execute("INSERT INTO storyboard_exports(id,uid,owner,workspace,project,revision,snapshot,state,result,subtitles,created,updated) VALUES('e','u',1,?,'p',2,'[]','done','m','saved captions',1,2)",(wid,))
con=core.connect();con.execute('PRAGMA foreign_keys=OFF');con.execute('BEGIN')
schema=core.SCHEMA.split('CREATE TABLE IF NOT EXISTS storyboard_exports(',1)[1].split(');',1)[0].replace('project TEXT REFERENCES canvas_projects ON DELETE SET NULL','project TEXT NOT NULL REFERENCES canvas_projects ON DELETE CASCADE').replace('result TEXT REFERENCES media ON DELETE CASCADE','result TEXT REFERENCES media ON DELETE SET NULL')
con.execute('CREATE TABLE old_exports('+schema+')');con.execute('INSERT INTO old_exports SELECT * FROM storyboard_exports');con.execute('DROP TABLE storyboard_exports');con.execute('ALTER TABLE old_exports RENAME TO storyboard_exports');con.commit();con.close()
core.init_db();core.init_db()
with core.db(True) as con:
 row=con.execute('SELECT * FROM storyboard_exports').fetchone();assert row['subtitles']=='saved captions' and row['result']=='m'
 con.execute("DELETE FROM canvas_projects WHERE id='p'")
 assert con.execute('SELECT project FROM storyboard_exports').fetchone()[0] is None
 con.execute("DELETE FROM media WHERE id='m'")
 assert con.execute('SELECT count(*) FROM storyboard_exports').fetchone()[0]==0
 assert not con.execute('PRAGMA foreign_key_check').fetchall()
print('PASS repeated legacy composition migration, preserved captions, detached source canvas and cascading output deletion')
