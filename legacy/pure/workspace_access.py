"""Workspace ownership and access. Personal contents never inherit administrator access."""
import time
from fastapi import HTTPException


def migrate(con):
    con.execute('''CREATE TABLE IF NOT EXISTS workspaces(
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('personal','team')),
        name TEXT NOT NULL, owner INTEGER REFERENCES users, created INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        CHECK((kind='personal' AND owner IS NOT NULL) OR (kind='team' AND owner IS NULL)))''')
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS personal_workspace_owner ON workspaces(owner) WHERE kind='personal'")
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS team_workspace_name ON workspaces(name COLLATE NOCASE) WHERE kind='team'")
    con.execute('''CREATE TABLE IF NOT EXISTS workspace_members(
        workspace INTEGER NOT NULL REFERENCES workspaces ON DELETE CASCADE,
        user INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, PRIMARY KEY(workspace,user))''')
    for table in ('media', 'jobs', 'canvas_projects'):
        if 'workspace' not in {r['name'] for r in con.execute(f'PRAGMA table_info({table})')}:
            con.execute(f'ALTER TABLE {table} ADD COLUMN workspace INTEGER REFERENCES workspaces')
        con.execute(f'CREATE INDEX IF NOT EXISTS {table}_workspace ON {table}(workspace)')
    if 'default_workspace' not in {r['name'] for r in con.execute('PRAGMA table_info(users)')}:
        con.execute('ALTER TABLE users ADD COLUMN default_workspace INTEGER REFERENCES workspaces')
    if not con.execute("SELECT 1 FROM settings WHERE key='workspaces_migrated_v1'").fetchone():
        team = con.execute("INSERT INTO workspaces(kind,name,created) VALUES('team','默认团队',?)", (int(time.time()),)).lastrowid
        con.execute('INSERT INTO workspace_members SELECT ?,id FROM users', (team,))
        for table in ('media','jobs','canvas_projects'):
            con.execute(f'UPDATE {table} SET workspace=? WHERE workspace IS NULL', (team,))
        con.execute('UPDATE users SET default_workspace=?', (team,))
        con.execute("INSERT INTO settings VALUES('workspaces_migrated_v1',?)", (str(team),))
    con.execute("INSERT OR IGNORE INTO workspaces(kind,name,owner,created) SELECT 'personal','个人空间',id,? FROM users", (int(time.time()),))
    con.execute("UPDATE users SET default_workspace=(SELECT id FROM workspaces WHERE kind='personal' AND owner=users.id) WHERE default_workspace IS NULL")
    con.execute('''CREATE TRIGGER IF NOT EXISTS user_personal_workspace AFTER INSERT ON users BEGIN
        INSERT INTO workspaces(kind,name,owner,created) VALUES('personal','个人空间',NEW.id,unixepoch());
        UPDATE users SET default_workspace=(SELECT id FROM workspaces WHERE kind='personal' AND owner=NEW.id) WHERE id=NEW.id;
        END''')
    # Legacy/internal inserts fail closed into the creator's personal space.
    for table in ('media','jobs','canvas_projects'):
        con.execute(f'''CREATE TRIGGER IF NOT EXISTS {table}_personal_workspace AFTER INSERT ON {table}
            WHEN NEW.workspace IS NULL BEGIN
            UPDATE {table} SET workspace=(SELECT id FROM workspaces WHERE kind='personal' AND owner=NEW.owner) WHERE id=NEW.id;
            END''')


def allowed(con, user, workspace):
    if workspace is None:
        return False
    row = con.execute('SELECT * FROM workspaces WHERE id=?', (workspace,)).fetchone()
    if not row:
        return False
    if row['kind'] == 'personal':
        return row['owner'] == user['id']
    return user['role'] == 'admin' or bool(con.execute('SELECT 1 FROM workspace_members WHERE workspace=? AND user=?', (workspace,user['id'])).fetchone())


def require_workspace(con, user, workspace):
    if not allowed(con, user, workspace):
        raise HTTPException(403, '无法访问这个工作区')
    return dict(con.execute('SELECT * FROM workspaces WHERE id=?', (workspace,)).fetchone())


def personal(con, user):
    return con.execute("SELECT id FROM workspaces WHERE kind='personal' AND owner=?", (user['id'],)).fetchone()['id']


def active_workspace(con, user, request=None, workspace=None):
    chosen = workspace
    if chosen is None and request is not None:
        chosen = request.headers.get('x-workspace-id') or request.query_params.get('workspace')
    if chosen is not None:
        try:
            chosen = int(chosen)
        except (TypeError,ValueError):
            raise HTTPException(400, '工作区标识无效')
        return require_workspace(con, user, chosen)['id']
    chosen = con.execute('SELECT default_workspace FROM users WHERE id=?', (user['id'],)).fetchone()[0]
    return chosen if allowed(con,user,chosen) else personal(con,user)


def require_resource(con, user, row, workspace=None):
    if row is None or not allowed(con,user,row['workspace']) or (workspace is not None and row['workspace'] != workspace):
        raise HTTPException(404, '内容不存在或无权访问')
    return row


def visible_workspaces(con, user):
    rows = con.execute('''SELECT w.*, (SELECT count(*) FROM workspace_members m JOIN users u ON m.user=u.id
        WHERE m.workspace=w.id AND u.active=1 AND u.deleted_at IS NULL) AS member_count
        FROM workspaces w WHERE (w.kind='personal' AND w.owner=?) OR (w.kind='team' AND
        (?='admin' OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace=w.id AND m.user=?)))
        ORDER BY CASE w.kind WHEN 'personal' THEN 0 ELSE 1 END,w.id''', (user['id'],user['role'],user['id']))
    result=[]
    for row in rows:
        entry=dict(row)
        if user['role']=='admin' and row['kind']=='team':
            entry['members']=[r[0] for r in con.execute('SELECT user FROM workspace_members WHERE workspace=? ORDER BY user',(row['id'],))]
        result.append(entry)
    return result
