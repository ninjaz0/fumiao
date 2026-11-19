"""Independent, revocable administrator sessions for the /muse console."""
from contextlib import contextmanager
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

COOKIE = '__Secure-muse_admin_session'
PREFIX = '/muse'
TTL = 12 * 3600
ROUNDS = 600000


def password_record(username, password):
    salt = secrets.token_hex(32)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), ROUNDS).hex()
    return {'username': username, 'salt': salt, 'rounds': ROUNDS, 'hash': digest}


def route_path(request):
    path = request.url.path
    return path[len(PREFIX):] if path.startswith(PREFIX + '/') else path


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=1024)


class AdminSessions:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.database = self.directory / 'admin-sessions.sqlite'
        self.credentials = self.directory / 'admin-auth.json'
        self.directory.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, username TEXT NOT NULL, expires REAL NOT NULL, fingerprint TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS failures (ip TEXT NOT NULL, stamp REAL NOT NULL)')
        os.chmod(self.database, 0o600)

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.database, timeout=5)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def config(self):
        try:
            c = json.loads(self.credentials.read_text())
            assert c['username'] and len(c['hash']) == 64 and len(c['salt']) == 64
            return c
        except (OSError, ValueError, KeyError, AssertionError):
            raise HTTPException(503, '管理员登录尚未配置')

    def fingerprint(self):
        return hashlib.sha256(self.credentials.read_bytes()).hexdigest()

    def lookup(self, request):
        raw = request.cookies.get(COOKIE, '')
        if not raw or len(raw) > 128:
            return None
        digest = hashlib.sha256(raw.encode()).hexdigest()
        with self.db() as db:
            db.execute('DELETE FROM sessions WHERE expires <= ?', (time.time(),))
            row = db.execute('SELECT * FROM sessions WHERE token=?', (digest,)).fetchone()
        if not row:
            return None
        try:
            return dict(row) if hmac.compare_digest(row['fingerprint'], self.fingerprint()) else None
        except OSError:
            return None

    def check_write(self, request, session):
        if request.method in {'GET', 'HEAD', 'OPTIONS'}:
            return
        expected = urlsplit(os.environ.get('MUSE2API_PUBLIC_BASE', 'https://backend.nvmes.com/muse'))
        origin = request.headers.get('origin')
        if origin is not None and origin != expected.scheme + '://' + expected.netloc:
            raise HTTPException(403, '请求来源不匹配，请从 Muse 后台重试')
        if not hmac.compare_digest(request.headers.get('x-muse-csrf-token', ''), session['csrf']):
            raise HTTPException(403, '页面验证已失效，请刷新后重试')

    def require(self, request):
        session = self.lookup(request)
        if not session:
            raise HTTPException(401, '请先登录管理员账号')
        self.check_write(request, session)
        return session

    def revoke(self, request):
        raw = request.cookies.get(COOKIE, '')
        with self.db() as db:
            db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(raw.encode()).hexdigest(),))


def install_admin_auth(app, cfg, source_dir):
    sessions = AdminSessions(cfg.data_dir)
    app.state.admin_sessions = sessions

    @app.middleware('http')
    async def console_guard(request, call_next):
        path = route_path(request)
        try:
            if request.method != 'OPTIONS' and (path == '/manage' or path == '/admin' or path.startswith('/admin/')):
                # Existing cookie import helpers retain only their import capability.
                importer = request.method == 'POST' and (path == '/admin/accounts' or re.fullmatch(r'/admin/accounts/[^/]+/cookies', path))
                bearer = request.headers.get('authorization', '')
                key_valid = bool(cfg.api_key) and hmac.compare_digest(bearer, 'Bearer ' + cfg.api_key)
                if not (importer and key_valid):
                    if path in {'/manage', '/admin'} and not sessions.lookup(request):
                        return RedirectResponse(PREFIX + '/', status_code=303, headers={'Cache-Control': 'no-store'})
                    sessions.require(request)
            response = await call_next(request)
        except HTTPException as error:
            response = JSONResponse({'detail': error.detail}, status_code=error.status_code)
        if path == '/' or path in {'/login', '/manage', '/admin'} or path.startswith(('/auth/', '/admin/')):
            response.headers['Cache-Control'] = 'private, no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Referrer-Policy'] = 'same-origin'
            response.headers['X-Frame-Options'] = 'DENY'
        return response

    @app.post('/auth/login')
    def login(payload: Login, request: Request):
        origin = request.headers.get('origin')
        expected = urlsplit(os.environ.get('MUSE2API_PUBLIC_BASE', 'https://backend.nvmes.com/muse'))
        if origin is not None and origin != expected.scheme + '://' + expected.netloc:
            raise HTTPException(403, '请求来源不匹配')
        ip = request.client.host if request.client else 'unknown'
        now = time.time()
        with sessions.db() as db:
            db.execute('DELETE FROM failures WHERE stamp < ?', (now - 900,))
            count = db.execute('SELECT count(*) FROM failures WHERE ip=?', (ip,)).fetchone()[0]
            if count >= 10:
                raise HTTPException(429, '登录尝试过多，请 15 分钟后重试')
        config = sessions.config()
        actual = hashlib.pbkdf2_hmac('sha256', payload.password.encode(), bytes.fromhex(config['salt']), config['rounds']).hex()
        valid = hmac.compare_digest(actual, config['hash']) & hmac.compare_digest(payload.username.encode(), config['username'].encode())
        if not valid:
            with sessions.db() as db:
                db.execute('INSERT INTO failures VALUES (?,?)', (ip, now))
            raise HTTPException(401, '账户或密码错误')
        sessions.revoke(request)
        raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with sessions.db() as db:
            db.execute('DELETE FROM failures WHERE ip=?', (ip,))
            db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
            db.execute('INSERT INTO sessions VALUES (?,?,?,?,?)', (hashlib.sha256(raw.encode()).hexdigest(), csrf, config['username'], now + TTL, sessions.fingerprint()))
        response = JSONResponse({'success': True, 'username': config['username'], 'csrf_token': csrf})
        response.set_cookie(COOKIE, raw, max_age=TTL, httponly=True, secure=True, samesite='strict', path=PREFIX + '/')
        return response

    @app.get('/auth/session')
    def current_session(request: Request):
        session = sessions.require(request)
        return {'username': session['username'], 'csrf_token': session['csrf'], 'expires_at': session['expires']}

    @app.post('/auth/logout')
    def logout(request: Request):
        sessions.require(request)
        sessions.revoke(request)
        response = JSONResponse({'success': True})
        response.delete_cookie(COOKIE, path=PREFIX + '/', secure=True, httponly=True, samesite='strict')
        return response

    @app.get('/login', response_class=HTMLResponse)
    def login_page():
        return (Path(source_dir) / 'login.html').read_text()

    return sessions
