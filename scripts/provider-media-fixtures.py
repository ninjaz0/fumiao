"""Original media inspection oracle with synthetic files and no provider calls."""
import json, os, struct, subprocess, sys, zlib
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]; out=Path(sys.argv[1]); out.mkdir(parents=True,exist_ok=True)
os.environ['FUMIAO_DATA']=str(out/'runtime');sys.path.insert(0,str(root/'legacy/pure'))
import muse_provider
cases=[]
def inspect(name,kind):
    entry=dict(file=name,kind=kind)
    try:
        mime,actual=muse_provider.inspect_media(out/name,kind);entry['metadata']=dict(mime=mime,**actual)
    except Exception as error:
        entry['failure']=dict(value=isinstance(error,ValueError),message=str(error) if isinstance(error,ValueError) else None)
    cases.append(entry)
image=Image.new('RGB',(37,29),'blue')
for fmt,suffix in [('PNG','png'),('JPEG','jpg'),('WEBP','webp')]:
    for orientation in range(1,9):
        name=f'orientation-{orientation}.{suffix}';exif=Image.Exif();exif[274]=orientation
        image.save(out/name,fmt,exif=exif);inspect(name,'image')
for fmt,suffix in [('GIF','gif'),('TIFF','tiff'),('BMP','bmp'),('ICO','ico'),('PPM','ppm'),('PCX','pcx'),('TGA','tga')]:
    name='unsupported.'+suffix;image.save(out/name,fmt);inspect(name,'image')
for fmt,suffix in [('PNG','png'),('WEBP','webp')]:
    name='animated.'+suffix;image.save(out/name,fmt,save_all=True,append_images=[Image.new('RGB',image.size,'red')],duration=100,loop=0);inspect(name,'image')
image.save(out/'default-apng.png','PNG',save_all=True,default_image=True,append_images=[image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=100);inspect('default-apng.png','image')
for mode in ['RGBA','L','LA','P','1','I;16']:
    name='mode-'+mode.replace(';','')+'.png';image.convert(mode).save(out/name);inspect(name,'image')
image.convert('CMYK').save(out/'cmyk.jpg');inspect('cmyk.jpg','image')
for name,data in [('random.bin',b'not an image'),('empty.bin',b''),('truncated.jpg',(out/'orientation-1.jpg').read_bytes()[:-20]),('no-eoi.jpg',(out/'orientation-1.jpg').read_bytes()[:-2]),('truncated.webp',(out/'orientation-1.webp').read_bytes()[:-8]),('truncated.png',(out/'orientation-1.png').read_bytes()[:60]),('no-iend.png',(out/'orientation-1.png').read_bytes()[:-12]),('image.svg',b'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48"><rect width="32" height="48" fill="red"/></svg>')]:
    (out/name).write_bytes(data);inspect(name,'image')
for name,offset in [('bad-header-crc.png',29),('bad-idat-crc.png',None)]:
    data=bytearray((out/'orientation-1.png').read_bytes())
    if offset is None:
        pos=data.index(b'IDAT');size=struct.unpack('>I',data[pos-4:pos])[0];offset=pos+4+size
    data[offset]^=1;(out/name).write_bytes(data);inspect(name,'image')
for width,name in [(6400,'pixel-limit.png'),(6401,'pixel-over.png')]:
    large=Image.new('RGB',(width,5000),'blue');large.save(out/name);large.close();inspect(name,'image')
data=bytearray((out/'orientation-1.png').read_bytes());data[16:24]=struct.pack('>II',20000,20000);data[29:33]=struct.pack('>I',zlib.crc32(data[12:29]));(out/'pixel-bomb.png').write_bytes(data);inspect('pixel-bomb.png','image')
def video(name,args):
    subprocess.run(['ffmpeg','-v','error','-y',*args,str(out/name)],check=True,timeout=60,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);inspect(name,'video')
base=['-f','lavfi','-i','color=blue:size=32x24:rate=25','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p']
video('valid.mp4',base);video('valid.mov',base);video('valid.mkv',base)
video('valid.webm',['-f','lavfi','-i','color=blue:size=32x24:rate=25','-t','1','-c:v','libvpx-vp9','-threads','1'])
for angle in [0,90,180,270,360]:video(f'rotation-{angle}.mp4',['-i',str(out/'valid.mp4'),'-c','copy','-metadata:s:v:0',f'rotate={angle}'])
for width in [8192,8194]:video(f'width-{width}.mp4',['-f','lavfi','-i',f'color=blue:size={width}x16:rate=1','-t','1','-c:v','libx264','-threads','1'])
for seconds in [120,121]:video(f'duration-{seconds}.mp4',['-f','lavfi','-i','color=blue:size=16x16:rate=1','-t',str(seconds),'-c:v','libx264','-threads','1'])
video('short.mp4',['-f','lavfi','-i','color=blue:size=16x16:rate=1000','-frames:v','1','-c:v','libx264','-threads','1'])
video('audio-only.mp4',['-f','lavfi','-i','sine=duration=1','-c:a','aac'])
video('invalid.ts',['-i',str(out/'valid.mp4'),'-c','copy','-f','mpegts'])
for name,data in [('corrupt.mp4',b'\0\0\0\x20ftypisom'+b'\0'*40),('empty.mp4',b''),('truncated.mp4',(out/'valid.mp4').read_bytes()[:128]),('png-as-video.mp4',(out/'orientation-1.png').read_bytes())]:
    (out/name).write_bytes(data);inspect(name,'video')
(out/'manifest.json').write_text(json.dumps(cases,ensure_ascii=False))
