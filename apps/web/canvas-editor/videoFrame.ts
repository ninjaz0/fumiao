export async function captureFrame(video: HTMLVideoElement): Promise<File> {
  if (video.readyState < 2 || video.seeking || !video.videoWidth || !video.videoHeight)
    throw new Error("请等画面加载完毕再取帧");
  video.pause();
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法提取视频画面");
  context.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
  if (!blob) throw new Error("无法提取当前画面，请重试");
  return new File([blob], "视频取帧.jpg", { type: "image/jpeg" });
}
