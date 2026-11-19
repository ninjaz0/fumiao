"""Run the pinned Studio fixture with only loopback provider destinations."""
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
import urllib.request
from urllib.parse import urlsplit

import uvicorn


origin = sys.argv.pop(1)
disk_free = int(sys.argv.pop(1))
url = urlsplit(origin)
assert url.scheme == "http" and url.hostname == "127.0.0.1"
assert origin == f"http://127.0.0.1:{url.port}"
for name in ("OPENAI_API_KEY", "OPENAI_CHAT_API_KEY", "DEEPSEEK_API_KEY"):
    os.environ.pop(name, None)

original_run = uvicorn.run


class RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(app, **kwargs):
    from chat_models import PROVIDERS
    import server

    server.shutil = SimpleNamespace(disk_usage=lambda _: SimpleNamespace(free=disk_free))

    for name, prefix in (("deepseek", "/chat/deepseek/"), ("openai", "/chat/openai/v1/")):
        PROVIDERS[name]["models_url"] = origin + prefix + "models"
        PROVIDERS[name]["url"] = origin + prefix + "chat/completions"

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), RejectRedirect())

    def local_image_probe(request, *, timeout):
        source = "https://api.openai.com"
        assert request.full_url == source + "/v1/models/gpt-image-2.6-sunburst"
        local = urllib.request.Request(
            origin + "/image" + request.full_url.removeprefix(source),
            headers=dict(request.header_items()),
            method=request.get_method(),
        )
        return opener.open(local, timeout=timeout)

    urllib.request.urlopen = local_image_probe
    original_run(app, **kwargs)


uvicorn.run = run
runpy.run_path(str(Path(__file__).with_name("preview-original.py")), run_name="__main__")
