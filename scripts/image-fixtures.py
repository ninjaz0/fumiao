"""Synthetic codec cases and expected results from the immutable original importer."""
import sys,json,shutil,struct,importlib.util
from pathlib import Path
from PIL import Image,ImageCms,ImageOps
import pillow_heif

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('original_images',root/'legacy/pure/image_imports.py')
original=importlib.util.module_from_spec(spec);spec.loader.exec_module(original)
directory=Path(sys.argv[1]);directory.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(37,29))
image.putdata([((x*11+y*5)%256,(x*3+y*17)%256,(x*29+y*7)%256) for y in range(29) for x in range(37)])
rgba=image.convert('RGBA');rgba.putalpha(Image.frombytes('L',image.size,bytes((x*13+y*19)%256 for y in range(29) for x in range(37))))
profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
for name,im,fmt,opts in [
    ('rgb.png',image,'PNG',{}),('alpha.png',rgba,'PNG',{}),('rgb.jpg',image,'JPEG',{'quality':95}),
    ('rgb.webp',image,'WEBP',{'quality':90}),('alpha.webp',rgba,'WEBP',{'lossless':True}),
    ('rgb.tiff',image,'TIFF',{}),('alpha.tiff',rgba,'TIFF',{}),('cmyk.tiff',image.convert('CMYK'),'TIFF',{}),
    ('rgb.bmp',image,'BMP',{}),('pal.bmp',image.convert('P',palette=Image.Palette.ADAPTIVE),'BMP',{}),
    ('mono.bmp',image.convert('1'),'BMP',{}),('rgb.gif',image,'GIF',{}),
    ('alpha.gif',rgba,'GIF',{'transparency':0}),('srgb.png',image,'PNG',{'icc_profile':profile}),
    ('rgb.avif',image,'AVIF',{'quality':90}),('alpha.avif',rgba,'AVIF',{'quality':90}),
    ('rgb.heic',image,'HEIF',{'quality':90}),('alpha.heic',rgba,'HEIF',{'quality':90}),
    ('wide.png',image.resize((301,103)),'PNG',{}),('tall.png',image.resize((103,301)),'PNG',{}),
    ('rgb.ico',image,'ICO',{}),('rgb.ppm',image,'PPM',{}),
]: im.save(directory/name,fmt,**opts)
for orientation in range(2,9):
    exif=Image.Exif();exif[274]=orientation;image.save(directory/f'exif{orientation}.png',exif=exif)
image.save(directory/'animated.gif',save_all=True,append_images=[image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=100,loop=0)
rgba.save(directory/'animated.webp',save_all=True,append_images=[rgba.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=100,loop=0,lossless=True)
image.save(directory/'animated.png',save_all=True,append_images=[image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=100,loop=0)
image.save(directory/'single-apng.png',save_all=True,duration=100)
image.save(directory/'default-apng.png',save_all=True,default_image=True,append_images=[image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=100,loop=0)
image.save(directory/'primary.heic',save_all=True,append_images=[image.resize((41,23))],primary_index=1,icc_profile=profile)
for fmt,suffix in [('HEIF','heic'),('AVIF','avif')]:
    for orientation in range(2,9):
        exif=Image.Exif();exif[274]=orientation
        rgba.save(directory/f'exif{orientation}.{suffix}',fmt,exif=exif,quality=90,icc_profile=profile)
    image.resize((64,48)).save(directory/f'even.{suffix}',fmt,quality=90)
image.save(directory/'chroma444.heic','HEIF',quality=90,chroma='444')
gray=Image.new('I;16',(37,29));gray.putdata([(x*713+y*277)%65536 for y in range(29) for x in range(37)])
gray.save(directory/'gray16.png');gray.save(directory/'gray16.tiff')
bad=bytearray((directory/'rgb.png').read_bytes());bad[29]^=1;(directory/'bad-crc.png').write_bytes(bad)
(directory/'truncated.jpg').write_bytes((directory/'rgb.jpg').read_bytes()[:-20])
(directory/'random.bin').write_bytes(b'invalid image fixture')
bmp=bytearray((directory/'rgb.bmp').read_bytes()[:54]);struct.pack_into('<ii',bmp,18,8001,8000);(directory/'oversize.bmp').write_bytes(bmp)
manifest=[]
for source in sorted(directory.iterdir()):
    if not source.is_file():continue
    record={'name':source.name}
    for mode in ('reference','avatar'):
        out=directory/'expected'/mode/source.name;out.parent.mkdir(parents=True,exist_ok=True)
        try:
            if mode=='reference':shutil.copyfile(source,out);value=original.import_reference(out)
            else:original.import_avatar(source,out);value={}
            with Image.open(out) as decoded:
                value['output_mode']=decoded.mode;value['output_size']=list(decoded.size)
                pixels=decoded.convert('RGBA');(out.parent/(source.name+'.rgba')).write_bytes(pixels.tobytes())
            record[mode]={'ok':True,**value}
        except original.ImageImportError as e:record[mode]={'ok':False,'error':str(e)}
    manifest.append(record)
(directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(len(manifest))
