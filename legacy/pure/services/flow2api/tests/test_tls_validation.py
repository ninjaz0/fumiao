import unittest,tempfile,subprocess,ssl,threading,http.server
from pathlib import Path
from unittest.mock import AsyncMock
from src.services.browser_captcha_personal import BrowserCaptchaService

class TlsValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_remote_script_download_rejects_untrusted_certificate(self):
        with tempfile.TemporaryDirectory() as d:
            key=Path(d)/'key.pem';cert=Path(d)/'cert.pem'
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',str(key),'-out',str(cert)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(b'/* grecaptcha gstatic test fixture */')
                def log_message(self,*args):pass
            server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key);server.socket=context.wrap_socket(server.socket,server_side=True)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            client=object.__new__(BrowserCaptchaService);client._resolve_personal_proxy_download_url=AsyncMock(return_value=None)
            try:
                with self.assertRaises(Exception) as raised:
                    await client._download_recaptcha_asset_bytes('https://127.0.0.1:'+str(server.server_address[1])+'/fixture.js')
                self.assertTrue('certificate' in str(raised.exception).lower() or 'ssl' in str(raised.exception).lower(),str(raised.exception))
            finally:server.shutdown();server.server_close();thread.join(timeout=3)
if __name__=='__main__':unittest.main()
