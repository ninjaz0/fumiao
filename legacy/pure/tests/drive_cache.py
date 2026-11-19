"""Drive persistence never scans personal files or runs models directly from FUSE."""
import hashlib,json,os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parents[1];sys.path[:0]=[str(root),str(root/'agent')]
import storage_platform as sp,cache_manager as cm
from node_models import plan,execution_plan

def entry(data):return {'path':'weights.safetensors','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
with tempfile.TemporaryDirectory() as d:
 base=Path(d).resolve();drive=base/'drive';persist=drive/'MyDrive/FumiaoAIGC';secret=drive/'MyDrive/personal';local=base/'local';worker=base/'worker';logical=base/'logical'
 for p in (persist,secret,local,worker,logical):p.mkdir(parents=True)
 data=os.urandom(100000);e=entry(data);original=local/'original.bin';original.write_bytes(data);(secret/'private.bin').write_bytes(data)
 env={'FUMIAO_PERSIST_ROOT':str(persist),'FUMIAO_SEARCH_ROOTS':''}
 with patch.dict(os.environ,env),patch.object(sp,'drive_mounts',return_value=[drive]),patch.object(cm,'drive_mounts',return_value=[drive]):
  assert sp.persistence_root()==persist
  assert sp.logical_bytes(persist)==0
  with patch.dict(os.environ,{'FUMIAO_PERSIST_QUOTA_BYTES':str(len(data)-1)}):
   limited=cm.layout([{'model':'breeze-tts-2','entry':e}],{'verified':{},'partials':{},'receipts':{}},persist,[local],{'breeze-tts-2':logical},reserve_bytes=0,usage_override=0)
   assert limited['quota_bytes']==len(data)-1 and limited['files'][0]['tier']=='temporary'
  with patch.dict(os.environ,{'FUMIAO_PERSIST_QUOTA_BYTES':str(len(data)*2)}):
   # A clean DriveFS cache can occupy the local disk without consuming cloud quota.
   with patch.object(cm,'disk_id',side_effect=lambda p:'drive' if Path(p).is_relative_to(drive) else 'local'):
    remote=cm.layout([{'model':'breeze-tts-2','entry':e}],{'verified':{},'partials':{},'receipts':{}},persist,[local],{'breeze-tts-2':logical},reserve_bytes=0,usage_override=0,free_override={str(persist):1,str(local):len(data)*4})
   assert remote['files'][0]['tier']=='persistent'
  with patch.dict(os.environ,{'FUMIAO_PERSIST_QUOTA_BYTES':''}):
   try:cm.make_plan(['breeze-tts-2'],worker);raise AssertionError('Drive quota was silently inferred from local disk')
   except RuntimeError as error:assert '缓存上限' in str(error)
  audit=cm.scan([{'model':'breeze-tts-2','entry':e}],[base],persistent=persist)
  assert audit['verified'][e['sha256']]==[str(original)]
  assert not any(str(secret) in p for paths in audit['verified'].values() for p in paths)
  target=persist/'.fumiao/models'/e['sha256'][:2]/(e['sha256']+'-weights.safetensors')
  plan_value={'run':cm.RUN,'drive_cache':True,'local_cache':str(local),'files':[{'model':'breeze-tts-2','entry':e,'target':str(target),'source':str(original),'tier':'persistent','logical':str(logical/'weights.safetensors'),'download_bytes':0,'partial':None}],'audit':audit}
  cm.atomic_json(worker/'state/storage-plan.json',plan_value)
  with patch.object(cm,'rank_sources',side_effect=AssertionError('Unexpected network probe')),patch.object(cm,'fetch',side_effect=AssertionError('Unexpected download')):
   cm.ensure_model('breeze-tts-2',lambda _:None,root=worker)
   assert target.read_bytes()==data and (logical/'weights.safetensors').resolve()==original
   original.unlink() # Only this disposable fixture's local replica; Drive remains.
   cm.ensure_model('breeze-tts-2',lambda _:None,root=worker)
   restored=(logical/'weights.safetensors').resolve()
   assert not restored.is_relative_to(drive) and restored.read_bytes()==data and target.read_bytes()==data
  # A failed Drive upload remains explicitly temporary, never a persistence success.
  target.unlink();current=cm.load_plan(worker);current['audit']['verified'][e['sha256']]=[str(restored)];cm.atomic_json(worker/'state/storage-plan.json',current)
  with patch.object(cm,'copy_verified',side_effect=cm.StorageFullError('quota')):cm.ensure_model('breeze-tts-2',lambda _:None,root=worker)
  row=cm.load_plan(worker)['files'][0];assert row['tier']=='temporary' and row['persistence_error'] and row['target']==str(restored)
  assert restored.read_bytes()==data
 # Interrupted copies resume exact prefixes; an unrelated file is preserved.
 dest=base/'copy';partial=dest.with_name('copy.partial');partial.write_bytes(data[:17000])
 cm.copy_verified(restored,dest,e,{},lambda _:None);assert dest.read_bytes()==data
 dest.unlink();partial.write_bytes(b'wrong');cm.copy_verified(restored,dest,e,{},lambda _:None)
 assert dest.read_bytes()==data and next(base.glob('copy.partial.invalid-*')).read_bytes()==b'wrong'
with patch.dict(os.environ,{'FUMIAO_PERSIST_ROOT':'/content/drive/MyDrive/FumiaoAIGC'}),patch.object(sp,'drive_mounts',return_value=[]):
 try:sp.persistence_root();raise AssertionError('Unmounted Drive treated as persistent')
 except RuntimeError as e:assert '尚未挂载' in str(e)
g4={'python':[3,13],'ram_gib':176.88,'disk_free_gib':235.58,'devices':[{'index':0,'name':'NVIDIA RTX PRO 6000 Blackwell Server Edition','backend':'cuda','vram_gib':94.97,'free_gib':94.43}]}
assert plan(g4,['MiniMax H3','breeze-tts-2'])['ok']
assert execution_plan(g4,['MiniMax H3','breeze-tts-2'])['mode']=='serial'
assert not plan(g4|{'devices':[g4['devices'][0]|{'vram_gib':92}]},['MiniMax H3'])['ok']
print('PASS Drive scope, stale mount rejection, local execution, zero-network restoration, quota fallback, resumed copies and G4 serial admission')
