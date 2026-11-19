import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
/** Convert seconds and nanoseconds separately, preserving source FileResponse validators. */
export function modifiedSeconds(nanoseconds: bigint) {
  return (
    Number(nanoseconds / 1000000000n) + Number(nanoseconds % 1000000000n) * 1e-9
  );
}
export interface Storage {
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  putFile?(
    key: string,
    path: string,
    mime: string,
    signal?: AbortSignal,
  ): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  stat(
    key: string,
  ): Promise<{ size: number; mime?: string; modified?: number }>;
  remove(key: string, signal?: AbortSignal): Promise<void>;
  stream(key: string, start?: number, end?: number): Promise<Readable>;
  availableBytes?(): Promise<number>;
  downloadUrl?(
    key: string,
    response?: { mime: string; filename?: string },
  ): Promise<string>;
}
export class DiskStorage implements Storage {
  constructor(private directory: string) {}
  private path(key: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(key)) throw new Error("Invalid object key");
    return join(this.directory, key);
  }
  async put(key: string, data: Uint8Array) {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(key), data, { mode: 0o600 });
  }
  async availableBytes() {
    await mkdir(this.directory, { recursive: true });
    const disk = await statfs(this.directory);
    return Number(disk.bavail) * Number(disk.bsize);
  }
  async putFile(
    key: string,
    path: string,
    _mime: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true });
    await pipeline(
      createReadStream(path),
      createWriteStream(this.path(key), { mode: 0o600 }),
      { signal },
    );
    signal?.throwIfAborted();
  }
  async read(key: string) {
    return readFile(this.path(key));
  }
  async stream(key: string, start?: number, end?: number) {
    const stream = createReadStream(this.path(key), { start, end });
    await once(stream, "open");
    return stream;
  }
  async stat(key: string) {
    const info = await stat(this.path(key), { bigint: true });
    return { size: Number(info.size), modified: modifiedSeconds(info.mtimeNs) };
  }
  async remove(key: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
export class S3Storage implements Storage {
  client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_PATH_STYLE === "true",
    });
  }
  async put(key: string, data: Uint8Array, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mime,
      }),
    );
  }
  async putFile(key: string, path: string, mime: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const size = (await stat(path)).size,
      body = createReadStream(path);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: mime,
        }),
        { abortSignal: signal },
      );
    } finally {
      body.destroy();
    }
  }
  async read(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return (await result.Body?.transformToByteArray())!;
  }
  async stat(key: string) {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      size: result.ContentLength!,
      mime: result.ContentType,
      modified: result.LastModified
        ? result.LastModified.getTime() / 1000
        : undefined,
    };
  }
  async remove(key: string, signal?: AbortSignal) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: signal },
    );
  }
  async stream(key: string, start?: number, end?: number) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: start === undefined ? undefined : `bytes=${start}-${end ?? ""}`,
      }),
    );
    return result.Body as Readable;
  }
  async downloadUrl(
    key: string,
    response?: { mime: string; filename?: string },
  ) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(response ? { ResponseContentType: response.mime } : {}),
        ...(response?.filename
          ? {
              ResponseContentDisposition:
                "attachment; filename*=UTF-8''" +
                encodeURIComponent(response.filename).replace(
                  /[!'()*]/g,
                  (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
                ),
            }
          : {}),
      }),
      { expiresIn: 300 },
    );
  }
  async uploadUrl(key: string, mime: string) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mime,
      }),
      { expiresIn: 300 },
    );
  }
}
