import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import {
  ProviderImageError,
  type ProviderImageResult,
} from "./provider-types.js";
export { ProviderImageError } from "./provider-types.js";
sharp.cache(false);
sharp.concurrency(1);

/** Inspect the first decoded image without transcoding its original bytes. */
export async function inspectProviderImage(
  path: string,
  generatedPng = false,
): Promise<ProviderImageResult> {
  try {
    const bytes = await readFile(path);
    const pcx =
        bytes.length >= 68 &&
        bytes[0] === 10 &&
        [0, 2, 3, 5].includes(bytes[1]) &&
        bytes.readUInt16LE(8) >= bytes.readUInt16LE(4) &&
        bytes.readUInt16LE(10) >= bytes.readUInt16LE(6) &&
        ((bytes[3] === 1 && [1, 2, 4].includes(bytes[65])) ||
          (bytes[1] === 5 && bytes[3] === 8 && [1, 3].includes(bytes[65]))),
      tga =
        bytes.length >= 18 &&
        [0, 1].includes(bytes[1]) &&
        [1, 2, 3, 9, 10, 11].includes(bytes[2]) &&
        bytes.readUInt16LE(12) > 0 &&
        bytes.readUInt16LE(14) > 0 &&
        [1, 8, 16, 24, 32].includes(bytes[16]) &&
        (!bytes[1] || [16, 24, 32].includes(bytes[7]));
    if (pcx || tga) throw new ProviderImageError("format");
    if (
      bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) ||
      /^P[1-6]\s/.test(bytes.toString("ascii", 0, 3)) ||
      bytes.toString("ascii", 0, 4) === "8BPS" ||
      bytes.toString("ascii", 0, 2) === "BM"
    )
      throw new ProviderImageError("format");
    const info = await sharp(bytes, {
        limitInputPixels: false,
        failOn: "warning",
      }).metadata(),
      pixels = info.width * info.height,
      mime = (
        { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as Record<
          string,
          string
        >
      )[info.format || ""];
    if (info.format === "svg" || pixels > 2 * 89_478_485)
      throw new ProviderImageError("decode");
    if (!mime || pixels > 32_000_000 || (generatedPng && info.format !== "png"))
      throw new ProviderImageError("format");
    if (info.format === "png") {
      // Pillow checks pre-IDAT chunk CRCs when opening, not IEND or every
      // ancillary chunk after the image has already been decoded.
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const size = bytes.readUInt32BE(offset),
          end = offset + 12 + size;
        const chunk = bytes.toString("ascii", offset + 4, offset + 8);
        if (chunk === "IDAT" && !generatedPng) break;
        // PngStream.verify stops at the IEND header, without reading its CRC.
        if (chunk === "IEND") break;
        if (
          end > bytes.length ||
          crc32(bytes.subarray(offset + 4, end - 4)) !==
            bytes.readUInt32BE(end - 4)
        )
          throw new ProviderImageError("decode");
        offset = end;
      }
      if (generatedPng) {
        let offset = 8;
        for (;;) {
          if (offset + 8 > bytes.length) throw new ProviderImageError("decode");
          if (bytes.toString("ascii", offset + 4, offset + 8) === "IEND") break;
          offset += 12 + bytes.readUInt32BE(offset);
        }
      }
    }
    await sharp(bytes, { limitInputPixels: 32_000_000, failOn: "warning" })
      .raw()
      .toBuffer();
    const rotated =
      !generatedPng && [5, 6, 7, 8].includes(info.orientation || 0);
    return {
      mime,
      width: rotated ? info.height : info.width,
      height: rotated ? info.width : info.height,
    };
  } catch (error) {
    if (error instanceof ProviderImageError) throw error;
    throw new ProviderImageError("decode");
  }
}
