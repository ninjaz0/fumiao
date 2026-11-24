export type ThumbnailExtractor = (
  mediaId: string,
  signal: AbortSignal,
) => Promise<string | null>;

type Listener = (url: string | null) => void;

type Subscriber = {
  id: symbol;
  getPriority: () => number;
  onReady: Listener;
};

type ActiveExtraction = {
  controller: AbortController;
  subscribers: Map<symbol, Subscriber>;
};

export interface ThumbnailSchedulerOptions {
  maxConcurrent?: number;
  maxCacheEntries?: number;
  failureCooldownMs?: number;
  now?: () => number;
  releaseUrl?: (url: string) => void;
}

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_CACHE_ENTRIES = 240;
const DEFAULT_FAILURE_COOLDOWN_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 15_000;
const MAX_THUMBNAIL_EDGE = 480;

export class VideoThumbnailScheduler {
  private readonly maxConcurrent: number;
  private readonly maxCacheEntries: number;
  private readonly failureCooldownMs: number;
  private readonly now: () => number;
  private readonly releaseUrl: (url: string) => void;
  private readonly cache = new Map<string, string>();
  private readonly failedUntil = new Map<string, number>();
  private readonly pending = new Map<string, Map<symbol, Subscriber>>();
  private readonly active = new Map<string, ActiveExtraction>();
  private readonly liveRefs = new Map<string, number>();
  private readonly pausedReasons = new Set<string>();
  private disposed = false;

  constructor(
    private readonly extract: ThumbnailExtractor,
    options: ThumbnailSchedulerOptions = {},
  ) {
    this.maxConcurrent = Math.max(
      1,
      options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    );
    this.maxCacheEntries = Math.max(
      1,
      options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
    );
    this.failureCooldownMs = Math.max(
      0,
      options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS,
    );
    this.now = options.now ?? (() => Date.now());
    this.releaseUrl =
      options.releaseUrl ??
      ((url) => {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
      });
  }

  peek(mediaId: string): string | null {
    const cached = this.cache.get(mediaId);
    if (cached === undefined) return null;
    // Touch LRU order.
    this.cache.delete(mediaId);
    this.cache.set(mediaId, cached);
    return cached;
  }

  hasFailed(mediaId: string): boolean {
    const until = this.failedUntil.get(mediaId);
    if (until === undefined) return false;
    if (this.now() >= until) {
      this.failedUntil.delete(mediaId);
      return false;
    }
    return true;
  }

  get stats() {
    return {
      active: this.active.size,
      pending: this.pending.size,
      cached: this.cache.size,
      failed: this.failedUntil.size,
      paused: this.pausedReasons.size > 0,
    };
  }

  pause(reason: string) {
    this.pausedReasons.add(reason);
  }

  resume(reason: string) {
    if (!this.pausedReasons.delete(reason)) return;
    if (this.pausedReasons.size === 0) this.pump();
  }

  subscribe(
    mediaId: string,
    getPriority: () => number,
    onReady: Listener,
  ): () => void {
    if (this.disposed) return () => {};
    this.liveRefs.set(mediaId, (this.liveRefs.get(mediaId) ?? 0) + 1);
    let unsubscribed = false;
    const releaseRef = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const nextCount = (this.liveRefs.get(mediaId) ?? 1) - 1;
      if (nextCount <= 0) this.liveRefs.delete(mediaId);
      else this.liveRefs.set(mediaId, nextCount);
    };

    const cached = this.peek(mediaId);
    if (cached !== null) {
      onReady(cached);
      return releaseRef;
    }
    if (this.hasFailed(mediaId)) {
      onReady(null);
      return releaseRef;
    }

    const token = Symbol(mediaId);
    const subscriber: Subscriber = { id: token, getPriority, onReady };

    const running = this.active.get(mediaId);
    if (running) {
      running.subscribers.set(token, subscriber);
    } else {
      let bucket = this.pending.get(mediaId);
      if (!bucket) {
        bucket = new Map();
        this.pending.set(mediaId, bucket);
      }
      bucket.set(token, subscriber);
      this.pump();
    }

    return () => {
      releaseRef();
      const queued = this.pending.get(mediaId);
      if (queued) {
        queued.delete(token);
        if (queued.size === 0) this.pending.delete(mediaId);
      }
      const inFlight = this.active.get(mediaId);
      if (inFlight) {
        inFlight.subscribers.delete(token);
        if (inFlight.subscribers.size === 0) {
          this.active.delete(mediaId);
          inFlight.controller.abort();
          this.pump();
        }
      }
    };
  }

  dispose() {
    this.disposed = true;
    this.pending.clear();
    for (const entry of this.active.values()) {
      entry.subscribers.clear();
      entry.controller.abort();
    }
    this.active.clear();
    for (const url of this.cache.values()) {
      this.releaseUrl(url);
    }
    this.cache.clear();
    this.failedUntil.clear();
    this.liveRefs.clear();
    this.pausedReasons.clear();
  }

  private markFailed(mediaId: string) {
    if (this.failureCooldownMs > 0) {
      this.failedUntil.set(mediaId, this.now() + this.failureCooldownMs);
    }
  }

  private storeCache(mediaId: string, url: string) {
    const existing = this.cache.get(mediaId);
    if (existing && existing !== url) {
      this.releaseUrl(existing);
    }
    this.cache.delete(mediaId);
    this.cache.set(mediaId, url);
    if (this.cache.size <= this.maxCacheEntries) return;
    // Prefer evicting thumbnails that are not currently mounted.
    for (const [key, cachedUrl] of this.cache) {
      if (this.cache.size <= this.maxCacheEntries) break;
      if (key === mediaId || (this.liveRefs.get(key) ?? 0) > 0) continue;
      this.cache.delete(key);
      this.releaseUrl(cachedUrl);
    }
  }

  private pickNextPending(): string | null {
    let bestId: string | null = null;
    let bestPriority = Infinity;
    for (const [mediaId, subscribers] of this.pending) {
      let priority = Infinity;
      for (const sub of subscribers.values()) {
        const value = sub.getPriority();
        if (value < priority) priority = value;
      }
      if (bestId === null || priority < bestPriority) {
        bestId = mediaId;
        bestPriority = priority;
      }
    }
    return bestId;
  }

  private pump() {
    if (this.disposed || this.pausedReasons.size > 0) return;
    while (
      this.active.size < this.maxConcurrent &&
      this.pending.size > 0 &&
      this.pausedReasons.size === 0
    ) {
      const mediaId = this.pickNextPending();
      if (!mediaId) return;
      const subscribers = this.pending.get(mediaId);
      this.pending.delete(mediaId);
      if (!subscribers || subscribers.size === 0) continue;

      const controller = new AbortController();
      const entry: ActiveExtraction = { controller, subscribers };
      this.active.set(mediaId, entry);

      void this.extract(mediaId, controller.signal)
        .then(
          (url) => {
            if (this.disposed || controller.signal.aborted) {
              if (url) this.releaseUrl(url);
              return;
            }
            if (this.active.get(mediaId) === entry) {
              this.active.delete(mediaId);
            }
            if (url) {
              this.storeCache(mediaId, url);
              for (const sub of entry.subscribers.values()) sub.onReady(url);
            } else {
              this.markFailed(mediaId);
              for (const sub of entry.subscribers.values()) sub.onReady(null);
            }
          },
          () => {
            if (this.disposed || controller.signal.aborted) return;
            if (this.active.get(mediaId) === entry) {
              this.active.delete(mediaId);
            }
            this.markFailed(mediaId);
            for (const sub of entry.subscribers.values()) sub.onReady(null);
          },
        )
        .finally(() => {
          if (this.active.get(mediaId) === entry) {
            this.active.delete(mediaId);
          }
          this.pump();
        });
    }
  }
}

export function extractBrowserVideoThumbnail(
  mediaId: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (typeof document === "undefined" || signal.aborted) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    let settled = false;
    let seekRequested = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      signal.removeEventListener("abort", onAbort);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("seeked", onFrameCandidate);
      video.removeEventListener("loadeddata", onFrameCandidate);
      video.removeEventListener("canplay", onFrameCandidate);
      video.removeEventListener("error", onError);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // Ignore teardown failures on detached media elements.
      }
    };

    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };

    const captureNow = () => {
      if (settled || signal.aborted) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || video.readyState < 2) return;
      const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(vw, vh));
      const width = Math.max(1, Math.round(vw * scale));
      const height = Math.max(1, Math.round(vh * scale));
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        // Detach decoder immediately once pixels are copied to the small canvas.
        cleanup();
        canvas.toBlob(
          (blob) => {
            if (settled) return;
            if (!blob || signal.aborted) {
              settled = true;
              resolve(null);
              return;
            }
            settled = true;
            resolve(URL.createObjectURL(blob));
          },
          "image/jpeg",
          0.78,
        );
      } catch {
        finish(null);
      }
    };

    const onFrameCandidate = () => {
      if (!seekRequested) return;
      if (!video.seeking && video.readyState >= 2 && video.videoWidth > 0) {
        captureNow();
      }
    };

    const onMetadata = () => {
      if (seekRequested || settled) return;
      seekRequested = true;
      const target =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(0.05, video.duration * 0.1)
          : 0;
      if (target > 0) {
        try {
          video.currentTime = target;
        } catch {
          onFrameCandidate();
        }
        fallbackTimer = setTimeout(() => {
          if (!settled && video.readyState >= 2 && video.videoWidth > 0) {
            captureNow();
          }
        }, 1500);
      } else {
        onFrameCandidate();
      }
    };

    const onError = () => finish(null);
    const onAbort = () => finish(null);

    const timeoutTimer = setTimeout(() => finish(null), EXTRACT_TIMEOUT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("seeked", onFrameCandidate);
    video.addEventListener("loadeddata", onFrameCandidate);
    video.addEventListener("canplay", onFrameCandidate);
    video.addEventListener("error", onError);
    video.src = "/media/" + mediaId;
  });
}

export const canvasVideoThumbnails = new VideoThumbnailScheduler(
  extractBrowserVideoThumbnail,
);
