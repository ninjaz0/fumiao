"""Only content-fingerprinted public UI assets enter a shared cache."""
import os,sys,tempfile,re,hashlib
from pathlib import Path
from fastapi.testclient import TestClient
from unittest.mock import patch
sandbox=tempfile.TemporaryDirectory();os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver',FUMIAO_MUSE_AUTOSTART='0')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server,public_assets
with TestClient(server.app) as c:
 for route in ['/','/studio','/canvas','/canvas/anything']:
  page=c.get(route);assert page.status_code==200
  assert page.headers['cache-control']=='private, no-store'
  # The public homepage never loads the chat bundle; the workbench and canvas do.
  assert ('fm-chat-script' in page.text)==(route!='/')
  paths=re.findall(r'/static/[a-z.]+\?v=[a-f0-9]{20}',page.text);assert paths
  for path in paths:
   r=c.get(path);assert r.status_code==200 and r.headers['cache-control']=='public, max-age=31536000, immutable'
   assert r.headers['cloudflare-cdn-cache-control']=='public, max-age=86400'
   assert 'set-cookie' not in r.headers
   assert c.head(path).status_code==200
   assert c.get(path.split('?')[0]).headers['cache-control']=='private, no-store'
 for path in ['/api/state','/api/chats','/api/canvases','/media/fake.mp4','/static/unknown.js','/static/chat.js?v=old']:
  r=c.get(path);assert r.headers['cache-control']=='private, no-store',path
  assert 'cloudflare-cdn-cache-control' not in r.headers,path
 body=c.get('/static/studio.js').text;assert 'meta[name="fm-chat-script"]' in body
 home=c.get('/').text;assert '/static/home.css?v=' in home and '/static/home.js?v=' in home
 for legacy in ['/?workspace=7','/?recharge=history']:
  r=c.get(legacy,follow_redirects=False);assert r.status_code==307 and r.headers['location']=='/studio'+legacy[1:]
 # A replaced bundle changes the URL immediately, even without restarting the process.
 root=Path(sandbox.name)/'static';root.mkdir();p=root/'chat.js';p.write_text('old')
 before=public_assets.url(root,'chat.js');p.write_text('new bundle')
 after=public_assets.url(root,'chat.js');assert before!=after
 assert not public_assets.versioned(root,'/api/chat.js',after.split('=')[1])
print('PASS homepage + /studio routes, legacy query redirects, fingerprinted cache eligibility, private HTML/API/media/error bypass, lazy chat fingerprint, HEAD, immediate bundle version change')
