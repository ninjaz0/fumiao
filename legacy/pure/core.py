import hashlib
import os
import secrets
import shutil
import sqlite3
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException, Request
from avatars import random_avatar
from node_models import GPU_MODELS

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv("FUMIAO_DATA", str(ROOT / ".data"))).resolve()
DATA.mkdir(exist_ok=True, parents=True)
QUOTA = int(os.getenv("FUMIAO_QUOTA", 20_000_000_000))
SITE = os.getenv("FUMIAO_SITE", "https://nvmes.com").rstrip("/")
RESERVE = 64 * 1024**2
LEASE = 180
RATIOS = {
    "16:9": (864, 480, 1344, 768),
    "9:16": (480, 864, 768, 1344),
    "1:1": (480, 480, 768, 768),
    "4:3": (640, 480, 1024, 768),
    "3:4": (480, 640, 768, 1024),
    "21:9": (1120, 480, 1568, 672),
}


def fail(code, message):
    raise HTTPException(code, message)


def now():
    return int(time.time())


def token():
    return secrets.token_urlsafe(32)


def hashed(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password(value, salt):
    return hashlib.scrypt(
        value.encode(), salt=bytes.fromhex(salt), n=2**15, r=8, p=1, maxmem=64 * 1024**2
    ).hex()


def connect():
    con = sqlite3.connect(DATA / "studio.sqlite", timeout=20, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


@contextmanager
def db(write=False):
    con = connect()
    try:
        con.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, salt TEXT, pw TEXT, role TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY, user INTEGER REFERENCES users, expires INTEGER);
CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY, key TEXT UNIQUE, role TEXT, expires INTEGER, used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS pairs(id INTEGER PRIMARY KEY, key TEXT UNIQUE, owner INTEGER REFERENCES users, label TEXT, deadline INTEGER, expires INTEGER, claimed TEXT);
CREATE TABLE IF NOT EXISTS nodes(id INTEGER PRIMARY KEY, owner INTEGER REFERENCES users, name TEXT, key TEXT UNIQUE, deadline INTEGER, lastseen INTEGER, stage TEXT, detail TEXT DEFAULT '', control TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, kind TEXT, size INTEGER, mime TEXT, w INTEGER, h INTEGER, owner INTEGER REFERENCES users);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE, owner INTEGER REFERENCES users, prompt TEXT, refs TEXT, ratio TEXT, quality INTEGER, seconds INTEGER, seed INTEGER, width INTEGER, height INTEGER, parent INTEGER, status TEXT, created INTEGER, attempts INTEGER DEFAULT 0, node INTEGER REFERENCES nodes, ticket TEXT, lease INTEGER, result TEXT REFERENCES media, note TEXT DEFAULT '', updated INTEGER);
CREATE TABLE IF NOT EXISTS tries(key TEXT PRIMARY KEY, count INTEGER, until INTEGER);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS downloads(key TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, manifest TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS favorites(
 id INTEGER PRIMARY KEY,
 user INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
 job INTEGER REFERENCES jobs ON DELETE CASCADE,
 media TEXT REFERENCES media ON DELETE CASCADE,
 created INTEGER NOT NULL,
 CHECK((job IS NOT NULL) != (media IS NOT NULL)),
 UNIQUE(user,job), UNIQUE(user,media)
);
CREATE TABLE IF NOT EXISTS provider_tasks(
 job INTEGER PRIMARY KEY REFERENCES jobs ON DELETE CASCADE,
 dispatch_key TEXT NOT NULL, task_id TEXT, state TEXT NOT NULL DEFAULT 'waiting', retry_at REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS flow_tasks(
 job INTEGER PRIMARY KEY REFERENCES jobs ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'waiting', input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS queue_idx ON jobs(status,id);
CREATE TABLE IF NOT EXISTS job_runs(
 id INTEGER PRIMARY KEY, job INTEGER REFERENCES jobs ON DELETE SET NULL,
 run_key TEXT UNIQUE, attempt INTEGER, node INTEGER, kind TEXT, model TEXT,
 features TEXT NOT NULL, created REAL, queued REAL, started REAL, generating REAL, finalizing REAL,
 uploading REAL, validating REAL, finished REAL, status TEXT, phase TEXT,
 step INTEGER DEFAULT 0, steps INTEGER DEFAULT 20, progress TEXT DEFAULT '[]',
 predicted TEXT DEFAULT '{}', details TEXT DEFAULT '{}', valid INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS run_job_idx ON job_runs(job,id);
CREATE INDEX IF NOT EXISTS run_history_idx ON job_runs(kind,model,status,id);
CREATE TABLE IF NOT EXISTS canvas_projects(
 id TEXT PRIMARY KEY, title TEXT NOT NULL, owner INTEGER NOT NULL REFERENCES users,
 last_editor INTEGER NOT NULL REFERENCES users, created INTEGER NOT NULL, updated INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, document TEXT NOT NULL DEFAULT '{"schemaVersion":1,"nodes":[],"edges":[]}'
);
CREATE TABLE IF NOT EXISTS canvas_media_refs(
 project TEXT NOT NULL REFERENCES canvas_projects ON DELETE CASCADE,
 node TEXT NOT NULL, media TEXT NOT NULL REFERENCES media,
 PRIMARY KEY(project,node,media)
);
CREATE INDEX IF NOT EXISTS canvas_media_idx ON canvas_media_refs(media);
CREATE TABLE IF NOT EXISTS canvas_job_links(
 id INTEGER PRIMARY KEY, project TEXT NOT NULL REFERENCES canvas_projects ON DELETE CASCADE,
 node TEXT NOT NULL, job INTEGER REFERENCES jobs ON DELETE SET NULL,
 owner INTEGER NOT NULL REFERENCES users, uid TEXT NOT NULL,
 inputs TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(owner,uid)
);
CREATE INDEX IF NOT EXISTS canvas_run_idx ON canvas_job_links(project,node,id);
CREATE TABLE IF NOT EXISTS media_provenance(
 media TEXT PRIMARY KEY REFERENCES media ON DELETE CASCADE,
 source TEXT NOT NULL, frame_seconds REAL NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS storyboard_exports(
 id TEXT PRIMARY KEY, uid TEXT NOT NULL, owner INTEGER NOT NULL REFERENCES users,
 workspace INTEGER NOT NULL, project TEXT REFERENCES canvas_projects ON DELETE SET NULL,
 revision INTEGER NOT NULL, snapshot TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
 result TEXT REFERENCES media ON DELETE CASCADE, subtitles TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL, updated INTEGER NOT NULL, UNIQUE(owner,uid)
);
CREATE TABLE IF NOT EXISTS storyboard_export_refs(
 export TEXT NOT NULL REFERENCES storyboard_exports ON DELETE CASCADE,
 media TEXT NOT NULL REFERENCES media, PRIMARY KEY(export,media)
);
CREATE TABLE IF NOT EXISTS asset_packs(
 id TEXT PRIMARY KEY, workspace INTEGER NOT NULL, owner INTEGER NOT NULL REFERENCES users,
 name TEXT NOT NULL, purpose TEXT NOT NULL, description TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_pack_media(
 pack TEXT NOT NULL REFERENCES asset_packs ON DELETE CASCADE,
 media TEXT NOT NULL REFERENCES media, position INTEGER NOT NULL,
 PRIMARY KEY(pack,media)
);
CREATE INDEX IF NOT EXISTS asset_pack_workspace ON asset_packs(workspace,updated);
CREATE TABLE IF NOT EXISTS canvas_run_batches(
 owner INTEGER NOT NULL REFERENCES users, uid TEXT NOT NULL,
 project TEXT NOT NULL REFERENCES canvas_projects ON DELETE CASCADE,
 node TEXT NOT NULL, count INTEGER NOT NULL, result TEXT NOT NULL,
 PRIMARY KEY(owner,uid)
);
"""
from storage import DiskStore, COSStore

store = (
    COSStore()
    if os.getenv("FUMIAO_STORAGE", "disk") == "cos"
    else DiskStore(DATA / "objects")
)
stage_dir = DATA / "staging"
stage_dir.mkdir(exist_ok=True)


def migrate_storyboard_exports(con):
    rules={r['from']:r['on_delete'] for r in con.execute('PRAGMA foreign_key_list(storyboard_exports)')}
    if rules.get('project')=='SET NULL' and rules.get('result')=='CASCADE':
        return
    columns=[r['name'] for r in con.execute('PRAGMA table_info(storyboard_exports)')]
    definition=SCHEMA.split('CREATE TABLE IF NOT EXISTS storyboard_exports(',1)[1].split(');',1)[0]
    con.execute('PRAGMA foreign_keys=OFF')
    try:
        con.execute('BEGIN IMMEDIATE')
        con.execute('CREATE TABLE storyboard_exports_next('+definition+')')
        fields=','.join('"'+c+'"' for c in columns)
        con.execute('INSERT INTO storyboard_exports_next('+fields+') SELECT '+fields+' FROM storyboard_exports')
        con.execute('DROP TABLE storyboard_exports')
        con.execute('ALTER TABLE storyboard_exports_next RENAME TO storyboard_exports')
        if con.execute('PRAGMA foreign_key_check').fetchall():
            raise RuntimeError('Composition migration would break existing references')
        con.commit()
    except BaseException:
        con.rollback();raise
    finally:
        con.execute('PRAGMA foreign_keys=ON')


def init_db():
    con = connect()
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(SCHEMA)
        migrate_storyboard_exports(con)
        con.execute("BEGIN IMMEDIATE")
        columns = {row["name"] for row in con.execute("PRAGMA table_info(users)")}
        for name, definition in (
            ("nickname", "TEXT NOT NULL DEFAULT ''"),
            ("avatar", "TEXT NOT NULL DEFAULT ''"),
            ("deleted_at", "INTEGER"),
        ):
            if name not in columns:
                con.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
        for row in con.execute("SELECT id,name FROM users WHERE avatar=''").fetchall():
            con.execute(
                "UPDATE users SET avatar=?,nickname=CASE WHEN nickname='' THEN name ELSE nickname END WHERE id=?",
                (random_avatar(), row["id"]),
            )
        columns = {row["name"] for row in con.execute("PRAGMA table_info(jobs)")}
        for name, definition in (
            ("kind", "TEXT NOT NULL DEFAULT 'video'"),
            ("model", "TEXT NOT NULL DEFAULT 'MiniMax H3'"),
            ("image_quality", "TEXT NOT NULL DEFAULT 'medium'"),
            ("usage_json", "TEXT NOT NULL DEFAULT '{}'"),
            ("provider_request", "TEXT NOT NULL DEFAULT ''"),
            ("timing_forecast", "TEXT NOT NULL DEFAULT '{}'"),
            ("output_metadata", "TEXT NOT NULL DEFAULT '{}'"),
            ("audio_settings", "TEXT NOT NULL DEFAULT '{}'"),
            ("sampling_steps", "INTEGER NOT NULL DEFAULT 20"),
            ("reference_packs", "TEXT NOT NULL DEFAULT '[]'"),
            ("h3_inputs", "TEXT NOT NULL DEFAULT '{}'"),
        ):
            if name not in columns:
                con.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")
        columns = {row["name"] for row in con.execute("PRAGMA table_info(nodes)")}
        for name in ("hardware", "workflow", "runtime_id"):
            if name not in columns:
                con.execute(f"ALTER TABLE nodes ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        if "profile" not in columns:
            con.execute("ALTER TABLE nodes ADD COLUMN profile TEXT NOT NULL DEFAULT '{}'")
        for column in ('models','ready_models'):
            if column not in columns:con.execute(f'''ALTER TABLE nodes ADD COLUMN {column} TEXT NOT NULL DEFAULT '["MiniMax H3"]' ''')
        if 'model_profiles' not in columns:con.execute("ALTER TABLE nodes ADD COLUMN model_profiles TEXT NOT NULL DEFAULT '{}'")
        if 'video_steps' not in columns:con.execute("ALTER TABLE nodes ADD COLUMN video_steps TEXT NOT NULL DEFAULT '[20]'")
        if 'models' not in {r['name'] for r in con.execute('PRAGMA table_info(pairs)')}:
            con.execute('''ALTER TABLE pairs ADD COLUMN models TEXT NOT NULL DEFAULT '["MiniMax H3"]' ''')
        if "queued" not in {r["name"] for r in con.execute("PRAGMA table_info(job_runs)")}:
            con.execute("ALTER TABLE job_runs ADD COLUMN queued REAL")
        from gpu_lanes import migrate as migrate_lanes
        migrate_lanes(con)
        from workspace_access import migrate
        migrate(con)
        from h3_inputs import migrate as migrate_h3_inputs
        migrate_h3_inputs(con)
        from model_policy import migrate as migrate_models
        migrate_models(con)
        from credits import migrate as migrate_credits
        migrate_credits(con)
        from worker_pool import migrate as migrate_worker_pool
        migrate_worker_pool(con)
        from chat_storage import migrate as migrate_chat
        migrate_chat(con)
        from invitations import migrate as migrate_invites
        migrate_invites(con)
        from timing import import_legacy
        import_legacy(con)
        con.commit()
    finally:
        con.close()


init_db()


def dispatch_paused():
    return (DATA / ".dispatch-paused").exists()


def usage(con):
    used = con.execute("SELECT coalesce(sum(size),0) FROM media").fetchone()[0]
    reserved = (
        con.execute(
            "SELECT count(*) FROM jobs WHERE status IN ('queued','running')"
        ).fetchone()[0]
        * RESERVE
    )
    reserved += con.execute("SELECT count(*) FROM storyboard_exports WHERE state IN ('queued','running')").fetchone()[0] * (256 << 20)
    return used, reserved


def capacity(con, extra):
    used, reserved = usage(con)
    if used + reserved + extra > QUOTA or shutil.disk_usage(DATA).free < max(
        0, extra
    ) + (1 << 30):
        fail(507, "空间不足，请先清理素材或作品")


def protect_canvas_media(con, key):
    if con.execute("SELECT 1 FROM storyboard_export_refs r JOIN storyboard_exports e ON e.id=r.export WHERE r.media=? AND e.state IN ('queued','running')", (key,)).fetchone():
        fail(409, '素材正在合成中，请稍后重试')
    if con.execute('SELECT 1 FROM asset_pack_media WHERE media=? LIMIT 1', (key,)).fetchone():
        fail(409, '素材正在素材包中使用，请先从素材包移除')
    used = con.execute("SELECT 1 FROM canvas_media_refs WHERE media=? LIMIT 1", (key,)).fetchone()
    if not used:
        used = con.execute("""SELECT 1 FROM canvas_job_links l
            JOIN canvas_projects p ON p.id=l.project JOIN jobs j ON j.id=l.job,
            json_each(p.document,'$.nodes') n
            WHERE j.result=? AND (json_extract(n.value,'$.id')=l.node OR 'voice:'||json_extract(n.value,'$.id')=l.node) LIMIT 1""", (key,)).fetchone()
    if used:
        fail(409, "素材正在画布中使用，请先从相关画布移除")


def actor(request: Request):
    with db() as con:
        row = con.execute(
            "SELECT u.* FROM sessions s JOIN users u ON s.user=u.id WHERE s.key=? AND s.expires>? AND u.active=1",
            (hashed(request.cookies.get("fm_session", "")), now()),
        ).fetchone()
    if row is None:
        fail(401, "请先登录")
    return dict(row)


def admin(request):
    user = actor(request)
    if user["role"] != "admin":
        fail(403, "需要管理员权限")
    return user


async def receive(request, limit):
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > limit:
        fail(413, "文件过大")
    fd, name = tempfile.mkstemp(dir=stage_dir)
    path = Path(name)
    try:
        size = 0
        with os.fdopen(fd, "wb") as out:
            async for block in request.stream():
                size += len(block)
                if size > limit:
                    fail(413, "文件过大")
                out.write(block)
        if not size:
            fail(400, "文件为空")
        return path, size
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def reap(con):
    ts = now()
    from worker_pool import reap_flow
    reap_flow(con, ts)
    from timing import end_run
    models=tuple(GPU_MODELS);marks=','.join('?' for _ in models)
    for row in con.execute(f"SELECT * FROM jobs WHERE model IN ({marks}) AND status='running' AND lease<?", (*models,ts)).fetchall():
        end_run(con, dict(row), "interrupted", ts)
    con.execute(
        f"""UPDATE jobs SET status=CASE WHEN attempts<2 THEN 'queued' ELSE 'failed' END,
        note=CASE WHEN attempts<2 THEN '实例离线，等待重新接单' ELSE '实例连续中断，请重新生成' END,
        lease=NULL,updated=? WHERE model IN ({marks}) AND status='running' AND lease<?""",
        (ts,*models,ts),
    )
    con.execute("""UPDATE nodes SET control='paused' WHERE control='draining'
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.node=nodes.id AND jobs.status='running')""")
