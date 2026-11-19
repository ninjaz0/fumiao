"""Private stdio RPC entry point; stdout is exclusively protocol messages."""
import json
import os
import sys
from pathlib import Path

os.umask(0o077)
for stream in (sys.stdin,sys.stdout,sys.stderr):
    if hasattr(stream,'reconfigure'):stream.reconfigure(encoding='utf-8',errors='strict')
PROTOCOL=sys.stdout
sys.stdout=sys.stderr  # Libraries may print; never allow them onto the RPC channel.
from fmworker.service import Service
from fmworker.state import State,Vault


def main():
    if any(arg.startswith('chrome-extension://') for arg in sys.argv[1:]):
        from fmworker.chrome_native import run
        raise SystemExit(run(sys.argv[1:],sys.stdin.buffer,PROTOCOL.buffer))
    if '--self-test' in sys.argv:
        import hashlib
        from fmworker.assets import bundled,uv_binary
        from colab_cli.client import Client
        from colab_cli.runtime import ColabRuntime
        from colab_cli.contents import ContentsClient
        from google_auth_oauthlib.flow import InstalledAppFlow
        import importlib
        if sys.platform in ('darwin','win32'):
            importlib.import_module('keyring.backends.'+('macOS' if sys.platform=='darwin' else 'Windows'))
        lock=json.loads(bundled('agent.lock.json').read_text(encoding='utf-8'))
        with bundled('agent.tgz').open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==lock['sha256']
        assert Path(uv_binary()).is_file()
        PROTOCOL.write(json.dumps({'ok':True,'resources':'verified','colab_cli':'imported','uv':'bundled','credential_test':'not_performed',
            'stdio_encoding':PROTOCOL.encoding,'language_probe':'中文 / English'},ensure_ascii=False)+'\n');PROTOCOL.flush();return
    from filelock import FileLock
    guard=FileLock(str(State().root/'runtime.lock'))
    guard.acquire(timeout=0)
    service=Service()
    if '--preview' in sys.argv:
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_OPTIONS(self):
                self.send_response(204);self.headers_out();self.end_headers()
            def headers_out(self):
                self.send_header('Access-Control-Allow-Origin','http://127.0.0.1:1420')
                self.send_header('Access-Control-Allow-Headers','Content-Type')
            def do_POST(self):
                if self.path!='/rpc' or self.headers.get('Origin')!='http://127.0.0.1:1420':self.send_error(403);return
                length=int(self.headers.get('Content-Length','0'))
                if length>65536:self.send_error(413);return
                try:
                    packet=json.loads(self.rfile.read(length))
                    # The browser preview is read-only; secrets and installs only
                    # travel over the native process pipe, never a local website.
                    if packet['method'] not in ('status',):raise ValueError('请在 fmWorker 桌面应用中执行此操作')
                    response={'result':service.dispatch(packet['method'],packet.get('params',{}))}
                except Exception as e:response={'error':str(e)}
                body=json.dumps(response).encode();self.send_response(200);self.headers_out()
                self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        ThreadingHTTPServer(('127.0.0.1',18431),Handler).serve_forever();return
    for line in sys.stdin:
        packet={}
        try:
            if len(line)>65536:raise ValueError('请求过大')
            packet=json.loads(line)
            result=service.dispatch(packet['method'],packet.get('params',{}))
            response={'id':packet.get('id'),'result':result}
        except Exception as e:
            message=str(e) if isinstance(e,(RuntimeError,ValueError)) else '操作未完成，请检查网络或导出诊断记录'
            response={'id':packet.get('id'),'error':message[:300]}
        PROTOCOL.write(json.dumps(response,ensure_ascii=False)+'\n');PROTOCOL.flush()
    service.stopping.set()
    service.chrome.close()

if __name__=='__main__':main()
