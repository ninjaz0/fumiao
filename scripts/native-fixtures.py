"""Read-only Pure input/receipt/artifact oracle; no providers and disposable data."""
import ast, copy, hashlib, importlib.util, json, math, os, random, sqlite3, struct, subprocess, sys, wave
from pathlib import Path
from types import SimpleNamespace
root=Path(__file__).resolve().parents[1];out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
os.environ['FUMIAO_DATA']=str(out/'runtime');sys.path.insert(0,str(root/'legacy/pure'))
import h3_inputs,worker_api,audio_api
from core import RATIOS
from fastapi import HTTPException
con=sqlite3.connect(':memory:');con.row_factory=sqlite3.Row
con.executescript("CREATE TABLE media(id TEXT PRIMARY KEY,kind TEXT,mime TEXT,w INTEGER,h INTEGER,workspace INTEGER);CREATE TABLE workspaces(id INTEGER,kind TEXT,owner INTEGER);INSERT INTO workspaces VALUES(1,'team',NULL);")
h3_inputs.migrate(con)
assets=[]
def asset(kind,index,w=96,h=64,seconds=2.0,fps=24,has_audio=True,meta=True):
 key=f'{index:032x}';a=dict(id=key,role={'image':'ref','video':'ref_video','audio':'ref_audio'}[kind],mime={'image':'image/png','video':'video/mp4','audio':'audio/wav'}[kind],width=w if kind!='audio' else 0,height=h if kind!='audio' else 0,size=100)
 if kind!='image' and meta:a['reference']=dict(seconds=seconds,fps=fps if kind=='video' else 0,has_audio=has_audio,name='参考素材😀'+chr(127))
 assets.append(a);return key
images=[asset('image',i+1) for i in range(10)]
portrait=asset('image',11,64,96);near=asset('image',12,98,64);far=asset('image',13,100,64)
videos=[asset('video',20+i) for i in range(4)];audios=[asset('audio',30+i) for i in range(4)]
missing=asset('video',40,meta=False);silent=asset('video',41,has_audio=False);invalid=asset('video',42,fps=25)
# Execute the original ratio-selection statements unchanged, without importing a live DB.
tree=ast.parse((root/'legacy/pure/generation.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_create_video_job')
start=next(i for i,n in enumerate(fn.body) if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='ratio')
end=next(i for i,n in enumerate(fn.body[start:],start) if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Tuple) and [x.id for x in n.targets[0].elts]==['w','h'])
geometry_code=compile(ast.Module(body=fn.body[start:end+1],type_ignores=[]),'original-generation-geometry','exec')
cases=[]
def scenario(name,refs,options=None,changes=None,seconds=5,ratio='16:9',quality=480,model='MiniMax H3'):
 rows=copy.deepcopy(assets)
 for key,fields in (changes or {}).items():
  a=next(a for a in rows if a['id']==key)
  if 'reference' in fields:a['reference'].update(fields['reference'])
  else:a.update(fields)
 con.execute('DELETE FROM h3_reference_media');con.execute('DELETE FROM media')
 for a in rows:
  con.execute('INSERT INTO media VALUES(?,?,?,?,?,1)',(a['id'],a['role'],a['mime'],a['width'],a['height']))
  if 'reference' in a:
   m=a['reference'];con.execute('INSERT INTO h3_reference_media VALUES(?,?,?,?,?)',(a['id'],m['seconds'],m['fps'],int(m['has_audio']),m['name']))
 opt=h3_inputs.H3Inputs.model_validate(options) if options is not None else None
 draft=SimpleNamespace(h3=opt,model=model,refs=refs,seconds=seconds,ratio=ratio,quality=quality)
 entry=dict(name=name,input=dict(model=model,kind='video',prompt='fixture',references=refs,hasReferencePacks=False,params=dict(h3=opt.model_dump() if opt else None,seconds=seconds,ratio=ratio,quality=quality,sampling_steps=20,seed=123)),assets=rows)
 try:
  native=h3_inputs.prepare(con,draft,dict(id=1,role='admin'),1);entry['native']=native
  ids=[f['id'] for f in native['files']] if native else refs
  if not native and len(ids)>9:raise HTTPException(400,'最多选择 9 张参考图片')
  selected=[dict(con.execute('SELECT * FROM media WHERE id=?',(key,)).fetchone()) for key in ids]
  scope=dict(d=draft,native=native,refs=selected,RATIOS=RATIOS,math=math);exec(geometry_code,scope)
  entry['geometry']={k:scope[k] for k in ('ratio','w','h')}
 except HTTPException as error:entry['error']=error.detail
 cases.append(entry)
scenario('plain-empty',[]);scenario('plain-nine',images[:9]);scenario('plain-ten',images);scenario('plain-duplicate',[images[0]]*9)
for options in [dict(mode='reference'),dict(mode='frames'),dict(mode='frames',first_frame=images[0]),dict(mode='frames',last_frame=images[0]),dict(mode='frames',first_frame=images[0],last_frame=images[1]),dict(mode='frames',first_frame=images[0],last_frame=images[0])]:
 for refs in [[],[images[0]],[images[0],images[1]]]:scenario('roles-'+str(len(cases)),refs,options)
for count in [0,1,9,10]:scenario('image-limit-'+str(count),images[:count],dict(mode='reference'))
for count in [1,3,4]:
 for kind,ids in [('video',videos),('audio',audios)]:scenario(kind+'-limit-'+str(count),ids[:count],dict(mode='reference'))
scenario('twelve',images[:9]+videos[:2]+audios[:1],dict(mode='reference'))
scenario('thirteen',images[:9]+videos[:2]+audios[:2],dict(mode='reference'))
scenario('duplicate',images[:1]*2,dict(mode='reference'))
scenario('reference-forbids-frames',[],dict(mode='reference',first_frame=images[0]))
scenario('frame-forbids-video-audio',[],dict(mode='frames',video_audio=[videos[0]]))
scenario('frame-video',[],dict(mode='frames',first_frame=videos[0]))
scenario('missing-info',[missing],dict(mode='reference'))
scenario('missing-file',['f'*32],dict(mode='reference'))
scenario('wrong-role',[images[0]],dict(mode='reference'),{images[0]:dict(role='image')})
scenario('wrong-model',[],dict(mode='reference'),model='muse-video')
for id in [videos[0],silent,images[0],audios[0]]:scenario('sound-selection-'+id,[id],dict(mode='reference',video_audio=[id,id]))
scenario('wrong-fps',[invalid],dict(mode='reference'))
for other in [near,far,portrait]:scenario('aspect-'+other,[],dict(mode='frames',first_frame=images[0],last_frame=other))
for seconds in [1.9899,1.99,5.05,5.0501,15.05,15.0501]:
 for id in [videos[0],audios[0]]:scenario('duration-'+str(len(cases)),[id],dict(mode='reference'),{id:dict(reference=dict(seconds=seconds))})
for total in [15.0499,15.05,15.0501]:scenario('combined-'+str(total),audios[:2],dict(mode='reference'),{audios[0]:dict(reference=dict(seconds=7)),audios[1]:dict(reference=dict(seconds=total-7))})
for quality in [480,768]:
 for ratio in [*RATIOS,'auto']:
  for options,refs in [(None,[portrait]),(dict(mode='frames',last_frame=portrait),[]),(dict(mode='reference'),audios[:1])]:scenario('geometry-'+str(len(cases)),refs,options,ratio=ratio,quality=quality)
# Pydantic's full old receipt parser, including ignored/invalid fields.
reports=[]
values=[None,True,False,0,1,4,20,100,101,-1,1.5,'20',' 20 ','20.0','2e1','2_0','true','false','yes','off','',[],{},'NaN','Infinity','20.','20.00','2__0','_20','20_','0x10','+1.0','1e+1','1_.5','.5','1_0.2',' true ','TRUE','١٢','1._5','1_e2','1e_2','+_1','1_e_+_2','1_._5','._5','-_1','1e+_2','1e-_2','20._0','20.0_0','2_0.0','1\x85','\ufeff1']
for key in ['sampling_steps','fast_mode','peak_vram_bytes','peak_allocated_vram_bytes','prepare_s','generate_s','finalize_s','cold','recovered','h3_input_fingerprint','ignored']:
 for value in values:
  raw=json.dumps({key:value})
  try:expected=worker_api.TimingReport.model_validate_json(raw).model_dump(exclude_none=True);expected.pop('recovered',None) if 'recovered' not in json.loads(raw) else None
  except ValueError:expected={}
  reports.append(dict(raw=raw,expected=expected))
media=[]
def oracle(name,kind,args=None,job=None):
 path=out/name
 if args:subprocess.run(['ffmpeg','-v','error','-nostdin','-y',*args,str(path)],check=True,capture_output=True,timeout=30)
 entry=dict(file=name,kind=kind,job=job or dict(width=16,height=16,seconds=5))
 try:entry['result']=audio_api.validate_audio(path) if kind=='audio' else worker_api.validate_video(path,entry['job'])
 except HTTPException as e:entry['error']=e.detail
 media.append(entry)
def wav(name,frames=2400,channels=1,width=2,rate=24000,amp=32):
 with wave.open(str(out/name),'wb') as f:f.setnchannels(channels);f.setsampwidth(width);f.setframerate(rate);f.writeframes((int(amp).to_bytes(width,'little',signed=True)*channels)*frames)
 oracle(name,'audio')
for name,kwargs in [('valid.wav',{}),('negative.wav',dict(amp=-32)),('silent.wav',dict(amp=31)),('short.wav',dict(frames=2399)),('long.wav',dict(frames=2868000)),('limit.wav',dict(frames=2867999)),('stereo.wav',dict(channels=2)),('rate.wav',dict(rate=32000)),('width.wav',dict(width=1)),('round.wav',dict(frames=2430))]:wav(name,**kwargs)
raw=(out/'valid.wav').read_bytes();(out/'truncated.wav').write_bytes(raw[:-1]);oracle('truncated.wav','audio')
# PCM extensible and data-chunk padding are accepted by Python 3.12 wave.
ext=bytearray(raw[:36]+struct.pack('<HHI',22,16,4)+bytes.fromhex('0100000000001000800000aa00389b71')+raw[36:])
struct.pack_into('<I',ext,4,len(ext)-8);struct.pack_into('<I',ext,16,40);struct.pack_into('<H',ext,20,65534)
(out/'extensible.wav').write_bytes(ext);oracle('extensible.wav','audio')
odd=bytearray(raw+b'xx');struct.pack_into('<I',odd,4,len(odd)-8);struct.pack_into('<I',odd,40,4801)
(out/'odd.wav').write_bytes(odd);oracle('odd.wav','audio')
for name,first_channels,last_channels in [('multiple-fmt-valid.wav',2,1),('multiple-fmt-invalid.wav',1,2)]:
 first=bytearray(raw[12:36]);struct.pack_into('<H',first,10,first_channels)
 second=bytearray(raw[12:36]);struct.pack_into('<H',second,10,last_channels)
 content=bytearray(raw[:12]+first+second+raw[36:]);struct.pack_into('<I',content,4,len(content)-8)
 (out/name).write_bytes(content);oracle(name,'audio')

for name,rate,count,channels in [('valid.mp4',24,124,2),('rate.mp4',25,124,2),('frames.mp4',24,125,2),('channels.mp4',24,124,1)]:
 oracle(name,'video',['-f','lavfi','-i',f'color=blue:size=16x16:rate={rate}','-f','lavfi','-i','sine=sample_rate=32000:duration=6','-frames:v',str(count),'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-ac',str(channels),'-ar','32000','-shortest'])
oracle('rotated.mp4','video',['-i',str(out/'valid.mp4'),'-c','copy','-metadata:s:v:0','rotate=90'])
oracle('valid.mp4','video',job=dict(width=32,height=16,seconds=5))
(out/'broken.mp4').write_bytes((out/'valid.mp4').read_bytes()[:300]);oracle('broken.mp4','video')
# The inference worker retains Python; compare the relocated clock with the pinned one.
sys.path.insert(0,str(root/'legacy/pure/agent'))
from job_progress import JobClock
spec=importlib.util.spec_from_file_location('migrated_clock',root/'plugins/gpu/worker/clock.py');migrated=importlib.util.module_from_spec(spec);spec.loader.exec_module(migrated)
clock_snapshots=0
for steps in [1,4,20,50]:
 for cold in [True,False,None]:
  for recovered in [True,False]:
   stamp=[1000.];old=JobClock(cold,recovered,clock=lambda:stamp[0],steps=steps);new=migrated.JobClock(cold,recovered,clock=lambda:stamp[0],steps=steps)
   actions=[('observe_sampling',(None,steps)),('observe_sampling',(0,steps+1)),('observe_sampling',(-1,steps)),('observe_sampling',(0,steps)),('record_resources',({'peak_bytes':True,'peak_allocated_bytes':-1},)),('record_resources',({'peak_bytes':12345,'peak_allocated_bytes':567},)),('observe_sampling',(steps,steps)),('observe_sampling',(0,steps)),('finish_render',()),('begin_upload',()),('finish_render',(True,))]
   for name,args in actions:
    stamp[0]+=.03125;getattr(old,name)(*args);getattr(new,name)(*args);assert new.snapshot()==old.snapshot();clock_snapshots+=1
(out/'manifest.json').write_text(json.dumps(dict(inputs=cases,reports=reports,media=media,clock_snapshots=clock_snapshots),ensure_ascii=False))
print(len(cases),len(reports),len(media))
