"""Single-image geometry must be anchored; task copies normalize EXIF exactly once."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'agent')]
from reference_image import normalize_reference
# Load graph builder without importing or executing the GPU renderer.
import ast,types
source=ast.parse((ROOT/'agent/render.py').read_text())
function=next(x for x in source.body if isinstance(x,ast.FunctionDef) and x.name=='build_graph')
from job_progress import sampling_steps
namespace={'sampling_steps':sampling_steps};import node_models;namespace.update({name:getattr(node_models,name) for name in ('h3_fast_preset','h3_input_metadata','h3_reference_files')})
engine_ast=ast.parse((ROOT/'agent/vendor/engine/scripts/generate.py').read_text())
make_graph=next(x for x in engine_ast.body if isinstance(x,ast.FunctionDef) and x.name=='make_graph')
engine={'json':json,'ROOT':ROOT/'agent/vendor/engine'}
exec(compile(ast.Module(body=[make_graph],type_ignores=[]),'<graph>','exec'),engine)
namespace['h3']=types.SimpleNamespace(make_graph=engine['make_graph'])
exec(compile(ast.Module(body=[function],type_ignores=[]),'<renderer>','exec'),namespace)
build=namespace['build_graph']
shapes=[(864,480),(480,864),(480,480),(640,480),(480,640),(1120,480),(1344,768)]
for width,height in shapes:
 for refs in ([],['first'],['first','second'],list(map(str,range(9)))):
  job={'id':19,'prompt':'让 <Picture 1> 动起来','seed':123,'quality':480 if height<=864 and width<=1120 else 768,'seconds':5,'width':width,'height':height,'refs':refs}
  graph=build(job,'job-19')
  inputs=graph['5']['inputs']; assert (inputs['width'],inputs['height'])==(width,height)
  if len(refs)==1:
   assert graph['5']['class_type']=='MiniMaxH3ImageToVideo'
   assert graph['1']['inputs']['unet_name']=='minimax_h3_fl2va_pruned_bf16.safetensors'
   assert inputs['first_frame']==['22',0]
   assert graph['22']['class_type']=='ImageScale'
   assert graph['22']['inputs']=={'image':['21',0],'upscale_method':'lanczos','width':width,'height':height,'crop':'center'}
   assert not any(k.startswith('ref_images') for k in inputs)
  elif not refs:
   assert graph['5']['class_type']=='MiniMaxH3ImageToVideo' and 'first_frame' not in inputs
  else:
   assert graph['5']['class_type']=='MiniMaxH3ReferenceToVideo' and 'first_frame' not in inputs
   assert len([k for k in inputs if k.startswith('ref_images.')])==len(refs)
colors=[(255,0,0),(0,255,0),(0,0,255),(255,255,0),(255,0,255),(0,255,255)]
expected={1:([0,1,2,3,4,5],(3,2)),2:([2,1,0,5,4,3],(3,2)),3:([5,4,3,2,1,0],(3,2)),4:([3,4,5,0,1,2],(3,2)),5:([0,3,1,4,2,5],(2,3)),6:([3,0,4,1,5,2],(2,3)),7:([5,2,4,1,3,0],(2,3)),8:([2,5,1,4,0,3],(2,3))}
with tempfile.TemporaryDirectory() as d:
 for orientation,(order,shape) in expected.items():
  path=Path(d)/f'{orientation}.png'
  im=Image.new('RGB',(3,2));im.putdata(colors);exif=Image.Exif();exif[274]=orientation;im.save(path,exif=exif)
  assert normalize_reference(path)==shape
  with Image.open(path) as result:
   assert result.format=='PNG' and result.getexif().get(274) is None
   assert list(result.get_flattened_data())==[colors[i] for i in order]
  first=path.read_bytes();normalize_reference(path);assert path.read_bytes()==first
 # JPEG bytes stored under a PNG task filename are genuinely converted to PNG.
 path=Path(d)/'reference.png';im=Image.new('RGB',(96,64),(25,70,120));im.save(path,format='JPEG')
 normalize_reference(path)
 with Image.open(path) as result:assert result.format=='PNG' and result.size==(96,64)
with tempfile.TemporaryDirectory() as d:
 import struct
 path=Path(d)/'16-bit.png'
 Image.frombytes('I;16',(3,1),struct.pack('<3H',0,32768,65535)).save(path)
 normalize_reference(path)
 with Image.open(path) as result:
  values=list(result.get_flattened_data())
  assert values[0]==(0,0,0) and values[2]==(255,255,255) and 127<=values[1][0]<=128
print('PASS all eight EXIF orientations, repeat normalization, real PNG input, single-image FL2V anchor, center crop and multi-reference routing')

# The return path rejects display-matrix rotation instead of validating only coded dimensions.
import os,subprocess
from fastapi import HTTPException
with tempfile.TemporaryDirectory() as d:
 os.environ['FUMIAO_DATA']=str(Path(d)/'data')
 sys.path.insert(0,str(ROOT))
 from worker_api import validate_video
 base=Path(d)/'base.mp4'; rotated=Path(d)/'rotated.mp4'
 subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=size=864x480:rate=24','-f','lavfi','-i','anullsrc=r=32000:cl=stereo','-t','5.166667','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(base)],check=True)
 subprocess.run(['ffmpeg','-v','error','-display_rotation:v:0','90','-i',str(base),'-c','copy',str(rotated)],check=True)
 validate_video(base,{'width':864,'height':480,'seconds':5})
 try:
  validate_video(rotated,{'width':864,'height':480,'seconds':5})
  raise AssertionError('rotation metadata accepted')
 except HTTPException as error:assert error.status_code==422
print('PASS zero-rotation MP4 validation and rejection of sideways display metadata')
