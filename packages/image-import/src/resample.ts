/** Pillow-compatible Lanczos sampling and centered fit. Algorithm reference:
 * Pillow 13.0.0 libImaging/Resample.c and ImageOps.fit (see ../PILLOW-LICENSE).
 * Keeping the coefficient precision and pass order preserves the original crop. */
export type Pixels = {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
};
type Coeff = { start: number; values: Int32Array };
const precision = 1 << 22;
const clip = (value: number) =>
  Math.max(0, Math.min(255, Math.floor(value / precision)));
function coefficients(
  size: number,
  from: number,
  to: number,
  output: number,
): Coeff[] {
  from = Math.fround(from);
  to = Math.fround(to);
  const scale = Math.fround(to - from) / output,
    filter = Math.max(1, scale),
    support = 3 * filter;
  const sinc = (x: number) =>
    x === 0 ? 1 : Math.sin(x * Math.PI) / (x * Math.PI);
  return Array.from({ length: output }, (_, i) => {
    const center = from + (i + 0.5) * scale,
      start = Math.max(0, Math.trunc(center - support + 0.5)),
      end = Math.min(size, Math.trunc(center + support + 0.5));
    let sum = 0;
    const weights = Array.from({ length: end - start }, (_, j) => {
      const x = (start + j - center + 0.5) / filter,
        w = x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
      sum += w;
      return w;
    });
    return {
      start,
      values: Int32Array.from(weights, (w) => {
        const v = sum ? w / sum : w;
        return Math.trunc(v * precision + (v < 0 ? -0.5 : 0.5));
      }),
    };
  });
}
function pass(source: Pixels, bounds: Coeff[], horizontal: boolean): Pixels {
  const { data, channels } = source,
    width = horizontal ? bounds.length : source.width,
    height = horizontal ? source.height : bounds.length;
  const output = Buffer.allocUnsafe(width * height * channels),
    stride = horizontal ? channels : source.width * channels;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const { start, values } = bounds[horizontal ? x : y];
      const origin = horizontal
        ? (y * source.width + start) * channels
        : (start * source.width + x) * channels;
      let r = precision / 2,
        g = r,
        b = r,
        a = r;
      for (let i = 0, p = origin; i < values.length; i++, p += stride) {
        const k = values[i];
        r += data[p] * k;
        g += data[p + 1] * k;
        b += data[p + 2] * k;
        if (channels === 4) a += data[p + 3] * k;
      }
      const p = (y * width + x) * channels;
      output[p] = clip(r);
      output[p + 1] = clip(g);
      output[p + 2] = clip(b);
      if (channels === 4) output[p + 3] = clip(a);
    }
  return { data: output, width, height, channels };
}
export function resize(
  source: Pixels,
  width: number,
  height: number,
  box = [0, 0, source.width, source.height],
): Pixels {
  const horizontal = width !== source.width || box[0] !== 0 || box[2] !== width;
  const vertical =
    height !== source.height || box[1] !== 0 || box[3] !== height;
  if (!horizontal && !vertical) return source;
  const horizontalFirst = !(
    source.height - height > 0 &&
    source.height - height > (source.width - width) * 2
  );
  let image = source;
  if (source.channels === 4) {
    const data = Buffer.from(source.data);
    for (let p = 0; p < data.length; p += 4)
      for (let c = 0; c < 3; c++) {
        const value = data[p + c] * data[p + 3] + 128;
        data[p + c] = (value + (value >> 8)) >> 8;
      }
    image = { ...source, data };
  }
  const h = horizontal ? coefficients(source.width, box[0], box[2], width) : [];
  const v = vertical ? coefficients(source.height, box[1], box[3], height) : [];
  if (horizontalFirst) {
    if (horizontal) image = pass(image, h, true);
    if (vertical) image = pass(image, v, false);
  } else {
    if (vertical) image = pass(image, v, false);
    if (horizontal) image = pass(image, h, true);
  }
  if (source.channels === 4)
    for (let p = 0; p < image.data.length; p += 4) {
      const alpha = image.data[p + 3];
      if (alpha && alpha !== 255)
        for (let c = 0; c < 3; c++)
          image.data[p + c] = Math.min(
            255,
            Math.trunc((image.data[p + c] * 255) / alpha),
          );
    }
  return image;
}
export function rgb(source: Pixels): Pixels {
  if (source.channels === 3) return source;
  const data = Buffer.allocUnsafe(source.width * source.height * 3);
  for (let p = 0, j = 0; p < source.data.length; p += 4, j += 3) {
    data[j] = source.data[p];
    data[j + 1] = source.data[p + 1];
    data[j + 2] = source.data[p + 2];
  }
  return { ...source, channels: 3, data };
}
export function avatarFit(source: Pixels) {
  const size = Math.min(source.width, source.height),
    left = (source.width - size) / 2,
    top = (source.height - size) / 2;
  return resize(rgb(source), 256, 256, [left, top, left + size, top + size]);
}
export function referenceSize(width: number, height: number) {
  const factor = Math.sqrt(32_000_000 / (width * height)),
    x = Math.max(1, Math.floor(width * factor)),
    y = Math.max(1, Math.floor(height * factor)),
    aspect = width / height;
  const round = (n: number, error: (v: number) => number) =>
    Math.max(
      error(Math.floor(n)) <= error(Math.ceil(n))
        ? Math.floor(n)
        : Math.ceil(n),
      1,
    );
  return x / y >= aspect
    ? [round(y * aspect, (n) => Math.abs(aspect - n / y)), y]
    : [x, round(x / aspect, (n) => (n === 0 ? 0 : Math.abs(aspect - x / n)))];
}
