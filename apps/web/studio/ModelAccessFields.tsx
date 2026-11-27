import type {
  ModelCandidate,
  ModelPurpose,
  VideoProtocol,
} from "@fumiao/web-compat/model-access.js";
import {
  formats,
  sampleCost,
  type EditorRow,
  type Rates,
} from "./model-access-editor";

export function PriceFields({
  kind,
  rates,
  change,
}: {
  kind: ModelPurpose;
  rates: Rates;
  change: (patch: Rates) => void;
}) {
  function field(key: keyof Rates, label: string) {
    return (
      <label>
        {label}
        <input
          type="text"
          inputMode="decimal"
          value={rates[key] ?? ""}
          onChange={(e) => change({ [key]: e.target.value })}
          placeholder={key.startsWith("cache") ? "沿用普通输入价" : "未定价"}
        />
      </label>
    );
  }
  if (kind !== "chat")
    return field(
      "unit",
      kind === "image" ? "每张图片售价（积分）" : "每秒视频售价（积分）",
    );
  const cost = sampleCost(rates);
  return (
    <>
      <div className="access-fields">
        {field("input", "普通输入价（积分 / 百万 Token）")}
        {field("output", "输出价（积分 / 百万 Token）")}
      </div>
      <details>
        <summary>缓存价格与试算</summary>
        <div className="access-fields">
          {field("cache_read", "缓存命中价")}
          {field("cache_write", "缓存写入价")}
        </div>
        <p className="console-description">
          普通输入 2,000、缓存命中 7,000、缓存写入 1,000、输出 500 Token
          {cost !== null ? `，合计 ${cost} 积分。` : "。"}
        </p>
      </details>
    </>
  );
}
export function VideoFormat({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (format: VideoProtocol | "") => void;
  label: string;
  placeholder: string;
}) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as VideoProtocol | "")}
      >
        <option value="">{placeholder}</option>
        <option value="new-api-videos">{formats["new-api-videos"]}</option>
        <option value="openrouter-videos">
          {formats["openrouter-videos"]}
        </option>
      </select>
    </label>
  );
}
export function CapabilityFields({
  row,
  candidate,
  change,
  router,
  hideProtocol = false,
}: {
  hideProtocol?: boolean;
  row: EditorRow;
  candidate?: ModelCandidate;
  change: (patch: Partial<EditorRow>) => void;
  router: boolean;
}) {
  function field(
    key: keyof EditorRow,
    label: string,
    hint?: string,
    numeric = false,
  ) {
    return (
      <label>
        {label}
        <input
          type={numeric ? "number" : "text"}
          min={numeric ? 0 : undefined}
          value={String(row[key] ?? "")}
          placeholder={hint ?? "按网关说明填写"}
          onChange={(e) => change({ [key]: e.target.value })}
        />
      </label>
    );
  }
  const declared = candidate?.parameters;
  return (
    <div className="access-fields">
      {row.purpose === "video" && (
        <>
          {!router && !hideProtocol && (
            <VideoFormat
              label="本模型视频格式"
              placeholder="沿用连接默认格式"
              value={row.protocol ?? ""}
              onChange={(protocol) => change({ protocol })}
            />
          )}
          {field(
            "durations",
            "可选时长（秒）",
            declared?.durations?.join(", ") || "例如 4, 8",
          )}
          {field("minSeconds", "最短时长（范围）", undefined, true)}
          {field("maxSeconds", "最长时长（范围）", undefined, true)}
          <label>
            首帧图片
            <select
              value={row.frames ?? ""}
              onChange={(e) =>
                change({ frames: e.target.value as EditorRow["frames"] })
              }
            >
              <option value="">沿用目录声明</option>
              <option value="none">不支持</option>
              <option value="optional">可选</option>
              <option value="required">必须上传</option>
            </select>
          </label>
        </>
      )}
      {row.purpose === "image" && (
        <>
          {field("minRefs", "最少参考图", undefined, true)}
          {field("maxRefs", "最多参考图", undefined, true)}
          {router && (
            <label>
              调用格式
              <select
                value={row.protocol ?? ""}
                onChange={(e) =>
                  change({ protocol: e.target.value as EditorRow["protocol"] })
                }
              >
                <option value="">沿用图片目录声明</option>
                <option value="openrouter-images">OpenRouter 图片</option>
              </select>
            </label>
          )}
        </>
      )}
      {(row.purpose === "image" || row.purpose === "video") && (
        <>
          {field(
            "sizes",
            "可用尺寸",
            declared?.sizes?.join(", ") || "例如 1280x720",
          )}
          {field(
            "resolutions",
            "可用分辨率",
            declared?.resolutions?.join(", ") || "例如 720p, 1080p",
          )}
          {field(
            "ratios",
            "可用画幅",
            declared?.aspect_ratios?.join(", ") || "例如 16:9, 9:16",
          )}
        </>
      )}
      {row.purpose === "chat" && (
        <>
          <label>
            回复方式
            <select
              value={row.response ?? "stream"}
              onChange={(e) =>
                change({ response: e.target.value as EditorRow["response"] })
              }
            >
              <option value="stream">流式</option>
              <option value="json">整段返回</option>
            </select>
          </label>
          <label>
            工具调用
            <select
              value={row.tools === undefined ? "" : String(row.tools)}
              onChange={(e) =>
                change({
                  tools:
                    e.target.value === ""
                      ? undefined
                      : e.target.value === "true",
                })
              }
            >
              <option value="">沿用目录声明</option>
              <option value="true">支持</option>
              <option value="false">不支持</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}
