import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { mediaURL, type Job } from "./state";

function timestamp(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export function ResultPlayer({
  job,
  notify,
}: {
  job: Job;
  notify: (message: string) => void;
}) {
  const player = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const seek = useRef<HTMLInputElement>(null);
  const [[time, length, playing], setPlayback] = useState<
    [number, number, boolean]
  >([0, 0, false]);
  const [[muted, silent], setSound] = useState([false, false]);
  const src = mediaURL(job.result!);
  const subtitles = job.actual?.storyboard_export;

  function update() {
    const media = video.current!;
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    const slider = seek.current!;
    slider.max = String(duration || 1);
    slider.value = String(media.currentTime);
    slider.style.setProperty(
      "--progress",
      (duration ? (media.currentTime / duration) * 100 : 0) + "%",
    );
    setPlayback([media.currentTime, duration, !media.paused]);
  }
  function fit() {
    const node = player.current!;
    const media = video.current!;
    const stage = node.parentElement!.getBoundingClientRect();
    const ratio =
      (media.videoWidth || Number(job.width)) /
      (media.videoHeight || Number(job.height));
    const limit = parseFloat(getComputedStyle(node).maxHeight);
    const height = Math.min(
      stage.height,
      Number.isFinite(limit) ? limit : stage.height,
    );
    const width = Math.min(stage.width, height * ratio);
    node.style.width = width + "px";
    node.style.height = width / ratio + "px";
  }
  useLayoutEffect(() => {
    fit();
    update();
    const observer = new ResizeObserver(fit);
    observer.observe(player.current!.parentElement!);
    return () => observer.disconnect();
  }, [job.width, job.height]);

  function toggle() {
    const media = video.current!;
    if (media.paused)
      void media.play().catch(() => notify("视频加载中，请稍后播放"));
    else media.pause();
  }
  function sound() {
    const media = video.current!;
    setSound([media.muted, media.muted || media.volume === 0]);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await player.current!.requestFullscreen();
    } catch {
      notify("请使用浏览器的全屏功能");
    }
  }

  return (
    <div
      className={`player${playing ? " is-playing" : ""}`}
      data-src={src}
      data-width={job.width ?? "null"}
      data-height={job.height ?? "null"}
      data-wired="1"
      ref={player}
    >
      <video
        className="detail-video"
        playsInline
        preload="metadata"
        src={src}
        aria-label="视频"
        ref={video}
        onClick={toggle}
        onTimeUpdate={update}
        onLoadedMetadata={() => {
          update();
          fit();
        }}
        onPlay={update}
        onPause={update}
      >
        {job.model === "storyboard" &&
          subtitles &&
          /^[a-f0-9]{32}$/.test(subtitles) && (
            <track
              kind="captions"
              label="旁白字幕"
              srcLang="zh"
              src={`/api/storyboard-exports/${subtitles}/subtitles?format=vtt`}
              default
            />
          )}
      </video>
      <div className="player-controls">
        <input
          className="seek-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          defaultValue="0"
          aria-label="调整视频的播放进度"
          ref={seek}
          onInput={(event) => {
            video.current!.currentTime = Number(event.currentTarget.value);
            update();
          }}
        />
        <div className="player-bottom">
          <button
            className="player-toggle"
            aria-label={playing ? "暂停" : "播放"}
            onClick={toggle}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <span className="player-time">
            {timestamp(time) + " / " + timestamp(length)}
          </span>
          <span className="player-fill"></span>
          <div className="volume-control">
            <button
              className="player-mute"
              aria-label={muted ? "取消静音" : "静音"}
              onClick={() => {
                video.current!.muted = !video.current!.muted;
                sound();
              }}
            >
              <Icon name={silent ? "muted" : "volume"} />
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              defaultValue="1"
              aria-label="视频音量"
              onInput={(event) => {
                video.current!.volume = Number(event.currentTarget.value);
                video.current!.muted = false;
                sound();
              }}
            />
          </div>
          <span className="player-quality">原画</span>
          <button
            className="player-fullscreen"
            aria-label="在浏览器中全屏显示"
            onClick={fullscreen}
          >
            <Icon name="fullscreen" />
          </button>
        </div>
      </div>
    </div>
  );
}
