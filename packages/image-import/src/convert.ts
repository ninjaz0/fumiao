import sharp, { type Metadata } from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { parseGIF, decompressFrame } from "gifuct-js";
import {
  decode as decodeAVIF,
  init as initAVIF,
} from "@phenomen/libavif-wasm/decode";
import { avatarFit, referenceSize, resize, type Pixels } from "./resample.js";
const profile = fileURLToPath(new URL("../srgb.icc", import.meta.url));
const heifDecoder = fileURLToPath(
  new URL("../native/build/bin/heif-decode", import.meta.url),
);
// Native codec caches are per worker; pixel and worker limits bound resident memory.
sharp.cache(false);
sharp.concurrency(1);
export class ImageImportError extends Error {}
class ImageRuntimeError extends Error {}
const inspectError = "无法读取图片，文件可能已损坏或格式不受支持";
const decodeError = "无法读取图片，文件可能已损坏";
const formats: Record<string, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WEBP",
  heif: "HEIF",
  avif: "AVIF",
  tiff: "TIFF",
  gif: "GIF",
};
export type ImportResult = {
  w: number;
  h: number;
  size: number;
  mime: string;
  source_format: string;
  converted: boolean;
  resized: boolean;
  first_frame: boolean;
};
function dimensions(width: number, height: number) {
  if (width * height > 64_000_000)
    throw new ImageImportError("图片不能超过 6400 万像素");
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new ImageImportError(inspectError);
}
function verifyPNG(bytes: Buffer) {
  for (let i = 8; i + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(i),
      end = i + 12 + size;
    if (
      end > bytes.length ||
      crc32(bytes.subarray(i + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new ImageImportError(inspectError);
    if (bytes.toString("ascii", i + 4, i + 8) === "IEND") return;
    i = end;
  }
  throw new ImageImportError(inspectError);
}
function pngAnimated(bytes: Buffer) {
  let frames = 0,
    frameControl = false;
  for (let i = 8; i + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(i),
      type = bytes.toString("ascii", i + 4, i + 8);
    if (type === "acTL") frames = bytes.readUInt32BE(i + 8);
    if (type === "fcTL") frameControl = true;
    // A separate default image counts as an additional frame in Pillow. A
    // single-frame APNG with its first fcTL before IDAT is a static passthrough.
    if (type === "IDAT") return frames > 1 || (frames > 0 && !frameControl);
    i += size + 12;
  }
  return false;
}
function gifPixels(bytes: Buffer): Pixels {
  const gif = parseGIF(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ),
    frame = gif.frames.find((f) => "image" in f);
  if (!frame || !("image" in frame)) throw new Error("GIF has no frame");
  dimensions(frame.image.descriptor.width, frame.image.descriptor.height);
  const decoded = decompressFrame(frame, gif.gct, false),
    width = Math.max(gif.lsd.width, decoded.dims.left + decoded.dims.width),
    height = Math.max(gif.lsd.height, decoded.dims.top + decoded.dims.height);
  dimensions(width, height);
  const channels = decoded.transparentIndex === undefined ? 3 : 4,
    data = Buffer.alloc(width * height * channels);
  const write = (offset: number, index: number) => {
    const color = decoded.colorTable?.[index] || [index, index, index];
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    if (channels === 4)
      data[offset + 3] = index === decoded.transparentIndex ? 0 : 255;
  };
  for (let p = 0; p < data.length; p += channels) write(p, 0);
  for (let y = 0; y < decoded.dims.height; y++)
    for (let x = 0; x < decoded.dims.width; x++)
      write(
        ((y + decoded.dims.top) * width + x + decoded.dims.left) * channels,
        decoded.pixels[y * decoded.dims.width + x],
      );
  return { data, width, height, channels };
}
function attachProfile(png: Buffer, icc: Buffer) {
  const data = Buffer.concat([Buffer.from("ICC\0\0"), deflateSync(icc)]),
    chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("iCCP", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
function decodeProcess(command: string, args: string[], maxBuffer: number) {
  try {
    // Called only inside an isolated Worker. A synchronous wait ensures worker
    // termination cannot release staging files while an external decoder runs.
    return execFileSync(command, args, {
      maxBuffer,
      timeout: 60000,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: any) {
    if (["ENOENT", "EACCES", "ETIMEDOUT"].includes(error.code))
      throw new ImageRuntimeError("Image decoder unavailable");
    throw error;
  }
}
async function heifPixels(path: string, info: Metadata): Promise<Pixels> {
  const raw = decodeProcess(heifDecoder, [path], 64_000_000 * 4 + 16);
  if (raw.length < 16 || raw.toString("ascii", 0, 4) !== "FMI1")
    throw new Error("Invalid HEIF output");
  const width = raw.readUInt32LE(4),
    height = raw.readUInt32LE(8),
    channels = raw.readUInt32LE(12);
  dimensions(width, height);
  if (
    (channels !== 3 && channels !== 4) ||
    raw.length !== 16 + width * height * channels
  )
    throw new Error("Incomplete HEIF output");
  let source = sharp(raw.subarray(16), { raw: { width, height, channels } });
  // libheif applies container rotation. ICC conversion is applied exactly once.
  if (info.icc)
    source = sharp(attachProfile(await source.png().toBuffer(), info.icc));
  const decoded = await source
    .withIccProfile(profile, { attach: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    channels: decoded.info.channels as 3 | 4,
  };
}
let avifInitialized = false;
async function avifPixels(
  path: string,
  bytes: Buffer,
  info: Metadata,
): Promise<Pixels> {
  if (!avifInitialized) {
    await initAVIF();
    avifInitialized = true;
  }
  const image = await decodeAVIF(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  if (!image) throw new Error("AVIF decode failed");
  dimensions(image.width, image.height);
  let source = sharp(Buffer.from(image.data.buffer), {
    raw: { width: image.width, height: image.height, channels: 4 },
  });
  if (!info.hasAlpha) source = source.removeAlpha();
  // libavif returns an untransformed primary frame. Sharp's metadata already
  // swaps dimensions for irot and does not expose the original orientation.
  // Read the primary item's ordered irot/imir properties with the same bounded
  // container parser used for HEIF, then apply each lossless transform once.
  const transforms = JSON.parse(
    decodeProcess(heifDecoder, ["--transforms", path], 4096).toString(),
  );
  if (!Array.isArray(transforms) || transforms.length > 16)
    throw new Error("Invalid AVIF transformations");
  for (const transform of transforms) {
    if (
      transform.type === "rotate" &&
      [0, 90, 180, 270].includes(transform.value)
    )
      source = source.rotate((360 - transform.value) % 360);
    else if (transform.type === "mirror" && [0, 1].includes(transform.value))
      source = transform.value === 0 ? source.flip() : source.flop();
    else throw new Error("Invalid AVIF transformation");
    const pixels = await source.raw().toBuffer({ resolveWithObject: true });
    source = sharp(pixels.data, { raw: pixels.info });
  }
  let png = await source.png().toBuffer();
  if (info.icc) png = attachProfile(png, info.icc);
  const out = await sharp(png)
    .autoOrient()
    .withIccProfile(profile, { attach: false })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: out.data,
    width: out.info.width,
    height: out.info.height,
    channels: out.info.channels as 3 | 4,
  };
}
function bmpInfo(bytes: Buffer) {
  const header = bytes.readUInt32LE(14);
  if (
    ![12, 40, 52, 56, 64, 108, 124].includes(header) ||
    bytes.length < 14 + header
  )
    throw new Error("Invalid BMP header");
  const width = header === 12 ? bytes.readUInt16LE(18) : bytes.readInt32LE(18),
    height = Math.abs(
      header === 12 ? bytes.readUInt16LE(20) : bytes.readInt32LE(22),
    );
  dimensions(width, height);
  const bits = bytes.readUInt16LE(header === 12 ? 24 : 28),
    compression = header === 12 ? 0 : bytes.readUInt32LE(30);
  if (
    ![1, 4, 8, 16, 24, 32].includes(bits) ||
    ![0, 1, 2, 3].includes(compression)
  )
    throw new Error("Unsupported BMP encoding");
  const alpha =
    bits === 32 &&
    compression === 3 &&
    header >= 56 &&
    bytes.readUInt32LE(66) !== 0;
  return { width, height, alpha };
}
async function bmpPixels(
  path: string,
  info: ReturnType<typeof bmpInfo>,
): Promise<Pixels> {
  // FFmpeg is already required for private media inspection and storyboard plugins.
  // Its BMP decoder includes palette, bitfield, RLE and OS/2 variants.
  const channels = info.alpha ? 4 : 3;
  const stdout = decodeProcess(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-threads",
      "1",
      "-i",
      path,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      channels === 4 ? "rgba" : "rgb24",
      "pipe:1",
    ],
    info.width * info.height * channels + 4096,
  );
  if (stdout.length !== info.width * info.height * channels)
    throw new Error("Incomplete BMP");
  return { data: stdout, width: info.width, height: info.height, channels };
}
async function ordinaryPixels(path: string, info: Metadata): Promise<Pixels> {
  let source = sharp(path, {
    limitInputPixels: 64_000_000,
    failOn: "warning",
    page: 0,
    pages: 1,
  }).autoOrient();
  // Pillow converts 16-bit grayscale by dividing by 257, instead of dropping its
  // low byte. Keep this normalization independent from 16-bit RGB container input.
  if (info.depth === "ushort" && info.channels === 1) {
    const raw = await source
        .pipelineColourspace("grey16")
        .toColourspace("grey16")
        .raw({ depth: "ushort" })
        .toBuffer({ resolveWithObject: true }),
      data = Buffer.allocUnsafe(raw.info.width * raw.info.height * 3);
    for (let p = 0; p < raw.data.length; p += 2) {
      const value = Math.trunc(raw.data.readUInt16LE(p) / 257),
        out = (p / 2) * 3;
      data[out] = data[out + 1] = data[out + 2] = value;
    }
    return {
      data,
      width: raw.info.width,
      height: raw.info.height,
      channels: 3,
    };
  }
  if (info.space === "cmyk" && !info.icc) {
    const raw = await source
        .pipelineColourspace("cmyk")
        .toColourspace("cmyk")
        .raw()
        .toBuffer({ resolveWithObject: true }),
      data = Buffer.allocUnsafe(raw.info.width * raw.info.height * 3);
    for (let p = 0, j = 0; p < raw.data.length; p += 4, j += 3)
      for (let c = 0; c < 3; c++) {
        const product = (255 - raw.data[p + c]) * (255 - raw.data[p + 3]) + 128;
        data[j + c] = (product + (product >> 8)) >> 8;
      }
    return {
      data,
      width: raw.info.width,
      height: raw.info.height,
      channels: 3,
    };
  }
  const raw = await source
    .withIccProfile(profile, { attach: false })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: raw.data,
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels as 3 | 4,
  };
}
export async function convertImage(
  input: string,
  output: string,
  mode: "reference" | "avatar",
): Promise<ImportResult> {
  const bytes = await readFile(input);
  let info: Metadata | undefined,
    bmp: ReturnType<typeof bmpInfo> | undefined,
    format: string,
    animated = false;
  try {
    if (
      bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) ||
      /^P[1-6]\s/.test(bytes.toString("ascii", 0, 3)) ||
      bytes.toString("ascii", 0, 4) === "8BPS"
    )
      throw new ImageImportError("不支持该图片格式");
    if (bytes.toString("ascii", 0, 2) === "BM") {
      bmp = bmpInfo(bytes);
      format = "BMP";
    } else {
      info = await sharp(bytes, {
        limitInputPixels: 64_000_000,
        failOn: "warning",
      }).metadata();
      if (info.format === "heif" && info.compression === "av1") format = "AVIF";
      else format = formats[info.format || ""];
      if (!format)
        throw new ImageImportError(
          info.format === "svg" ? inspectError : "不支持该图片格式",
        );
      if (format === "HEIF" && info.pagePrimary)
        info = await sharp(bytes, {
          page: info.pagePrimary,
          limitInputPixels: 64_000_000,
        }).metadata();
      dimensions(info.width, info.height);
      animated = (info.pages || 1) > 1;
      if (format === "PNG") {
        verifyPNG(bytes);
        animated = pngAnimated(bytes);
      }
    }
  } catch (error) {
    if (error instanceof ImageImportError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message))
      throw new ImageImportError("图片不能超过 6400 万像素");
    throw new ImageImportError(inspectError);
  }
  try {
    // Decode even passthrough files to reject corrupt/truncated payloads before persistence.
    let pixels =
      format === "GIF"
        ? gifPixels(bytes)
        : format === "AVIF"
          ? await avifPixels(input, bytes, info!)
          : bmp
            ? await bmpPixels(input, bmp)
            : format === "HEIF"
              ? await heifPixels(input, info!)
              : await ordinaryPixels(input, info!);
    if (
      mode === "reference" &&
      ["JPEG", "PNG", "WEBP"].includes(format) &&
      !animated &&
      info!.width * info!.height <= 32_000_000
    ) {
      await writeFile(output, bytes, { mode: 0o600 });
      const rotated = [5, 6, 7, 8].includes(info!.orientation || 0);
      return {
        w: rotated ? info!.height : info!.width,
        h: rotated ? info!.width : info!.height,
        size: bytes.length,
        mime: "image/" + (format === "JPEG" ? "jpeg" : format.toLowerCase()),
        source_format: format,
        converted: false,
        resized: false,
        first_frame: false,
      };
    }
    let resized = pixels.width * pixels.height > 32_000_000;
    if (mode === "avatar") pixels = avatarFit(pixels);
    else if (resized) {
      const [w, h] = referenceSize(pixels.width, pixels.height);
      pixels = resize(pixels, w, h);
    }
    const mime =
      mode === "avatar"
        ? "image/webp"
        : pixels.channels === 4
          ? "image/png"
          : "image/jpeg";
    for (let attempt = 0; attempt < 4; attempt++) {
      const image = sharp(pixels.data, {
        raw: {
          width: pixels.width,
          height: pixels.height,
          channels: pixels.channels,
        },
      }).withIccProfile(profile);
      const data = await (
        mode === "avatar"
          ? image.webp({ quality: 88, effort: 4 })
          : pixels.channels === 4
            ? image.png({ compressionLevel: 6 })
            : image.jpeg({
                quality: 95,
                chromaSubsampling: "4:4:4",
                optimiseCoding: true,
              })
      ).toBuffer();
      if (data.length <= 32 << 20) {
        await writeFile(output, data, { mode: 0o600 });
        return {
          w: pixels.width,
          h: pixels.height,
          size: data.length,
          mime,
          source_format: format,
          converted: true,
          resized,
          first_frame: animated && format !== "HEIF",
        };
      }
      const factor = Math.min(0.85, Math.sqrt((32 << 20) / data.length) * 0.85);
      pixels = resize(
        pixels,
        Math.max(1, Math.floor(pixels.width * factor)),
        Math.max(1, Math.floor(pixels.height * factor)),
      );
      resized = true;
    }
    throw new ImageImportError("转换后的图片过大，请缩小图片后重试");
  } catch (error) {
    if (error instanceof ImageRuntimeError) throw error;
    if (error instanceof ImageImportError) throw error;
    throw new ImageImportError(decodeError);
  }
}
