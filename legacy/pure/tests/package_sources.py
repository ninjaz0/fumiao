"""Real pip rejects a corrupt mirror response, then installs the verified fallback wheel."""
import hashlib,io,os,subprocess,sys,tempfile,threading,zipfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
import package_sources
buffer=io.BytesIO();dist='fumiao_validation_package-0.0.0.dist-info';name='fumiao_validation_package-0.0.0-py3-none-any.whl'
with zipfile.ZipFile(buffer,'w') as z:
 z.writestr('fumiao_validation_package.py','VALUE = 42\n')
 z.writestr(dist+'/METADATA','Metadata-Version: 2.1\nName: fumiao-validation-package\nVersion: 0.0.0\n')
 z.writestr(dist+'/WHEEL','Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
 z.writestr(dist+'/RECORD','')
wheel=buffer.getvalue();digest=hashlib.sha256(wheel).hexdigest();downloads=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  source='bad' if self.path.startswith('/bad/') else 'good'
  if self.path.endswith('/fumiao-validation-package/'):
   data=f'<a href="/{source}/{name}#sha256={digest}">{name}</a>'.encode();content='text/html'
  elif self.path.endswith('.whl'):
   downloads.append(source);data=b'broken mirror response' if source=='bad' else wheel;content='application/octet-stream'
  else:self.send_error(404);return
  self.send_response(200);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory() as d:
  home=Path(d);subprocess.run([sys.executable,'-m','venv',str(home/'venv')],check=True)
  python=home/'venv/bin/python';base='http://127.0.0.1:'+str(server.server_port)
  with patch.dict(os.environ,{'PIP_INDEX_URL':base+'/bad/simple','PIP_EXTRA_INDEX_URL':'','FUMIAO_PYPI_INDEX_URLS':'','PIP_CONFIG_FILE':os.devnull}),patch.object(package_sources,'FALLBACKS',(base+'/good/simple',)):
   package_sources.install(python,['fumiao-validation-package==0.0.0','--no-deps'])
  subprocess.run([str(python),'-c','import fumiao_validation_package as p;assert p.VALUE==42'],check=True)
  assert downloads==['bad','good'],downloads
finally:server.shutdown();server.server_close()
print('PASS corrupt mirror was rejected by pip hash checking; verified alternate index installed successfully')
