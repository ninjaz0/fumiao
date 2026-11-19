"""Explicit shared-team fixture for tests written for the original shared library."""
def share_workspace(*clients):
    import core
    users=[c.get('/api/state').json()['me']['id'] for c in clients]
    with core.db(True) as con:
        wid=int(con.execute("SELECT value FROM settings WHERE key='workspaces_migrated_v1'").fetchone()[0])
        con.executemany('INSERT OR IGNORE INTO workspace_members VALUES(?,?)',[(wid,uid) for uid in users])
    for c in clients:c.headers['X-Workspace-Id']=str(wid)
    return wid
