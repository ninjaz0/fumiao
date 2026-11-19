"""Reject the observed collapsed-grey I2V failure without grading artistic quality."""
import math
from PIL import Image, ImageOps, ImageStat


class VideoQualityError(RuntimeError):
    pass


def check_first_frame(reference, frame):
    with Image.open(frame) as opened:
        shape = opened.size
        output = opened.convert('RGB').resize((64,64))
    with Image.open(reference) as opened:
        source = ImageOps.fit(ImageOps.exif_transpose(opened).convert('RGB'),shape,method=Image.Resampling.LANCZOS).resize((64,64))
    source_stats, output_stats = ImageStat.Stat(source), ImageStat.Stat(output)
    source_detail = sum(source_stats.stddev)/3
    output_detail = sum(output_stats.stddev)/3
    a = [v-source_stats.mean[c] for p in source.getdata() for c,v in enumerate(p)]
    b = [v-output_stats.mean[c] for p in output.getdata() for c,v in enumerate(p)]
    norm = math.sqrt(sum(v*v for v in a)*sum(v*v for v in b))
    correlation = sum(x*y for x,y in zip(a,b))/norm if norm else 0
    result = {'version':1,'reference_std':round(source_detail,3),'first_frame_std':round(output_detail,3),'first_frame_correlation':round(correlation,4)}
    if source_detail>=20 and output_detail<max(8,source_detail*.2) and correlation<.3:
        raise VideoQualityError('生成画面异常：首帧退化为灰色噪点，结果未发布。')
    return result
