import { useRef, useState } from "react";
import {videoSeconds,type Job} from "./types";

function describe(job: Job) {
  const size = job.actual?.width && job.actual?.height
    ? `${job.actual.width} × ${job.actual.height}`
    : job.width && job.height ? `${job.width} × ${job.height}` : "—";
  const h3 = job.model === "MiniMax H3";
  return [
    ["模型", job.model_label || (job.model === "muse-video" ? "Muse" : job.model)],
    ["画幅与尺寸", `${job.ratio} · ${size}`],
    ["时长", `${Math.round(videoSeconds(job)*10)/10} 秒`],
    ["参考图片", job.refs],
    ["采样", h3 ? job.sampling_steps === 4 ? "快速模式" : `${job.sampling_steps ?? 20} 步` : "—"],
    ["种子", h3 ? String(job.seed ?? "自动") : "—"],
    ["提示词", job.prompt],
  ] as const;
}

export function VideoVersions({ runs, adopted, onAdopt }: {
  runs: Job[];
  adopted: number | null;
  onAdopt: (id: number) => void;
}) {
  const [leftId, setLeft] = useState(runs[0]?.id);
  const [rightId, setRight] = useState(runs.find((job) => job.id === adopted && job.id !== leftId)?.id ?? runs[1]?.id);
  const [error, setError] = useState("");
  const leftPlayer = useRef<HTMLVideoElement>(null);
  const rightPlayer = useRef<HTMLVideoElement>(null);
  const left = runs.find((job) => job.id === leftId);
  const right = runs.find((job) => job.id === rightId);

  const playBoth = async () => {
    const players = [leftPlayer.current, rightPlayer.current];
    if (players.some((player) => !player || player.readyState < 1)) {
      setError("视频正在加载，请稍后再试");
      return;
    }
    setError("");
    try {
      await Promise.all(players.map((player) => {
        player!.currentTime = 0;
        return player!.play();
      }));
    } catch {
      players.forEach((player) => player?.pause());
      setError("无法同时播放，请检查视频是否可以播放");
    }
  };

  if (!left || !right) return <p>版本已变更，请关闭后重新打开对比。</p>;
  const otherValues = [describe(right), describe(left)];
  return <>
    <div className="compare-actions">
      <button className="secondary" onClick={playBoth}>从头同时播放</button>
      <button className="secondary" onClick={() => {
        leftPlayer.current?.pause();
        rightPlayer.current?.pause();
      }}>同时暂停</button>
      <span>有差异的参数会加粗显示。右侧默认静音，避免两段音频重叠。</span>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="version-compare">
      {[left, right].map((job, index) => (
        <section key={index} aria-label={index === 0 ? "左侧版本" : "右侧版本"}>
          <label className="version-select">
            {index === 0 ? "版本 A" : "版本 B"}
            <select value={job.id} onChange={(event) => {
              leftPlayer.current?.pause();
              rightPlayer.current?.pause();
              setError("");
              (index === 0 ? setLeft : setRight)(Number(event.target.value));
            }}>
              {runs.map((option) => (
                <option key={option.id} value={option.id} disabled={option.id === (index === 0 ? right.id : left.id)}>
                  #{option.id}{option.id === adopted ? " · 已采用" : ""}
                </option>
              ))}
            </select>
          </label>
          <video key={job.id} ref={index === 0 ? leftPlayer : rightPlayer} src={"/media/" + job.result + "#t=0.05"}
            controls playsInline muted={index === 1} preload="metadata" />
          <button className={job.id === adopted ? "secondary version-adopt" : "primary version-adopt"}
            disabled={job.id === adopted}
            onClick={() => onAdopt(job.id)}>{job.id === adopted ? "已采用" : "采用这一版"}</button>
          <dl className="version-specs">
            {describe(job).map(([label, value], field) => (
              <div key={label} className={JSON.stringify(value) === JSON.stringify(otherValues[index][field][1]) ? "" : "different"}>
                <dt>{label}</dt>
                <dd>{Array.isArray(value) ? (value.length ? (
                  <div className="version-refs">{value.map((id, i) => (
                    <img key={id} src={"/media/" + id} alt={`参考图 ${i + 1}`} loading="lazy" />
                  ))}</div>
                ) : "无") : value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  </>;
}
