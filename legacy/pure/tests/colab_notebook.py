"""Public Colab entry has no credentials and never executes a pasted shell fragment."""
import json,sys,os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path(__file__).resolve().parents[1];nb=json.loads((root/'agent/colab.ipynb').read_text());source=''.join(nb['cells'][2]['source'])
for i,c in enumerate(nb['cells']):
 if c['cell_type']=='code':compile(''.join(c['source']),f'cell-{i}','exec')
code='x'*43;site='https://nvmes.com';command=f'curl -fsSL {site}/connect/install.sh -o /tmp/fumiao-install.sh && FUMIAO_SITE={site} bash /tmp/fumiao-install.sh --models=minimax-h3,breeze-tts-2 {code}'
for exit_code in (0,7):
 calls=[]
 def run(args,**kwargs):calls.append((args,kwargs));return SimpleNamespace(returncode=exit_code if args[0]=='bash' else 0)
 ns={}
 with patch('getpass.getpass',return_value=command),patch.object(Path,'is_mount',return_value=True),patch('subprocess.run',side_effect=run):
  try:exec(source,ns);assert not exit_code
  except RuntimeError as e:assert exit_code and code not in str(e)
 assert ns['connect_command']=='' and ns['code']=='' and ns['parts']==[]
 assert len(calls)==2 and all(not kwargs.get('shell') for _,kwargs in calls)
 assert calls[-1][1]['env']['FUMIAO_PERSIST_QUOTA_BYTES']=='160000000000'
with patch('getpass.getpass',return_value=command+'; touch /tmp/unwanted'),patch.object(Path,'is_mount',return_value=True),patch('subprocess.run',side_effect=AssertionError('Unexpected execution')):
 try:exec(source,{});raise AssertionError('Accepted shell injection')
 except ValueError:pass
print('PASS notebook compilation, exact command parsing, no shell interpolation and credential-free errors')

# Every successful cache-repair pass must be flushed before the notebook says done.
import types,contextlib,io
sync_source=''.join(nb['cells'][3]['source'])
for progression in ([1,3],[1,2,3],[1,1],[0,1,2]):
 current=[0];events=[]
 def get_plan():return {'files':[{'tier':'persistent' if i<progression[current[0]] else 'temporary'} for i in range(3)]}
 fake=types.ModuleType('google.colab');fake.drive=SimpleNamespace(flush_and_unmount=lambda **kw:events.append(('flush',progression[current[0]])),mount=lambda path:events.append(('mount',progression[current[0]])))
 def sync_run(*args,**kwargs):
  events.append(('sync',progression[current[0]]));current[0]=min(current[0]+1,len(progression)-1);return SimpleNamespace(returncode=0)
 stream=io.StringIO()
 with patch.dict(sys.modules,{'google.colab':fake}),patch.object(Path,'read_text',side_effect=lambda *a,**kw:json.dumps(get_plan())),patch('subprocess.run',side_effect=sync_run),contextlib.redirect_stdout(stream):
  exec(sync_source,{'models':'minimax-h3,breeze-tts-2','env':{}})
 if progression[current[0]]==3:
  assert events[-2:]==[('flush',3),('mount',3)] and '同步完成' in stream.getvalue()
 else:assert '仅在本地' in stream.getvalue() and '同步完成，可回' not in stream.getvalue()
 assert sum(e[0]=='sync' for e in events)<=2
print('PASS Drive repair retries flush the final upload, stop on no progress and report local-only files')
