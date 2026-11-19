"""Reusable registration codes and atomic signup benefits. Legacy links are retired."""
import secrets
import time
from fastapi import HTTPException


def migrate(con):
    # Keep old columns for historical records; no registration path consumes them.
    columns = {r['name'] for r in con.execute('PRAGMA table_info(invites)')}
    for name, definition in [('uses', 'INTEGER NOT NULL DEFAULT 0'), ('limit_uses', 'INTEGER NOT NULL DEFAULT 1'), ('teams', "TEXT NOT NULL DEFAULT '[]'")]:
        if name not in columns:
            con.execute(f'ALTER TABLE invites ADD COLUMN {name} {definition}')
    con.execute('''CREATE TABLE IF NOT EXISTS registration_codes(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
        expires INTEGER, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        grant_credits INTEGER NOT NULL DEFAULT 0 CHECK(grant_credits IN (0,1)),
        initial_credits INTEGER NOT NULL DEFAULT 0 CHECK(initial_credits BETWEEN 0 AND 1000000000),
        team_id INTEGER REFERENCES workspaces,
        uses INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users,
        created INTEGER NOT NULL DEFAULT (unixepoch()), revision INTEGER NOT NULL DEFAULT 1
    )''')
    con.execute('''CREATE TABLE IF NOT EXISTS registration_redemptions(
        user INTEGER PRIMARY KEY REFERENCES users,
        invitation INTEGER NOT NULL REFERENCES registration_codes,
        credits INTEGER NOT NULL, team_id INTEGER, created INTEGER NOT NULL
    )''')
    con.execute("UPDATE invites SET used=1 WHERE used=0")


def generate_code():
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return '-'.join(''.join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))


def normalize(code):
    return code.strip().upper()


def validate_teams(con, teams):
    ids = sorted(set(teams))
    for wid in ids:
        if not con.execute("SELECT 1 FROM workspaces WHERE id=? AND kind='team'", (wid,)).fetchone():
            raise HTTPException(400, '团队已不存在，请重新选择')
    return ids


def validate_options(con, values):
    name = values['name'].strip()
    if not name or any(ord(c) < 32 for c in name):
        raise HTTPException(400, '请填写邀请码名称')
    if values['expires'] is not None and values['expires'] <= int(time.time()):
        raise HTTPException(400, '到期时间需要晚于当前时间')
    if values['grant_credits'] and values['initial_credits'] < 1:
        raise HTTPException(400, '赠送积分需为正整数')
    values['name'] = name
    if not values['grant_credits']:
        values['initial_credits'] = 0
    if values['team_id'] is not None:
        validate_teams(con, [values['team_id']])
    return values


def public(row):
    result = {key: row[key] for key in ('id', 'code', 'name', 'expires', 'enabled', 'grant_credits', 'initial_credits', 'team_id', 'uses', 'created', 'revision')}
    result['enabled'] = bool(result['enabled'])
    result['grant_credits'] = bool(result['grant_credits'])
    return result


def listing(con):
    return [public(row) for row in con.execute("SELECT * FROM registration_codes WHERE role='member' ORDER BY id DESC")]
