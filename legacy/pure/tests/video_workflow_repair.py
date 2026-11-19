"""Regression checks for the H3 noise incident. No GPU or billed API requests."""
import ast
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'agent')]
import job_progress
from node_models import h3_fast_preset
import rocm_attention_patch as repair
from sampler_progress import SamplerProgress
from video_quality import check_first_frame, VideoQualityError

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    path = root / 'comfy/ldm/minimax/model.py'
    path.parent.mkdir(parents=True)
    path.write_text('def fixture():\n' + repair.ORIGINAL + '\n')
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
    subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'fixture'], check=True)
    repair.verify_checkout(root)
    assert repair.apply(root)
    applied = path.read_bytes()
    assert not repair.apply(root) and path.read_bytes() == applied
    repair.verify_checkout(root)
    path.write_text(path.read_text() + '\n# unexpected edit\n')
    try:
        repair.verify_checkout(root)
        raise AssertionError('unexpected tracked edit accepted')
    except RuntimeError:
        pass
    assert not repair.verify_runtime(root, root / 'missing-runtime.json')
    path.write_bytes(applied)
    with patch.object(repair, 'process_started', return_value='123'), patch.object(repair, 'boot_id', return_value='boot-A'):
        repair.record_runtime(root, root / 'runtime.json', 999)
        assert repair.verify_runtime(root, root / 'runtime.json')
    with patch.object(repair, 'process_started', return_value='124'), patch.object(repair, 'boot_id', return_value='boot-A'):
        assert not repair.verify_runtime(root, root / 'runtime.json')
    with patch.object(repair, 'process_started', return_value='123'), patch.object(repair, 'boot_id', return_value='boot-B'):
        assert not repair.verify_runtime(root, root / 'runtime.json')
    path.write_text('changed source')
    with patch.object(repair, 'process_started', return_value='123'), patch.object(repair, 'boot_id', return_value='boot-A'):
        assert not repair.verify_runtime(root, root / 'runtime.json')
print('PASS exact native patch, repeated restore, unexpected edits and old-process rejection')

# A flat valid source stays valid; a detailed source collapsing to grey fails.
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source = Image.new('RGB', (320, 180), '#344853')
    draw = ImageDraw.Draw(source)
    for x in range(0, 320, 40):
        draw.rectangle((x, 20, x + 18, 160), fill=('#f5a62d' if x % 80 else '#e9f3d5'))
    source.save(root / 'source.png')
    source.resize((864, 480)).save(root / 'good.png')
    assert check_first_frame(root / 'source.png', root / 'good.png')['first_frame_correlation'] > .9
    Image.new('RGB', (864, 480), (110, 105, 99)).save(root / 'bad.png')
    try:
        check_first_frame(root / 'source.png', root / 'bad.png')
        raise AssertionError('collapsed output accepted')
    except VideoQualityError:
        pass
    check_first_frame(root / 'bad.png', root / 'bad.png')
print('PASS low-detail source accepted, source-preserving result accepted, grey collapse rejected')

# Recovered pre-fix files must enter verification again, even with an old receipt.
node = next(n for n in ast.parse((ROOT / 'agent/worker.py').read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'needs_render_verification')
recovery = {'json':json}
exec(compile(ast.Module(body=[node], type_ignores=[]), '<worker>', 'exec'), recovery)
with tempfile.TemporaryDirectory() as temporary:
    folder = Path(temporary)
    needs_check = recovery['needs_render_verification']
    job = {'refs':['first']}
    assert needs_check(folder, job)
    receipt = folder / 'verified.json'
    for metadata in ({}, {'quality_check':None}, {'quality_check':{'first_frame_correlation':.99}}, {'quality_check':{'version':0}}):
        receipt.write_text(json.dumps(metadata)); assert needs_check(folder, job)
    receipt.write_text(json.dumps({'quality_check':{'version':1}}))
    assert not needs_check(folder, job)
    receipt.write_text('{}')
    assert not needs_check(folder, {'refs':[]})
    assert not needs_check(folder, {'refs':['a','b']})
print('PASS old cached I2V receipts cannot bypass quality verification')

# The optional accelerator must never silently alter T2V, R2V or 480P jobs.
ns = {'sampling_steps': job_progress.sampling_steps, 'h3_fast_preset':h3_fast_preset}
engine = {'json': json, 'ROOT': ROOT / 'agent/vendor/engine'}
for file, function, target in [
    ('agent/vendor/engine/scripts/generate.py', 'make_graph', engine),
    ('agent/render.py', 'build_graph', ns),
]:
    if function == 'build_graph':
        ns['h3'] = types.SimpleNamespace(make_graph=engine['make_graph'])
    node = next(n for n in ast.parse((ROOT / file).read_text()).body if isinstance(n, ast.FunctionDef) and n.name == function)
    exec(compile(ast.Module(body=[node], type_ignores=[]), file, 'exec'), target)
base = {'id':25, 'prompt':'test', 'seed':17, 'quality':768, 'seconds':15, 'width':1344, 'height':768, 'refs':['reference']}
for fast in (False, True):
    with patch.object(job_progress, 'FAST_I2V', fast):
        for refs in ([], ['reference'], ['a','b']):
            for quality in (480,768):
                job = base | {'refs':refs, 'quality':quality}
                graph = ns['build_graph'](job, 'job-25')
                expected = 4 if fast and len(refs)==1 and quality==768 else 20
                assert graph['9']['inputs']['steps'] == expected
                assert ('16' in graph) == (expected == 4)
                if expected == 4:
                    assert graph['7']['inputs']['model'] == graph['9']['inputs']['model'] == ['17',0]
                assert graph['5']['inputs']['length'] == 362
    clock_value = [0.]
    clock = job_progress.JobClock(cold=False, steps=4 if fast else 20, clock=lambda:clock_value[0])
    clock.observe_sampling(4, 4 if not fast else 20)
    assert clock.phase == 'preparing'
    clock_value[0] = 10.; clock.observe_sampling(0, clock.steps)
    clock_value[0] = 100.; clock.observe_sampling(clock.steps, clock.steps)
    clock_value[0] = 110.; clock.begin_upload()
    assert clock.snapshot()[1]['generate_s'] == 90
print('PASS explicit accelerator routing, matching sampler/schedule and stage durations')

# Real local websocket handshake: loader events and regressing/invalid steps are ignored.
async def websocket_check():
    from aiohttp import web
    received = asyncio.Event()
    async def handler(request):
        assert request.query['clientId'] == 'fumiao-job-test'
        ws = web.WebSocketResponse(); await ws.prepare(request)
        def progress(node, value, maximum):
            return {'type':'progress','data':{'node':node,'value':value,'max':maximum,'prompt_id':'test'}}
        for event in [progress('2',4,4), progress('10',1,20), progress('10',1,4), progress('10',-1,4), progress('10',2,4), progress('10',1,4), progress('10',99,4), {'type':'executing','data':{}}]:
            await ws.send_json(event)
        received.set()
        async for _ in ws:
            pass
        return ws
    app = web.Application(); app.router.add_get('/ws', handler)
    runner = web.AppRunner(app); await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0); await site.start()
    port = runner.addresses[0][1]
    with tempfile.TemporaryDirectory() as temporary:
        listener = SamplerProgress(f'http://127.0.0.1:{port}', 'fumiao-job-test', temporary, 4)
        await asyncio.to_thread(listener.start)
        await asyncio.wait_for(received.wait(), 3)
        for _ in range(100):
            if listener.path.exists() and json.loads(listener.path.read_text())['step'] == 2:
                break
            await asyncio.sleep(.01)
        assert json.loads(listener.path.read_text())['step'] == 2
        await asyncio.to_thread(listener.close)
        assert not listener.thread.is_alive()
    await runner.cleanup()
asyncio.run(websocket_check())
print('PASS real task-scoped websocket progress and clean listener shutdown')
