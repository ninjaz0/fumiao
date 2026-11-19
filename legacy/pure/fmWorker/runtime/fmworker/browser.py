"""Only the application's dedicated Chrome profile is controlled through CDP."""
import json
import os
import platform
import shutil
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests
import websocket


def find_browser():
    candidates = []
    if platform.system() == 'Darwin':
        candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    elif platform.system() == 'Windows':
        for prefix in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
            root = os.environ.get(prefix, '')
            candidates += [str(Path(root)/'Google/Chrome/Application/chrome.exe'), str(Path(root)/'Microsoft/Edge/Application/msedge.exe')]
    else:
        candidates = [shutil.which(n) for n in ('google-chrome', 'chromium', 'microsoft-edge')]
    return next((str(p) for p in candidates if p and Path(p).is_file()), None)


class Browser:
    def __init__(self, root):
        self.root = Path(root)/'flow-browser'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.process = None
        self.lock = threading.RLock()
        self.sequence = 0

    def start(self):
        with self.lock:
            if self.process and self.process.poll() is None: return self.endpoint()
            binary = find_browser()
            if not binary: raise RuntimeError('请先安装 Chrome 或 Edge，然后重新连接 Flow')
            port_file = self.root/'DevToolsActivePort'
            port_file.unlink(missing_ok=True)
            self.process = subprocess.Popen([binary, '--user-data-dir='+str(self.root), '--remote-debugging-port=0',
                '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
                '--new-window', 'https://flow.google.com/'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic()+25
            while time.monotonic() < deadline:
                if self.process.poll() is not None: raise RuntimeError('Flow 浏览器未启动，请重试')
                if port_file.exists(): return self.endpoint()
                time.sleep(.2)
            raise RuntimeError('Flow 浏览器启动超时')

    def endpoint(self):
        lines = (self.root/'DevToolsActivePort').read_text(encoding='utf-8').splitlines()
        port = int(lines[0])
        if not 1024 <= port <= 65535 or not lines[1].startswith('/devtools/browser/'): raise RuntimeError('浏览器控制地址无效')
        return 'ws://127.0.0.1:'+str(port)+lines[1]

    def call(self, method, params=None, session=None):
        with self.lock:
            ws = websocket.create_connection(self.endpoint(), timeout=30, suppress_origin=True, http_no_proxy=['127.0.0.1','localhost'])
            try:
                self.sequence += 1
                packet = {'id':self.sequence, 'method':method, 'params':params or {}}
                if session: packet['sessionId'] = session
                ws.send(json.dumps(packet))
                while True:
                    message = json.loads(ws.recv())
                    if message.get('id') != self.sequence: continue
                    if 'error' in message: raise RuntimeError('Flow 浏览器连接未完成，请重新打开连接窗口')
                    return message.get('result', {})
            finally: ws.close()

    def cookies(self):
        values = self.call('Storage.getCookies')['cookies']
        return [c for c in values if (c.get('domain','').lstrip('.') in ('google.com','flow.google.com','labs.google','accounts.google.com') or c.get('domain','').endswith('.google.com'))]

    def session_status(self):
        cookies = self.cookies()
        if not any(c['name'] in ('__Secure-next-auth.session-token', '__Secure-authjs.session-token') for c in cookies):
            return {'connected':False, 'detail':'请在专用浏览器中完成 Flow 登录'}
        # A valid session must be checked by Flow2API before this can become ready.
        return {'connected':True, 'detail':'已取得 Flow 会话，正在验证'}

    def close(self):
        if self.process and self.process.poll() is None:
            try: self.call('Browser.close')
            except Exception: self.process.terminate()
        self.process = None
