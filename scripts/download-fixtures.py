"""Pinned provider download URL oracle. Every HTTP opener is replaced locally."""
import json, os, sys, urllib.request
from pathlib import Path
root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
os.environ['FUMIAO_DATA'] = str(out / 'runtime')
sys.path.insert(0, str(root / 'legacy/pure'))
import muse_provider, flow_provider

class Response:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, count): return b''

observed = {}
class Opener:
    def open(self, request, timeout):
        observed.update(url=request.full_url, headers=dict(request.header_items()), timeout=timeout)
        return Response()
urllib.request.build_opener = lambda *args: Opener()

names = ['result.png', 'clip-1.mp4', 'a_b.webp', '.image', 'a..png', '../secret', 'dir/result.png', 'image%2epng', 'image%2fpng', 'a'*200, 'a'*201, '', 'image.png?x=1', 'image.png#x', 'image.png?', 'image.png#', '图.png']
cases = []
for provider, module, cache in [('muse', muse_provider, 'v1/media'), ('flow', flow_provider, 'tmp')]:
    for base in ['http://127.0.0.1:18000', 'http://127.0.0.1:18000/prefix', 'https://provider.example/base/']:
        public = f'https://backend.nvmes.com/{provider}'
        config = dict(baseUrl=base, publicUrl=public, apiKey='local-fixture')
        module.config = lambda: (base.rstrip('/'), 'local-fixture', public)
        urls = [origin + '/' + cache + '/' + name for origin in [base.rstrip('/'), public, '', 'https://evil.example', 'https://muse.nvmes.com'] for name in names]
        if provider == 'flow':
            urls += [base.rstrip('/')+'/flow/tmp/result.png']
            urls += [f'{scheme}://{host}/asset.mp4?token=fake' for scheme in ['https', 'http'] for host in ['storage.googleapis.com', 'flow-content.google', 'lh3.googleusercontent.com', 'other.googleusercontent.com', 'googleusercontent.com', 'storage.googleapis.com.evil.test', 'user@storage.googleapis.com', 'user:pass@storage.googleapis.com', 'storage.googleapis.com:443', 'storage.googleapis.com:444', 'storage.googleapis.com:0443', 'storage.googleapis.com:bad', 'storage.googleapis.com:65536', 'STORAGE.GOOGLEAPIS.COM', '%73torage.googleapis.com', 'storage.googleapis.com\\evil.test']]
        for url in urls:
            observed.clear()
            entry = dict(provider=provider, config=config, url=url)
            try:
                path = module.download(url, dict(id=1)); path.unlink()
                entry['expected'] = dict(observed)
            except Exception as error:
                entry['error'] = str(error) if isinstance(error, (flow_provider.FlowError, ValueError)) and (provider=='muse' or isinstance(error, flow_provider.FlowError)) else 'Flow 生成或保存失败，请从后台检查结果后重试'
            cases.append(entry)
print(json.dumps(cases, ensure_ascii=False))
