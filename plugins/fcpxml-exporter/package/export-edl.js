export default {
  export({ project, shots }) {
    const fps = Math.max(1, Math.round(project.fps || 30));

    function safeStem(raw, fallback) {
      const cleaned = String(raw || "")
        .replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, "_")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 48);
      return cleaned || fallback;
    }

    function safeReel(idx) {
      return `SH${String(idx + 1).padStart(4, "0")}`;
    }

    function msToFrames(ms) {
      return Math.max(1, Math.round((Math.max(0, ms) * fps) / 1000));
    }

    function framesToSmpte(totalFrames) {
      const f = Math.max(0, Math.round(totalFrames));
      const frames = f % fps;
      const totalSec = Math.floor(f / fps);
      const secs = totalSec % 60;
      const totalMin = Math.floor(totalSec / 60);
      const mins = totalMin % 60;
      const hours = Math.floor(totalMin / 60) % 24;
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
    }

    const projTitle = safeStem(project.title, "fumiao-project");
    const lines = [
      `TITLE: ${String(project.title || projTitle).replace(/[\r\n]+/g, " ").slice(0, 72)}`,
      "FCM: NON-DROP FRAME",
      "",
    ];

    // Start master record timeline at standard broadcast 01:00:00:00
    const baseRecFrame = 3600 * fps;
    let recCursor = baseRecFrame;
    let eventNo = 1;

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const vFrames = msToFrames(shot.videoDurationMs);
      const aFrames = shot.voice ? msToFrames(shot.voiceDurationMs) : 0;
      const slotFrames = Math.max(vFrames, aFrames);
      const stem = `shot_${String(i + 1).padStart(3, "0")}_${safeStem(shot.title, shot.node)}`;
      const videoFilename = `${stem}${shot.videoExt || ".mp4"}`;
      const reel = safeReel(i).padEnd(8, " ");
      const track = shot.videoHasAudio && !shot.voice ? "AA/V" : "V   ";
      const srcIn = framesToSmpte(0);
      const srcOut = framesToSmpte(vFrames);
      const recIn = framesToSmpte(recCursor);
      const recOut = framesToSmpte(recCursor + vFrames);

      lines.push(
        `${String(eventNo++).padStart(3, "0")}  ${reel} ${track}  C        ${srcIn} ${srcOut} ${recIn} ${recOut}`,
      );
      lines.push(`* FROM CLIP NAME: ${videoFilename}`);
      lines.push(`* COMMENT: SHOT=${shot.title || stem} MEDIA=./media/${videoFilename}`);
      lines.push("");

      if (shot.voice && aFrames > 0) {
        const voiceFilename = `${stem}_voice${shot.voiceExt || ".wav"}`;
        const aReel = `AU${String(i + 1).padStart(4, "0")}`.padEnd(8, " ");
        const aSrcOut = framesToSmpte(aFrames);
        const aRecOut = framesToSmpte(recCursor + aFrames);
        lines.push(
          `${String(eventNo++).padStart(3, "0")}  ${aReel} A     C        ${srcIn} ${aSrcOut} ${recIn} ${aRecOut}`,
        );
        lines.push(`* FROM CLIP NAME: ${voiceFilename}`);
        lines.push(`* COMMENT: VOICE_TRACK MEDIA=./media/${voiceFilename}`);
        lines.push("");
      }

      recCursor += slotFrames;
    }

    const edl = lines.join("\r\n");
    return {
      filename: `${projTitle}.edl`,
      format: "text",
      files: [{ path: `${projTitle}.edl`, content: edl, encoding: "utf8" }],
    };
  },
};
