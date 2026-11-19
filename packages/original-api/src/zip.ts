import { crc32 } from "node:zlib";
import type { Readable } from "node:stream";
export type ArchiveEntry = { key: string; size: number; name: string };
const limit = 0x7fffffff;
function extra64(values: number[]) {
  const out = Buffer.alloc(values.length ? 4 + values.length * 8 : 0);
  if (values.length) {
    out.writeUInt16LE(1, 0);
    out.writeUInt16LE(values.length * 8, 2);
    values.forEach((v, i) => out.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  }
  return out;
}
/** ZIP_STORED, streaming descriptors, Zip64, 1980 timestamps and 0600 permissions,
 * matching the original archive format without buffering file contents. */
export async function* zipStream(entries: ArchiveEntry[], streams: Readable[]) {
  const directory: Buffer[] = [];
  let offset = 0;
  try {
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index],
        name = Buffer.from(entry.name),
        start = offset,
        flags = /[^\x00-\x7f]/.test(entry.name) ? 0x808 : 8;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(45, 4);
      local.writeUInt16LE(flags, 6);
      local.writeUInt16LE(33, 12);
      local.writeUInt32LE(0xffffffff, 18);
      local.writeUInt32LE(0xffffffff, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(20, 28);
      const header = Buffer.concat([local, name, extra64([0, 0])]);
      offset += header.length;
      yield header;
      let size = 0,
        crc = 0;
      for await (const chunk of streams[index]) {
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > entry.size) throw new Error("Download source size changed");
        crc = crc32(data, crc);
        offset += data.length;
        yield data;
      }
      if (size !== entry.size) throw new Error("Download source is incomplete");
      const descriptor = Buffer.alloc(24);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeBigUInt64LE(BigInt(size), 8);
      descriptor.writeBigUInt64LE(BigInt(size), 16);
      offset += descriptor.length;
      yield descriptor;
      const extra = extra64([
        ...(size > limit ? [size, size] : []),
        ...(start > limit ? [start] : []),
      ]);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(0x032d, 4); // Unix, version 4.5
      central.writeUInt16LE(45, 6);
      central.writeUInt16LE(flags, 8);
      central.writeUInt16LE(33, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(size > limit ? 0xffffffff : size, 20);
      central.writeUInt32LE(size > limit ? 0xffffffff : size, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(extra.length, 30);
      central.writeUInt32LE(0o600 << 16, 38);
      central.writeUInt32LE(start > limit ? 0xffffffff : start, 42);
      directory.push(Buffer.concat([central, name, extra]));
    }
    const start = offset;
    for (const entry of directory) {
      offset += entry.length;
      yield entry;
    }
    const size = offset - start,
      count = entries.length;
    if (start > limit || size > limit || count > 65535) {
      const end = Buffer.alloc(56),
        locator = Buffer.alloc(20);
      end.writeUInt32LE(0x06064b50, 0);
      end.writeBigUInt64LE(44n, 4);
      end.writeUInt16LE(45, 12);
      end.writeUInt16LE(45, 14);
      end.writeBigUInt64LE(BigInt(count), 24);
      end.writeBigUInt64LE(BigInt(count), 32);
      end.writeBigUInt64LE(BigInt(size), 40);
      end.writeBigUInt64LE(BigInt(start), 48);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(offset), 8);
      locator.writeUInt32LE(1, 16);
      yield end;
      yield locator;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(count, 65535), 8);
    end.writeUInt16LE(Math.min(count, 65535), 10);
    end.writeUInt32LE(Math.min(size, 0xffffffff), 12);
    end.writeUInt32LE(Math.min(start, 0xffffffff), 16);
    yield end;
  } finally {
    for (const stream of streams) stream.destroy();
  }
}
