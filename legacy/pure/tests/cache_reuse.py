"""Real files: cache discovery, content verification, tier budgets and missing-only restore."""
import hashlib,json,os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'agent'))
import cache_manager as cm

def entry(name,data):return {'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'sources':[{'id':'test','name':'fixture','url':'http://unused.invalid/file'}]}
def save(path,data):path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);return path
with tempfile.TemporaryDirectory() as d:
 root=Path(d).resolve();persist=root/'persistent';temporary=root/'temporary';logical=root/'logical';worker=root/'worker'
 for p in (persist,temporary,logical,worker):p.mkdir()
 data1=b'known model'+b'a'*80;data2=b'shard'+b'b'*70
 one=entry('weights.safetensors',data1);two=entry('model-00001-of-00002.safetensors',data2)
 items=[{'model':'MiniMax H3','entry':one},{'model':'breeze-tts-2','entry':two}]
 cached=save(persist/'hf/models--Comfy-Org--MiniMax-H3/blobs'/one['sha256'],data1)
 snapshot=persist/'hf/models--Comfy-Org--MiniMax-H3/snapshots/revision/weights.safetensors';snapshot.parent.mkdir(parents=True);snapshot.symlink_to(cached)
 old=save(temporary/'old-fumiao-breeze/checkpoint'/two['path'],data2)
 bad=save(logical/'video/weights.safetensors',b'bad version')
 audit=cm.scan(items,[root],persistent=persist)
 assert len(audit['verified'][one['sha256']])==1 and audit['verified'][two['sha256']]==[str(old)]
 def dev(p):return 'persistent' if Path(p).is_relative_to(persist) else 'temporary'
 with patch.object(cm,'disk_id',side_effect=dev):
  plan=cm.layout(items,audit,persist,[temporary],{'MiniMax H3':logical/'video','breeze-tts-2':logical/'speech'},reserve_bytes=0,quota_bytes=1000,usage_override=len(data1),free_override={str(persist):1000,str(temporary):1000})
  cm.atomic_json(worker/'state/storage-plan.json',plan)
  with patch.object(cm,'rank_sources',side_effect=AssertionError('download despite valid local content')),patch.object(cm,'fetch',side_effect=AssertionError('download despite valid cache')):
   cm.ensure_model('MiniMax H3',lambda _:None,root=worker);cm.ensure_model('breeze-tts-2',lambda _:None,root=worker)
  assert (logical/'video/weights.safetensors').read_bytes()==data1
  assert next((logical/'video').glob('*.invalid-*')).read_bytes()==b'bad version'
  assert (logical/'speech'/two['path']).read_bytes()==data2 and old.read_bytes()==data2
  assert Path(json.loads((worker/'state/storage-plan.json').read_text())['files'][1]['target']).is_relative_to(persist)
 # Signatures catch same-length modifications even when mtime is restored.
 receipts={};assert cm.verify(cached,one,receipts)
 previous=cached.stat();cached.write_bytes(b'x'*len(data1));os.utime(cached,ns=(previous.st_atime_ns,previous.st_mtime_ns));assert not cm.verify(cached,one,receipts)
 cached.write_bytes(data1)
 # Missing file only, with a preserved partial and a real fallback on quota failure.
 payload=b'new weights'+b'c'*100;missing=entry('missing.safetensors',payload)
 partial=save(persist/'.fumiao/models'/missing['sha256'][:2]/(missing['sha256']+'-missing.safetensors.partial'),payload[:22])
 audit=cm.scan([{'model':'breeze-tts-2','entry':missing}],[root],persistent=persist)
 assert str(partial) in audit['partials'][missing['sha256']]
 with patch.object(cm,'disk_id',side_effect=dev):
  plan=cm.layout([{'model':'breeze-tts-2','entry':missing}],audit,persist,[temporary],{'breeze-tts-2':logical/'speech'},reserve_bytes=0,quota_bytes=1000,usage_override=0,free_override={str(persist):1000,str(temporary):1000})
  cm.atomic_json(worker/'state/storage-plan.json',plan);calls=[]
  def fetch(e,path,*args):
   part=path.with_name(path.name+'.partial');calls.append((str(path),part.stat().st_size if part.exists() else 0))
   if path.is_relative_to(persist):raise cm.StorageFullError('quota')
   assert part.read_bytes()==payload[:22];path.write_bytes(payload)
  with patch.object(cm,'rank_sources',return_value=[]),patch.object(cm,'fetch',side_effect=fetch):cm.ensure_model('breeze-tts-2',lambda _:None,root=worker)
  assert len(calls)==2 and calls[0][1]==calls[1][1]==22
  assert (logical/'speech/missing.safetensors').read_bytes()==payload and partial.read_bytes()==payload[:22]
 # Same underlying disk is not counted once for each mount/path.
 fake=[{'model':'MiniMax H3','entry':entry('a',b'a'*60)},{'model':'MiniMax H3','entry':entry('b',b'b'*60)}]
 empty={'verified':{},'partials':{},'receipts':{}}
 with patch.object(cm,'disk_id',return_value='same'):
  try:cm.layout(fake,empty,persist,[temporary],{'MiniMax H3':logical},reserve_bytes=0,quota_bytes=1000,usage_override=0,free_override={str(persist):100,str(temporary):100});raise AssertionError('double-counted one disk')
  except RuntimeError as e:assert '空间' in str(e)
 assert cm.best_fit([('encoder',48),('t2v',37),('r2v',37),('vae',5),('lora',2)],84)=={'t2v','r2v','vae','lora'}
print('PASS broad cache discovery, HF blobs/symlinks, full hashes, corrupt preservation, zero-network reuse, persistent promotion, partial quota fallback and shared-disk budgets')
with tempfile.TemporaryDirectory() as d:
 root=Path(d).resolve();worker=root/'worker';worker.mkdir();logical=root/'logical';logical.mkdir()
 data_a=b'A'*31;data_b=b'B'*37;a=entry('a.safetensors',data_a);b=entry('b.safetensors',data_b)
 origin=save(root/'original-a',data_a);wrong_place=save(logical/'a.safetensors',data_b)
 rows=[{'model':'MiniMax H3','entry':a},{'model':'breeze-tts-2','entry':b}]
 audit=cm.scan(rows,[root]);plan=cm.layout(rows,audit,None,[root],{'MiniMax H3':logical,'breeze-tts-2':logical},reserve_bytes=0)
 cm.atomic_json(worker/'state/storage-plan.json',plan)
 with patch.object(cm,'rank_sources',side_effect=AssertionError('should relocate verified content, not download')):
  cm.ensure_model('MiniMax H3',lambda _:None,root=worker)
  cm.ensure_model('breeze-tts-2',lambda _:None,root=worker)
 assert (logical/'a.safetensors').read_bytes()==data_a and (logical/'b.safetensors').read_bytes()==data_b
 print('PASS misnamed verified files survive quarantine and remain reusable by the other model')

# ModelScope exposes the same persistent volume under /mnt/workspace and
# /home/admin/workspace. Emulate only the directory bind; file identity is real.
with tempfile.TemporaryDirectory() as d:
 root=Path(d).resolve();persist=root/'persistent';alias=root/'alias';temporary=root/'temporary'
 for p in (persist,alias,temporary):p.mkdir()
 payload=b'bind mounted weight';e=entry('weights.safetensors',payload)
 original=save(persist/'models'/e['path'],payload)
 mirrored=alias/'models'/e['path'];mirrored.parent.mkdir();os.link(original,mirrored)
 samefile=Path.samefile
 def bound_samefile(path,other):
  if {str(path),str(other)}=={str(persist),str(alias)}:return True
  return samefile(path,other)
 with patch.object(Path,'samefile',bound_samefile):
  audit=cm.scan([{'model':'MiniMax H3','entry':e}],[alias],persistent=persist)
 assert audit['verified'][e['sha256']]==[str(original)]
 plan=cm.layout([{'model':'MiniMax H3','entry':e}],audit,persist,[temporary],{'MiniMax H3':root/'logical'},reserve_bytes=0,quota_bytes=len(payload),usage_override=len(payload))
 assert plan['files'][0]['tier']=='persistent' and plan['files'][0]['target']==str(original)
 assert plan['files'][0]['download_bytes']==0
 assert cm.persistent_path(mirrored,persist)==mirrored  # A hard link alone is not a directory alias.
 print('PASS persistent bind mount aliases reuse the verified file without copying or consuming quota')

# The two H3 checkpoints have equal sizes but distinct hashes. Hash each inode
# once per scan, including a non-matching candidate; never infer by filename.
with tempfile.TemporaryDirectory() as d:
 root=Path(d).resolve();a=save(root/'misnamed-b',b'A'*10000);b=save(root/'misnamed-a',b'B'*10000)
 items=[{'model':'MiniMax H3','entry':entry('a.safetensors',a.read_bytes())},{'model':'MiniMax H3','entry':entry('b.safetensors',b.read_bytes())}]
 opened=[];real_open=Path.open
 def counting(path,*args,**kwargs):
  if path in (a,b) and (args[0] if args else kwargs.get('mode','r'))=='rb':opened.append(path)
  return real_open(path,*args,**kwargs)
 with patch.object(Path,'open',counting):audit=cm.scan(items,[root])
 assert opened.count(a)==opened.count(b)==1,opened
 assert audit['verified'][items[0]['entry']['sha256']]==[str(a)]
 assert audit['verified'][items[1]['entry']['sha256']]==[str(b)]
print('PASS same-size checkpoint candidates are hashed once per unchanged file and install run')
