"""Real local HTTP fixtures for speed selection, cross-source resume and integrity."""
import hashlib,importlib.util,json,sys,tempfile,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_download_impl',root/'agent/download_sources.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
payload=bytes(range(256))*8192;seen=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  route=self.path
  start,end=0,len(payload)-1
  if self.headers.get('Range'):
   value=self.headers['Range'].removeprefix('bytes=');a,b=value.split('-');start=int(a);end=min(int(b) if b else end,end)
  seen.append((route,start,end))
  if route=='/missing':self.send_error(404);return
  if route=='/slow':time.sleep(.15)
  data=payload[start:end+1]
  if route=='/corrupt':data=b'x'*len(data)
  self.send_response(206 if self.headers.get('Range') else 200)
  self.send_header('Content-Length',str(len(data)))
  if self.headers.get('Range'):self.send_header('Content-Range',f'bytes {start}-{end}/{len(payload)}')
  self.end_headers()
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
sources=[{'id':'slow','name':'慢源','url':base+'/slow'},{'id':'fast','name':'快源','url':base+'/fast'},{'id':'missing','name':'故障源','url':base+'/missing'}]
entry={'path':'weights.bin','bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),'sources':sources}
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);ranking=m.rank_sources([entry],root/'report.json',probe_bytes=64*1024,timeout=1)
 assert ranking[0]['id']=='fast' and ranking[-1]['ok'] is False
 target=root/'weights.bin';target.with_name('weights.bin.partial').write_bytes(payload[:100000])
 m.fetch(entry,target,ranking);assert target.read_bytes()==payload and ('/fast',100000,len(payload)-1) in seen
 target.unlink();seen.clear()
 alternate=dict(entry,sources=[{'id':'corrupt','name':'损坏源','url':base+'/corrupt'},sources[1]])
 m.fetch(alternate,target,[dict(alternate['sources'][0],ok=True,bytes_per_second=1000000),dict(sources[1],ok=True,bytes_per_second=1)])
 assert target.read_bytes()==payload and any(x[0]=='/corrupt' for x in seen) and any(x[0]=='/fast' for x in seen)
 messages=[];assert m.valid(target,entry,messages.append) and messages[0]=='校验 weights.bin'
 try:m.valid(target,entry,cancel=lambda:True);raise AssertionError('ignored verification cancellation')
 except InterruptedError:pass
 assert target.read_bytes()==payload
 before=target.read_bytes();target.write_bytes(b'unexpected')
 try:m.fetch(entry,target,ranking);raise AssertionError('overwrote unexpected final cache')
 except RuntimeError:pass
 assert target.read_bytes()==b'unexpected'
server.shutdown();server.server_close()
print('PASS real throughput ranking, unavailable source exclusion, byte-range resume, corrupt-source fallback and cache preservation')
