"""Real binary codec tests, canonical references and existing model input compatibility."""
import io,json,os,sys,tempfile,uuid,hashlib,shutil
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageDraw,ImageOps
from fastapi.testclient import TestClient
sandbox=tempfile.TemporaryDirectory()
os.environ.update(FUMIAO_DATA=sandbox.name,FUMIAO_SITE='http://testserver')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import core,image_imports
from server import app
from credit_fixtures import fund_test_accounts
fund_test_accounts()
from agent.reference_image import normalize_reference

def okay(r):
    assert r.is_success,(r.status_code,r.text[:500])
    return r.json()
key=core.token()
with core.db(True) as con:con.execute("INSERT INTO registration_codes(code,role,expires) VALUES(?,'admin',?)",(key,core.now()+90))
c=TestClient(app);okay(c.post('/api/register',json={"nickname": '格式验收', 'name':'格式验收','password':'image-format-test-2026','code':key}))
image=Image.new('RGB',(240,160),'#c53432');draw=ImageDraw.Draw(image);draw.rectangle((120,0,239,79),fill='#2caa4a');draw.rectangle((0,80,119,159),fill='#3a60d0');draw.rectangle((120,80,239,159),fill='#e9cb35')
def encoded(fmt,im=image,**options):
    out=io.BytesIO();im.save(out,format=fmt,**options);return out.getvalue()
def upload(raw):return okay(c.post('/api/assets',content=raw,headers={'Content-Type':'application/octet-stream'}))
def check(raw,expected_format,first=False):
    result=upload(raw)
    assert result['source_format']==expected_format and result['first_frame']==first,result
    response=c.get('/media/'+result['id']);assert response.status_code==200
    assert response.headers['content-type'].split(';')[0]==result['mime']
    decoded=Image.open(io.BytesIO(response.content));decoded.load()
    assert decoded.size==(result['w'],result['h'])
    assert decoded.format in ('JPEG','PNG','WEBP')
    with core.db() as con:
        row=con.execute('SELECT * FROM media WHERE id=?',(result['id'],)).fetchone()
        assert row['size']==len(response.content) and row['mime']==result['mime']
    assert TestClient(app).get('/media/'+result['id']).status_code==401
    # The existing agent consumes only its original three formats, with no HEIF dependency.
    path=Path(sandbox.name)/'worker-reference.png';path.write_bytes(response.content)
    assert normalize_reference(path)==(result['w'],result['h'])
    assert Image.open(path).format=='PNG'
    return result,decoded,response.content
for fmt in ('JPEG','PNG','WEBP'):
    raw=encoded(fmt);result,_,returned=check(raw,fmt)
    assert returned==raw and result['converted'] is False
for fmt in ('BMP','TIFF','GIF','AVIF','HEIF'):
    raw=encoded(fmt,quality=90) if fmt in ('AVIF','HEIF') else encoded(fmt)
    result,decoded,_=check(raw,fmt)
    assert result['converted'] and decoded.size==(240,160)
    assert decoded.getpixel((25,25))[0]>150 and decoded.getpixel((200,25))[1]>100
    if fmt=='HEIF':
        assert raw[4:8]==b'ftyp'
        Path('/tmp/fumiao-format-test.heic').write_bytes(raw)
        heic=raw
# Primary HEIF frame can have a nonzero index and must not be replaced by frame zero.
second=Image.new('RGB',(160,120),'#2caa4a')
raw=encoded('HEIF',save_all=True,append_images=[second],primary_index=1,quality=90)
with Image.open(io.BytesIO(raw)) as source:
    primary=source.tell();primary_size=source.size
result,decoded,_=check(raw,'HEIF')
assert primary==1 and decoded.size==primary_size and decoded.getpixel((20,20))[1]>100
# Animated and multipage formats become the first still; the API explicitly reports it.
for fmt in ('GIF','PNG','WEBP','TIFF'):
    raw=encoded(fmt,save_all=True,append_images=[Image.new('RGB',image.size,'blue')],duration=100,loop=0)
    result,decoded,_=check(raw,fmt,first=True)
    assert decoded.getpixel((25,25))[0]>150 and not getattr(decoded,'is_animated',False)
# Keep transparency in a canonical PNG.
alpha=Image.new('RGBA',(120,80),(0,0,0,0));ImageDraw.Draw(alpha).rectangle((20,20,80,60),fill=(240,70,40,255))
result,decoded,_=check(encoded('AVIF',alpha,quality=95),'AVIF')
assert result['mime']=='image/png' and decoded.mode=='RGBA' and decoded.getpixel((0,0))[3]==0
# 16-bit grayscale must not be clipped to white during conversion.
gray=Image.new('I;16',(64,64),32768)
_,decoded,_=check(encoded('TIFF',gray),'TIFF');assert 120<decoded.getpixel((20,20))[0]<136
# EXIF orientation is applied once for converted formats; original JPEG bytes stay intact.
exif=Image.Exif();exif[274]=6
raw=encoded('HEIF',exif=exif.tobytes(),quality=90)
result,decoded,_=check(raw,'HEIF')
assert decoded.size==(160,240) and decoded.getexif().get(274) in (None,1)
assert decoded.getpixel((130,30))[0]>150
raw=encoded('JPEG',exif=exif)
r=upload(raw);assert (r['w'],r['h'])==(160,240) and c.get('/media/'+r['id']).content==raw
# Mirror and rotation transforms must agree with the displayed photo for all EXIF orientations.
for orientation in range(1,9):
    e=Image.Exif();e[274]=orientation
    original=image.copy();expected=image.copy();expected.info['exif']=e.tobytes();expected=ImageOps.exif_transpose(expected)
    _,decoded,_=check(encoded('HEIF',original,exif=e.tobytes(),quality=95),'HEIF')
    assert decoded.size==expected.size,(orientation,decoded.size,expected.size)
    assert max(abs(a-b) for a,b in zip(decoded.getpixel((25,25)),expected.getpixel((25,25))))<15,orientation

# HEIC avatars use the same decoder but stay standard 256px WebP.
a=okay(c.put('/api/me/avatar',content=heic));avatar=Image.open(io.BytesIO(c.get(a['avatar_url']).content));assert avatar.format=='WEBP' and avatar.size==(256,256)
# Real 48MP source images fit the existing 32MP reference limit after orientation normalization.
large=Image.new('RGB',(8000,6000),'#88aabb');raw=encoded('PNG',large);large.close()
r=upload(raw);assert r['resized'] and r['w']*r['h']<=32_000_000
# Enforce the post-conversion byte budget too, not just the uploaded source size.
noise=Image.effect_noise((240,160),100).convert('RGB')
with patch.object(image_imports,'MAX_REFERENCE_BYTES',4000):
    r=upload(encoded('TIFF',noise));assert r['resized'] and r['size']<=4000
# Decode failures and quota rejections leave neither a database record nor staging garbage.
with core.db() as con:before=con.execute('SELECT count(*) FROM media').fetchone()[0]
for invalid in (b'not a real HEIC file',heic[:50],b'<svg><script>alert(1)</script></svg>'):
    assert c.post('/api/assets',content=invalid).status_code==400
with patch.object(image_imports.Image,'open',side_effect=RuntimeError('decoder error')):
    assert c.post('/api/assets',content=heic).status_code==400
with patch.object(core,'QUOTA',1):assert c.post('/api/assets',content=heic).status_code==507
with core.db() as con:
    assert con.execute('SELECT count(*) FROM media').fetchone()[0]==before
    assert not list(con.execute('PRAGMA foreign_key_check'))
assert not list(core.stage_dir.iterdir())
print('PASS actual HEIC/HEIF primary frames, AVIF, TIFF16, BMP, GIF/APNG/WebP first frames, alpha, EXIF, original-byte preservation, 48MP scaling, encoded quota, avatars and GPU-compatible outputs')
