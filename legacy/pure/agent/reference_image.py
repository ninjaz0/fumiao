"""Normalize the task-local copy to the same upright pixels shown in the browser."""
from pathlib import Path
from PIL import Image, ImageOps


def normalize_reference(path):
    path = Path(path)
    staged = path.with_suffix('.normalized.png')
    try:
        with Image.open(path) as source:
            if source.format not in ('JPEG', 'PNG', 'WEBP') or source.width * source.height > 32_000_000:
                raise ValueError('参考图格式或尺寸无效')
            upright = ImageOps.exif_transpose(source)
            if upright.mode in ('I', 'I;16', 'I;16L', 'I;16B'):
                upright = upright.convert('I').point(lambda value: value * (1 / 257)).convert('L')
            rgb = upright.convert('RGB')
            # Do not carry EXIF orientation into a second decoder.
            rgb.info.pop("exif", None)
            rgb.save(staged, format='PNG')
            shape = rgb.size
        staged.replace(path)
        return shape
    finally:
        staged.unlink(missing_ok=True)
