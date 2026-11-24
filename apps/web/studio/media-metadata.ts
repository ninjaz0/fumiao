import type { Asset } from "./state";

export const PREVIEW_LABELS: Record<NonNullable<Asset["kind"]>, string> = {
  ref: "图片预览",
  ref_video: "视频预览",
  ref_audio: "音频预览",
};

export function formatMediaSeconds(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return "";
  return `${Number(seconds.toFixed(1))}s`;
}

export function formatCardDuration(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
    return "";
  const rounded = Math.max(1, Math.round(seconds));
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

export function assetMetadataItems(
  asset: Pick<Asset, "kind" | "w" | "h" | "seconds" | "has_audio"> | undefined,
  fallbackKind?: Asset["kind"],
): string[] {
  if (!asset) return [];
  const kind = asset.kind ?? fallbackKind ?? "ref";
  if (kind === "ref_video") {
    const items: string[] = [];
    if (asset.w > 0 && asset.h > 0) items.push(`${asset.w} × ${asset.h}`);
    const length = formatMediaSeconds(asset.seconds);
    if (length) items.push(length);
    if (asset.has_audio !== undefined)
      items.push(asset.has_audio ? "含音轨" : "无音轨");
    return items;
  }
  if (kind === "ref_audio") {
    const length = formatMediaSeconds(asset.seconds);
    return length ? [length] : [];
  }
  return asset.w > 0 && asset.h > 0 ? [`${asset.w} × ${asset.h}`] : [];
}

export function deleteAssetPrompt(kind?: Asset["kind"]): {
  title: string;
  summary: string;
} {
  if (kind === "ref_video")
    return {
      title: "删除该视频？",
      summary: "正在被任务或作品引用的视频会保留。",
    };
  if (kind === "ref_audio")
    return {
      title: "删除该音频？",
      summary: "正在被任务或作品引用的音频会保留。",
    };
  return {
    title: "删除该图片？",
    summary: "正在被任务或作品引用的图片会保留。",
  };
}
