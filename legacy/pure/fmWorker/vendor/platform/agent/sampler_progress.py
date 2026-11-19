"""Task-scoped Comfy progress, so a 4/4 loader is never mistaken for sampling."""
import asyncio
import json
import threading
import time
from pathlib import Path

import aiohttp


class SamplerProgress:
    def __init__(self, url, client_id, folder, steps):
        self.url = url.replace('https://', 'wss://', 1).replace('http://', 'ws://', 1) + '/ws'
        self.client_id = client_id
        self.path = Path(folder) / 'sampler-progress.json'
        self.steps = steps
        self.stopped = threading.Event()
        self.ready = threading.Event()
        self.thread = threading.Thread(target=lambda: asyncio.run(self.listen()), daemon=True)
        self.step = -1

    def start(self):
        self.path.unlink(missing_ok=True)
        self.thread.start()
        self.ready.wait(5)

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=2)

    def observe(self, event):
        if not isinstance(event, dict) or event.get('type') != 'progress':
            return
        data = event.get('data')
        if not isinstance(data, dict) or str(data.get('node')) != '10' or data.get('max') != self.steps:
            return
        step = data.get('value')
        if type(step) is not int or not self.step <= step <= self.steps or step < 0:
            return
        self.step = step
        self.path.with_suffix('.tmp').write_text(json.dumps({'step':step,'steps':self.steps,'at':time.time()}))
        self.path.with_suffix('.tmp').replace(self.path)

    async def listen(self):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(self.url, params={'clientId': self.client_id}) as ws:
                    self.ready.set()
                    while not self.stopped.is_set():
                        try:
                            message = await ws.receive(timeout=1)
                        except asyncio.TimeoutError:
                            continue
                        if message.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
                        if message.type != aiohttp.WSMsgType.TEXT:
                            continue
                        self.observe(json.loads(message.data))
        except (aiohttp.ClientError, OSError, ValueError):
            self.ready.set()
