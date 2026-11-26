import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { reducedMotion } from "../app/motion";
import { Icon } from "./Icon";
import { mediaURL, type Asset } from "./state";

export function useCardClasses(
  saved: boolean,
  selected = false,
  highlight = false,
  avUpload = false,
  referenceAdded = false,
) {
  const card = useRef<HTMLElement>(null);
  const initialSaved = useRef(saved);
  const lastSaved = useRef(saved);
  const className = avUpload
    ? "asset-card"
    : `asset-card ${initialSaved.current ? "is-favorite" : ""}`;
  useLayoutEffect(() => {
    const element = card.current!;
    if (!avUpload || saved !== lastSaved.current)
      element.classList.toggle("is-favorite", saved);
    lastSaved.current = saved;
    element.classList.toggle("is-selected", selected);
    element.classList.toggle("new-result", highlight);
    element.classList.toggle("is-reference-added", referenceAdded);
  }, [saved, selected, highlight, avUpload, referenceAdded]);
  return { ref: card, className };
}

export function Favorite({
  id,
  saved,
  change,
  detail = false,
}: {
  id: string;
  saved: boolean;
  change: (id: string, saved: boolean) => void;
  detail?: boolean;
}) {
  const label = saved ? "取消收藏" : "收藏";
  const initialSaved = useRef(saved);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    button.current!.classList.toggle("is-favorite", saved);
  }, [saved]);
  return (
    <button
      ref={button}
      className={`favorite-button ${initialSaved.current ? "is-favorite" : ""} ${detail ? "detail-favorite" : ""}`}
      data-act="favorite"
      data-key={id}
      aria-label={label}
      aria-pressed={saved}
      title={label}
      onClick={() => change(id, !saved)}
    >
      <Icon name="star" />
      {detail && <span>{saved ? "已收藏" : "收藏"}</span>}
    </button>
  );
}

export function Download({
  id,
  filename,
  detail = false,
}: {
  id: string;
  filename?: string;
  detail?: boolean;
}) {
  return (
    <a
      className={detail ? "download-action" : undefined}
      href={mediaURL(id) + "?download=true"}
      download={filename || true}
      title={detail ? undefined : "下载"}
    >
      <Icon name="download" />
      {detail && "下载"}
    </a>
  );
}

export function ReferenceMedia({
  id,
  kind,
  controls = false,
}: {
  id: string;
  kind: Asset["kind"];
  controls?: boolean;
}) {
  const src = mediaURL(id);
  if (kind === "ref_video")
    return (
      <video
        src={src + "#t=0.1"}
        preload="metadata"
        controls={controls}
        muted={!controls}
        playsInline
        ref={(video) => {
          if (!controls) video?.setAttribute("muted", "");
        }}
      />
    );
  if (kind === "ref_audio")
    return controls ? (
      <audio src={src} controls />
    ) : (
      <span className="h3-audio-thumb">
        <Icon name="voice" />
      </span>
    );
  return <img src={src} alt="" />;
}

export function playPreview(event: MouseEvent<HTMLButtonElement>) {
  if (reducedMotion()) return;
  void event.currentTarget
    .querySelector("video")
    ?.play()
    .catch(() => {});
}
export function pausePreview(event: MouseEvent<HTMLButtonElement>) {
  event.currentTarget.querySelector("video")?.pause();
}
