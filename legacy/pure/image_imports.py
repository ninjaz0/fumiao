"""Decode common still-image containers into browser/model-compatible references."""
import io
import math
import threading
from pathlib import Path
from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

register_heif_opener(thumbnails=False)
SUPPORTED = frozenset(('JPEG', 'PNG', 'WEBP', 'HEIF', 'AVIF', 'TIFF', 'BMP', 'GIF'))
PASSTHROUGH = frozenset(('JPEG', 'PNG', 'WEBP'))
MAX_INPUT_PIXELS = 64_000_000
MAX_REFERENCE_PIXELS = 32_000_000
MAX_REFERENCE_BYTES = 32 << 20
DECODE_LOCK = threading.Lock()
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))


class ImageImportError(ValueError):
    pass


def inspect_image(path):
    try:
        with Image.open(path) as source:
            if source.format not in SUPPORTED:
                raise ImageImportError('不支持该图片格式')
            if source.width * source.height > MAX_INPUT_PIXELS:
                raise ImageImportError('图片不能超过 6400 万像素')
            fmt = source.format
            # HEIF opens its designated primary image, not necessarily frame zero.
            frame = source.tell()
            animated = bool(getattr(source, 'is_animated', False))
            source.verify()
            return fmt, frame, animated
    except ImageImportError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, EOFError, ValueError, RuntimeError) as error:
        raise ImageImportError('无法读取图片，文件可能已损坏或格式不受支持') from error


def standard_pixels(source):
    image = ImageOps.exif_transpose(source)
    if image.mode in ('I;16', 'I;16L', 'I;16B'):
        image = image.convert('I').point(lambda value: value / 257).convert('L')
    alpha = 'A' in image.getbands() or 'transparency' in image.info
    mode = 'RGBA' if alpha else 'RGB'
    profile = source.info.get('icc_profile')
    if profile:
        try:
            if image.mode == 'P':
                image = image.convert(mode)
            image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), SRGB, outputMode=mode)
        except (ImageCms.PyCMSError, OSError, ValueError, TypeError):
            image = image.convert(mode)
    else:
        image = image.convert(mode)
    # Rotation is already applied; never carry its EXIF flag into another decoder.
    image.info.clear()
    return image


def import_reference(path):
    path = Path(path)
    converted = path.with_name(path.name + '.converted')
    with DECODE_LOCK:
        fmt, frame, animated = inspect_image(path)
        image = None
        try:
            with Image.open(path) as source:
                source.seek(frame)
                source.load()
                w, h = source.size
                if fmt in PASSTHROUGH and not animated and w*h <= MAX_REFERENCE_PIXELS:
                    if source.getexif().get(274) in (5, 6, 7, 8):
                        w, h = h, w
                    return dict(w=w,h=h,size=path.stat().st_size,mime=Image.MIME[fmt],source_format=fmt,
                                converted=False,resized=False,first_frame=False)
                resized = w*h > MAX_REFERENCE_PIXELS
                image = standard_pixels(source)
            if resized:
                factor = math.sqrt(MAX_REFERENCE_PIXELS/(image.width*image.height))
                image.thumbnail((max(1,int(image.width*factor)),max(1,int(image.height*factor))),Image.Resampling.LANCZOS)
            output_format = 'PNG' if image.mode=='RGBA' else 'JPEG'
            for attempt in range(4):
                if output_format=='JPEG':
                    image.save(converted,'JPEG',quality=95,subsampling=0,optimize=True,icc_profile=SRGB.tobytes())
                else:
                    image.save(converted,'PNG',icc_profile=SRGB.tobytes())
                size = converted.stat().st_size
                if size <= MAX_REFERENCE_BYTES:
                    break
                factor = min(.85, math.sqrt(MAX_REFERENCE_BYTES/size)*.85)
                image = image.resize((max(1,int(image.width*factor)),max(1,int(image.height*factor))),Image.Resampling.LANCZOS)
                resized = True
            else:
                raise ImageImportError('转换后的图片过大，请缩小图片后重试')
            w,h = image.size
            converted.replace(path)
            return dict(w=w,h=h,size=size,mime=Image.MIME[output_format],source_format=fmt,
                        converted=True,resized=resized,first_frame=animated and fmt!='HEIF')
        except ImageImportError:
            raise
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, EOFError, ValueError, RuntimeError) as error:
            raise ImageImportError('无法读取图片，文件可能已损坏') from error
        finally:
            if image is not None:
                image.close()
            converted.unlink(missing_ok=True)


def import_avatar(path, output):
    with DECODE_LOCK:
        _, frame, _ = inspect_image(path)
        try:
            with Image.open(path) as source:
                source.seek(frame)
                source.load()
                image = standard_pixels(source)
            avatar = ImageOps.fit(image.convert('RGB'),(256,256),method=Image.Resampling.LANCZOS)
            avatar.save(output,'WEBP',quality=88,icc_profile=SRGB.tobytes())
            avatar.close();image.close()
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, EOFError, ValueError, RuntimeError) as error:
            raise ImageImportError('无法读取图片，文件可能已损坏') from error
