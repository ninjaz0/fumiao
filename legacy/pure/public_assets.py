"""Content-addressed public UI assets; private API and media responses stay uncached."""
import hashlib,re
from functools import lru_cache
from pathlib import Path

NAMES=frozenset(('studio.js','studio.css','mark.svg','theme.js','canvas.js','canvas.css','chat.js','chat.css','flowpicker.js','home.js','home.css'))

@lru_cache(maxsize=64)
def _digest(path,mtime,size):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:20]

def version(root,name):
    if name not in NAMES:raise ValueError('Not a public asset')
    path=Path(root)/name;s=path.stat()
    return _digest(str(path),s.st_mtime_ns,s.st_size)

def url(root,name):return '/static/'+name+'?v='+version(root,name)

def html(root,name,chat=True):
    source=(Path(root)/name).read_text()
    def replace(match):
        quote,asset=match.groups()
        return quote+url(root,asset)+quote if asset in NAMES else match.group(0)
    source=re.sub(r'([\"\'])/static/([a-z.]+)\1',replace,source)
    if not chat:return source
    # Chat is loaded on demand; its fingerprint must also come from this build.
    return source.replace('</head>','<meta name="fm-chat-script" content="'+url(root,'chat.js')+'"></head>',1)

def versioned(root,path,value):
    name=path.removeprefix('/static/')
    if path!='/static/'+name or name not in NAMES or not value:return False
    try:return value==version(root,name)
    except OSError:return False
