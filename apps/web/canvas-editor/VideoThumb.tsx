import React, { memo, useEffect, useRef, useState } from "react";
import {
  canvasVideoThumbnails,
  type VideoThumbnailScheduler,
} from "./videoThumbnails";

export const VideoThumb = memo(function VideoThumb({
  mediaId,
  alt = "",
  className = "video-poster",
  placeholderClassName = "video-thumb-placeholder",
  placeholderStyle,
  scheduler = canvasVideoThumbnails,
  observeVisibility = true,
}: {
  mediaId: string;
  alt?: string;
  className?: string;
  placeholderClassName?: string;
  placeholderStyle?: React.CSSProperties;
  scheduler?: VideoThumbnailScheduler;
  observeVisibility?: boolean;
}) {
  const placeholderRef = useRef<HTMLSpanElement | null>(null);
  const [url, setUrl] = useState<string | null>(() => scheduler.peek(mediaId));
  const [visible, setVisible] = useState(
    () =>
      !observeVisibility ||
      typeof IntersectionObserver === "undefined" ||
      scheduler.peek(mediaId) !== null,
  );

  // Sync immediately when mediaId or scheduler changes.
  useEffect(() => {
    const cached = scheduler.peek(mediaId);
    setUrl(cached);
    if (
      cached !== null ||
      !observeVisibility ||
      typeof IntersectionObserver === "undefined"
    ) {
      setVisible(true);
    }
  }, [mediaId, scheduler, observeVisibility]);

  // Only observe intersection while waiting for extraction.
  useEffect(() => {
    if (
      !observeVisibility ||
      url !== null ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const target = placeholderRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setVisible(entry.isIntersecting);
      },
      { rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [observeVisibility, url, mediaId]);

  const shouldSubscribe = visible || url !== null;
  useEffect(() => {
    if (!shouldSubscribe) return;
    const getPriority = () => {
      const el = placeholderRef.current;
      if (!el || typeof window === "undefined") return 1e9;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 - window.innerWidth / 2;
      const cy = rect.top + rect.height / 2 - window.innerHeight / 2;
      return cx * cx + cy * cy;
    };
    return scheduler.subscribe(mediaId, getPriority, (next) => {
      setUrl(next);
    });
  }, [mediaId, scheduler, shouldSubscribe]);

  if (url) {
    return (
      <img
        className={className}
        src={url}
        alt={alt}
        draggable={false}
        decoding="async"
      />
    );
  }
  return (
    <span
      ref={placeholderRef}
      className={placeholderClassName}
      style={placeholderStyle}
      aria-hidden="true"
    />
  );
});
