import json
import os
import platform
import tempfile
import base64
import hashlib
import secrets
import threading
import time
from pathlib import Path


def home():
    explicit = os.environ.get('FMWORKER_HOME')
    if explicit: return Path(explicit).expanduser().resolve()
    if platform.system() == 'Darwin': return Path.home()/'Library/Application Support/fmWorker'
    if platform.system() == 'Windows': return Path(os.environ.get('LOCALAPPDATA', Path.home()))/'fmWorker'
    return Path(os.environ.get('XDG_STATE_HOME', Path.home()/'.local/state'))/'fmWorker'


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.'+path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.flush(); os.fsync(out.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


class State:
    def __init__(self, root=None):
        self.root = Path(root or home())
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.path = self.root/'settings.json'
        try: self.data = json.loads(self.path.read_text(encoding='utf-8'))
        except FileNotFoundError: self.data = {}
        self.data.setdefault('site', 'https://nvmes.com')
        self.data.setdefault('resources', {})
        self.data.setdefault('events', [])
        self.data.setdefault('google', {})

    def set(self, key, value):
        with self.lock:
            self.data[key] = value
            atomic(self.path, self.data)

    def get(self, key, default=None):
        with self.lock: return json.loads(json.dumps(self.data.get(key, default)))

    def resource(self, kind, **values):
        with self.lock:
            value = self.data['resources'].setdefault(kind, {'kind': kind, 'enabled': False, 'stage': 'disconnected'})
            value.update(values)
            atomic(self.path, self.data)
            return dict(value)

    def event(self, title, detail='', level='info'):
        with self.lock:
            self.data['events'].insert(0, {'at': time.time(), 'title': title, 'detail': detail, 'level': level})
            self.data['events'] = self.data['events'][:100]
            atomic(self.path, self.data)


class Vault:
    """OS-protected secrets with process-local caching; no plaintext fallback."""
    def __init__(self, namespace='fmWorker', backend=None):
        import keyring
        self.backend = backend or keyring
        self.namespace = namespace
        self.lock=threading.RLock()
        self.raw_cache={}

    def _read(self,key):
        if key not in self.raw_cache:
            self.raw_cache[key]=self.backend.get_password(self.namespace,key)
        return self.raw_cache[key]

    def get(self,key):
        with self.lock:
            raw=self._read(key)
            if not raw:return None
            value=json.loads(raw)
            if isinstance(value,dict) and value.get('__fmworker_chunks_v1'):
                pieces=[self._read(f"{key}:{value['version']}:{i}") for i in range(value['count'])]
                if any(p is None for p in pieces):raise RuntimeError('系统凭据记录不完整，请重新连接账号')
                decoded=base64.b64decode(''.join(pieces))
                if hashlib.sha256(decoded).hexdigest()!=value['sha256']:raise RuntimeError('系统凭据记录校验失败')
                result=json.loads(decoded)
                if platform.system()!='Windows':self.put(key,result)
                return result
            return value

    def put(self,key,value):
        with self.lock:
            old=self._read(key);raw=json.dumps(value).encode()
            if old==raw.decode():return
            if len(raw)<900 or platform.system()!='Windows':stored=raw.decode()
            else:
                encoded=base64.b64encode(raw).decode();parts=[encoded[i:i+900] for i in range(0,len(encoded),900)]
                version=secrets.token_hex(8)
                for i,piece in enumerate(parts):
                    piece_key=f'{key}:{version}:{i}'
                    self.backend.set_password(self.namespace,piece_key,piece)
                    self.raw_cache[piece_key]=piece
                stored=json.dumps({'__fmworker_chunks_v1':True,'version':version,'count':len(parts),'sha256':hashlib.sha256(raw).hexdigest()})
            self.backend.set_password(self.namespace,key,stored);self.raw_cache[key]=stored
            self._clear_chunks(key,old)

    def _clear_chunks(self,key,raw):
        if not raw:return
        value=json.loads(raw)
        if isinstance(value,dict) and value.get('__fmworker_chunks_v1'):
            for i in range(value['count']):
                piece_key=f"{key}:{value['version']}:{i}"
                try:self.backend.delete_password(self.namespace,piece_key)
                except Exception:pass
                self.raw_cache.pop(piece_key,None)

    def delete(self,key):
        with self.lock:
            raw=self._read(key)
            if raw is not None:
                self.backend.delete_password(self.namespace,key)
                self._clear_chunks(key,raw)
            self.raw_cache[key]=None
