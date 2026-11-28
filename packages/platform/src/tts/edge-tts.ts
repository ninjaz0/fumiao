import { createHash, randomUUID } from "node:crypto";
import { requireValue } from "../security.js";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_WS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const WIN_EPOCH_OFFSET_SEC = 11_644_473_600n;
const SEC_TO_TICKS = 10_000_000n;

export interface EdgeTtsVoice {
  id: string;
  label: string;
  locale: string;
  gender: "female" | "male";
}

export const EDGE_TTS_VOICES: readonly EdgeTtsVoice[] = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（女·自然温暖）", locale: "zh-CN", gender: "female" },
  { id: "zh-CN-YunxiNeural", label: "云希（男·清亮叙事）", locale: "zh-CN", gender: "male" },
  { id: "zh-CN-YunjianNeural", label: "云健（男·沉稳解说）", locale: "zh-CN", gender: "male" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（女·灵动少女）", locale: "zh-CN", gender: "female" },
  { id: "zh-CN-YunyangNeural", label: "云扬（男·新闻播音）", locale: "zh-CN", gender: "male" },
  { id: "zh-CN-YunxiaNeural", label: "云夏（少年·清澈）", locale: "zh-CN", gender: "male" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北（女·东北幽默）", locale: "zh-CN", gender: "female" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮（女·陕西韵味）", locale: "zh-CN", gender: "female" },
  { id: "zh-TW-HsiaoChenNeural", label: "曉臻（女·台湾温柔）", locale: "zh-TW", gender: "female" },
  { id: "zh-HK-HiuMaanNeural", label: "曉曼（女·粤语）", locale: "zh-HK", gender: "female" },
  { id: "en-US-JennyNeural", label: "Jenny (US Female)", locale: "en-US", gender: "female" },
  { id: "en-US-GuyNeural", label: "Guy (US Male)", locale: "en-US", gender: "male" },
];

export const EDGE_TTS_VOICE_IDS = EDGE_TTS_VOICES.map((v) => v.id);
export const EDGE_TTS_VOICE_LABELS = Object.fromEntries(
  EDGE_TTS_VOICES.map((v) => [v.id, v.label]),
);

function escapeXml(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeRate(raw?: string): string {
  if (!raw || !/^[+-]?\d{1,3}%$/.test(raw.trim())) return "+0%";
  const num = Math.max(-50, Math.min(100, Number.parseInt(raw.trim(), 10)));
  return `${num >= 0 ? "+" : ""}${num}%`;
}

function sanitizePitch(raw?: string): string {
  if (!raw || !/^[+-]?\d{1,3}Hz$/.test(raw.trim())) return "+0Hz";
  const num = Math.max(-50, Math.min(50, Number.parseInt(raw.trim(), 10)));
  return `${num >= 0 ? "+" : ""}${num}Hz`;
}

function sanitizeVolume(raw?: string): string {
  if (!raw || !/^[+-]?\d{1,3}%$/.test(raw.trim())) return "+0%";
  const num = Math.max(-50, Math.min(50, Number.parseInt(raw.trim(), 10)));
  return `${num >= 0 ? "+" : ""}${num}%`;
}

/** Compute Microsoft Edge TTS Sec-MS-GEC token rounded down to a 5-minute window. */
export function computeSecMsGec(timestampMs = Date.now()): string {
  const unixSec = BigInt(Math.floor(timestampMs / 1000));
  const winSec = unixSec + WIN_EPOCH_OFFSET_SEC;
  const rounded = winSec - (winSec % 300n);
  const ticks = rounded * SEC_TO_TICKS;
  return createHash("sha256")
    .update(`${ticks.toString()}${TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase();
}

export interface EdgeTtsRequest {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  /** Optional custom Edge-compatible WebSocket endpoint (defaults to Microsoft Edge ReadAloud WSS). */
  endpoint?: string;
  /** Bounded retry attempts for transient connection failures (default 2, capped at 3). */
  maxAttempts?: number;
  /** Delay between retry attempts in ms (default 350). */
  retryDelayMs?: number;
}

export type EdgeTtsErrorCode =
  | "connect_failed"
  | "closed_early"
  | "timeout"
  | "empty_audio"
  | "send_failed"
  | "oversize"
  | "aborted";

export class EdgeTtsError extends Error {
  constructor(
    public readonly code: EdgeTtsErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EdgeTtsError";
  }
}

export function edgeRenderingSettings(req: Pick<EdgeTtsRequest, "voice" | "rate" | "pitch">) {
  const voice =
    req.voice && /^[A-Za-z]{2,3}-[A-Za-z]{2,4}(?:-[A-Za-z]+)*Neural$/.test(req.voice)
      ? req.voice
      : "zh-CN-XiaoxiaoNeural";
  return { voice, rate: sanitizeRate(req.rate), pitch: sanitizePitch(req.pitch) };
}

export function buildEdgeSsml(req: EdgeTtsRequest): string {
  const text = req.text.trim();
  requireValue(text.length > 0 && text.length <= 2000, 400, "合成文本需为 1–2000 字");
  const { voice, rate, pitch } = edgeRenderingSettings(req);
  const volume = sanitizeVolume(req.volume);
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`
  );
}

export interface EdgeWebSocketLike {
  binaryType: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}

export type EdgeWebSocketFactory = (url: string) => EdgeWebSocketLike;

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new EdgeTtsError("aborted", "Edge TTS 合成已取消", false));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new EdgeTtsError("aborted", "Edge TTS 合成已取消", false));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function synthesizeEdgeTtsOnce(
  ssml: string,
  base: string,
  signal: AbortSignal,
  wsFactory: EdgeWebSocketFactory | undefined,
  timeoutMs: number,
): Promise<{ mime: "audio/mpeg"; bytes: Buffer }> {
  signal.throwIfAborted();
  const connectionId = randomUUID().replaceAll("-", "");
  const secMsGec = computeSecMsGec();
  const sep = base.includes("?") ? "&" : "?";
  const url =
    `${base}${sep}TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68` +
    `&ConnectionId=${connectionId}`;

  const createSocket: EdgeWebSocketFactory =
    wsFactory ?? ((target) => new WebSocket(target) as unknown as EdgeWebSocketLike);

  return new Promise<{ mime: "audio/mpeg"; bytes: Buffer }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let opened = false;
    let totalBytes = 0;
    const maxBytes = 16 * 1024 * 1024;
    let ws: EdgeWebSocketLike;
    try {
      ws = createSocket(url);
      ws.binaryType = "arraybuffer";
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : "无法建立 WebSocket 连接";
      reject(new EdgeTtsError("connect_failed", `Edge TTS 连接失败（${detail}）`, true));
      return;
    }

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        // Ignore close errors during teardown.
      }
      if (err) {
        reject(err);
      } else {
        const bytes = Buffer.concat(chunks);
        if (!bytes.length) {
          reject(new EdgeTtsError("empty_audio", "Edge TTS 未返回音频数据", true));
        } else {
          resolve({ mime: "audio/mpeg", bytes });
        }
      }
    };

    const onAbort = () =>
      finish(new EdgeTtsError("aborted", "Edge TTS 合成已取消", false));
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => finish(new EdgeTtsError("timeout", `Edge TTS 合成超时（${Math.round(timeoutMs / 1000)}s）`, true)),
      timeoutMs,
    );

    ws.addEventListener("open", () => {
      opened = true;
      const stamp = new Date().toUTCString();
      const configMsg =
        `X-Timestamp:${stamp}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false",
                },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });
      const requestId = randomUUID().replaceAll("-", "");
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${stamp}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      try {
        ws.send(configMsg);
        ws.send(ssmlMsg);
      } catch (e) {
        const detail = e instanceof Error && e.message ? e.message : "发送失败";
        finish(new EdgeTtsError("send_failed", `Edge TTS 发送失败（${detail}）`, true));
      }
    });

    ws.addEventListener("message", (event: { data: unknown }) => {
      if (settled) return;
      const data = event.data;
      if (typeof data === "string") {
        if (data.includes("Path:turn.end")) finish();
        return;
      }
      const buf =
        data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.isBuffer(data)
            ? data
            : ArrayBuffer.isView(data)
              ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
              : null;
      if (!buf || buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      if (2 + headerLen >= buf.length) return;
      const header = buf.subarray(2, 2 + headerLen).toString("utf8");
      if (!header.includes("Path:audio")) return;
      const payload = buf.subarray(2 + headerLen);
      totalBytes += payload.length;
      if (totalBytes > maxBytes) {
        finish(new EdgeTtsError("oversize", "Edge TTS 输出超过 16 MB 限制", false));
        return;
      }
      chunks.push(payload);
    });

    ws.addEventListener("error", (event: { message?: unknown; error?: { message?: unknown; cause?: unknown } }) => {
      const rawDetail =
        (typeof event?.error?.message === "string" && event.error.message.trim()) ||
        (typeof event?.message === "string" && event.message.trim()) ||
        (opened ? "连接中断" : "握手被拒绝或网络不可达");
      finish(new EdgeTtsError("connect_failed", `Edge TTS 连接失败（${rawDetail}）`, true));
    });

    ws.addEventListener("close", (event: { code?: unknown; reason?: unknown }) => {
      if (!settled) {
        if (chunks.length) finish();
        else {
          const code = typeof event?.code === "number" ? event.code : 0;
          const reason = typeof event?.reason === "string" && event.reason.trim() ? `: ${event.reason.trim()}` : "";
          const suffix = code ? `（code=${code}${reason}）` : "";
          finish(new EdgeTtsError("closed_early", `Edge TTS 连接提前关闭${suffix}`, true));
        }
      }
    });
  });
}

/** Synthesize MP3 speech using Microsoft Edge ReadAloud WebSocket endpoint with bounded retries. */
export async function synthesizeEdgeTts(
  req: EdgeTtsRequest,
  signal: AbortSignal,
  wsFactory?: EdgeWebSocketFactory,
  timeoutMs = 30_000,
): Promise<{ mime: "audio/mpeg"; bytes: Buffer }> {
  signal.throwIfAborted();
  const ssml = buildEdgeSsml(req);
  const base =
    req.endpoint && /^wss?:\/\//.test(req.endpoint.trim())
      ? req.endpoint.trim()
      : EDGE_WS_BASE;
  const maxAttempts = Math.max(1, Math.min(3, Math.floor(req.maxAttempts ?? 2)));
  const retryDelayMs = Math.max(0, Math.min(5_000, Math.floor(req.retryDelayMs ?? 350)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await synthesizeEdgeTtsOnce(ssml, base, signal, wsFactory, timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof EdgeTtsError ? error.retryable : false;
      if (!retryable || attempt >= maxAttempts || signal.aborted) {
        throw error;
      }
      await sleepWithSignal(retryDelayMs * attempt, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new EdgeTtsError("connect_failed", "Edge TTS 连接失败", false);
}
