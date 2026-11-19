"""Exercise enrollment, leases, references and binary upload through a CDN-style UA gate."""
import json,sys,tempfile,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import worker
seen=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def route(self):
  if self.headers.get('User-Agent')!='Fumiao-Worker/1.0':self.send_error(403);return
  raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
  seen.append((self.command,self.path,self.headers.get('Authorization'),self.headers.get('X-Job-Ticket'),raw))
  if self.path=='/agent/enroll':body=json.dumps({'models':['MiniMax H3','breeze-tts-2']}).encode()
  elif self.command=='GET':body=b'reference-bytes'
  else:body=b'{"ok":true}'
  self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 do_GET=route;do_POST=route;do_PUT=route
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory() as d:
  worker.STATE=worker.NODE_STATE=Path(d);worker.identity=Path(d)/'credential';worker.SITE='http://127.0.0.1:'+str(server.server_port)
  (Path(d)/'requested-models.json').write_text(json.dumps(['MiniMax H3','breeze-tts-2']))
  worker.enroll('test-pair');assert worker.identity.exists()
  assert worker.api('/agent/heartbeat',{'stage':'ready'})['ok']
  assert worker.api('/agent/reference',method='GET')==b'reference-bytes'
  assert worker.api('/agent/result',method='PUT',ticket_value='test-ticket',raw=b'output-bytes',digest='test-hash')['ok']
  assert seen[0][2] is None and all(row[2] for row in seen[1:])
  assert seen[-1][3]=='test-ticket' and seen[-1][4]==b'output-bytes'
finally:server.shutdown();server.server_close()
print('PASS branded agent requests across enrollment, heartbeat, reference fetch and binary upload; credentials and tickets retained')
