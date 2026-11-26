export default {
  export({ project, shots, bgm }) {
    function stripXml10(str) {
      let out = "";
      const s = String(str ?? "");
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c !== 0x7f))
          out += s[i];
      }
      return out;
    }
    function escAttr(str) {
      return stripXml10(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }
    function safeStem(raw, fallback) {
      const cleaned = String(raw || "")
        .replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, "_")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 48);
      return cleaned || fallback;
    }

    const fpsInt = Math.max(1, Math.round(project.fps || 30));
    const frameScale = fpsInt * 100;
    const frameDur = `100/${frameScale}s`;
    function msToFrames(ms) {
      return Math.max(1, Math.round((Math.max(0, ms) * fpsInt) / 1000));
    }
    function rational(frames) {
      if (frames <= 0) return "0s";
      return `${frames * 100}/${frameScale}s`;
    }

    const mediaCopies = [];
    const assetsById = {};
    const assetOrder = [];
    const usedPaths = {};
    let nextRes = 2;

    function ensureAsset(assetId, kind, baseName, ext, durationFrames, hasAudio) {
      let rec = assetsById[assetId];
      if (rec) {
        // Promote audio-only record to video when same source is also used as video.
        if (kind === "video") rec.hasVideo = true;
        if (hasAudio) rec.hasAudio = true;
        if (durationFrames > rec.durationFrames) rec.durationFrames = durationFrames;
        return rec;
      }
      let archivePath = `media/${baseName}${ext}`;
      let suffix = 2;
      while (usedPaths[archivePath.toLowerCase()]) {
        archivePath = `media/${baseName}_${suffix++}${ext}`;
      }
      usedPaths[archivePath.toLowerCase()] = true;
      mediaCopies.push({ assetId, archivePath });
      rec = {
        resId: `r${nextRes++}`,
        uid: `id-${assetId}`,
        name: archivePath.split("/").pop(),
        src: `file://./${encodeURI(archivePath)}`,
        durationFrames,
        hasVideo: kind === "video",
        hasAudio: !!hasAudio,
      };
      assetsById[assetId] = rec;
      assetOrder.push(rec);
      return rec;
    }

    const spineClips = [];
    const srtLines = [];
    let srtIdx = 1;
    let offsetFrames = 0;

    function fmtSrt(ms) {
      const total = Math.max(0, Math.floor(ms));
      const h = Math.floor(total / 3600000);
      const m = Math.floor((total % 3600000) / 60000);
      const s = Math.floor((total % 60000) / 1000);
      const rem = total % 1000;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
    }

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const vFrames = msToFrames(shot.videoDurationMs);
      const aFrames = shot.voice ? msToFrames(shot.voiceDurationMs) : 0;
      const stem = `shot_${String(i + 1).padStart(3, "0")}_${safeStem(shot.title, shot.node)}`;
      const vAsset = ensureAsset(
        shot.video,
        "video",
        stem,
        shot.videoExt || ".mp4",
        vFrames,
        shot.videoHasAudio,
      );
      const children = [];
      let shotAudioFrames = aFrames;
      if (shot.audioStrategy !== "keep_original") {
        if (shot.dialogue && shot.dialogue.length > 0) {
          let dlgOffsetFrames = 0;
          const gapFrames = Math.max(1, Math.round(fpsInt * 0.15));
          for (let d = 0; d < shot.dialogue.length; d++) {
            const seg = shot.dialogue[d];
            const segFrames = msToFrames(seg.durationMs || 0);
            const aAsset = ensureAsset(
              seg.voice,
              "audio",
              `${stem}_dlg_${String(d + 1).padStart(2, "0")}`,
              seg.ext || ".wav",
              segFrames,
              true,
            );
            children.push(
              `            <asset-clip name="${escAttr(seg.speaker ? seg.speaker + "_" + aAsset.name : aAsset.name)}" ref="${aAsset.resId}" lane="-1" offset="${rational(dlgOffsetFrames)}" duration="${rational(segFrames)}" start="0s" role="dialogue"/>`,
            );
            dlgOffsetFrames += segFrames + (d < shot.dialogue.length - 1 ? gapFrames : 0);
          }
          shotAudioFrames = dlgOffsetFrames;
        } else if (shot.voice && aFrames > 0) {
          const aAsset = ensureAsset(
            shot.voice,
            "audio",
            `${stem}_voice`,
            shot.voiceExt || ".wav",
            aFrames,
            true,
          );
          children.push(
            `            <asset-clip name="${escAttr(aAsset.name)}" ref="${aAsset.resId}" lane="-1" offset="0s" duration="${rational(aFrames)}" start="0s" role="dialogue"/>`,
          );
        }
      }
      if (i === 0 && bgm && bgm.asset) {
        const totalEstMs = shots.reduce(
          (acc, s) => acc + Math.max(s.videoDurationMs || 0, s.voiceDurationMs || 0),
          0,
        );
        const bgmFrames = msToFrames(
          Math.min(bgm.durationMs || totalEstMs, totalEstMs || bgm.durationMs || 1000),
        );
        const bgmAsset = ensureAsset(
          bgm.asset,
          "audio",
          "bgm_track",
          bgm.ext || ".mp3",
          bgmFrames,
          true,
        );
        children.push(
          `            <asset-clip name="${escAttr(bgmAsset.name)}" ref="${bgmAsset.resId}" lane="-2" offset="0s" duration="${rational(bgmFrames)}" start="0s" role="music"/>`,
        );
      }
      for (const cue of shot.subtitles || []) {
        const text = String(cue.text || "").trim();
        if (!text) continue;
        const cueDurFrames = msToFrames(Math.max(100, cue.endMs - cue.startMs));
        children.push(
          `            <title name="${escAttr(text.slice(0, 32))}" lane="1" offset="0s" duration="${rational(cueDurFrames)}" start="0s"><text>${escAttr(text)}</text></title>`,
        );
        srtLines.push(
          `${srtIdx++}\n${fmtSrt(cue.startMs)} --> ${fmtSrt(cue.endMs)}\n${text}\n`,
        );
      }
      const clipAttrs = `name="${escAttr(shot.title || stem)}" ref="${vAsset.resId}" offset="${rational(offsetFrames)}" duration="${rational(vFrames)}" start="0s"`;
      if (children.length) {
        spineClips.push(
          `          <asset-clip ${clipAttrs}>\n${children.join("\n")}\n          </asset-clip>`,
        );
      } else {
        spineClips.push(`          <asset-clip ${clipAttrs}/>`);
      }
      offsetFrames += Math.max(vFrames, shotAudioFrames);
    }

    const projTitle = safeStem(project.title, "fumiao-project");
    const width = project.width || 1920;
    const height = project.height || 1080;
    const resourcesXml = [
      `    <format id="r1" name="FFVideoFormat${height}p${fpsInt}" frameDuration="${frameDur}" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>`,
      ...assetOrder.map(
        (a) =>
          `    <asset id="${a.resId}" name="${escAttr(a.name)}" uid="${escAttr(a.uid)}" start="0s" duration="${rational(a.durationFrames)}" hasVideo="${a.hasVideo ? "1" : "0"}" hasAudio="${a.hasAudio ? "1" : "0"}"${a.hasVideo ? ' format="r1"' : ""}>\n      <media-rep kind="original-media" src="${escAttr(a.src)}"/>\n    </asset>`,
      ),
    ].join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">
  <resources>
${resourcesXml}
  </resources>
  <library>
    <event name="${escAttr(project.title || projTitle)}">
      <project name="${escAttr(project.title || projTitle)}">
        <sequence format="r1" duration="${rational(offsetFrames)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineClips.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;

    return {
      filename: `${projTitle}-fcpxml.zip`,
      format: "zip",
      directories: ["media"],
      files: [{ path: `${projTitle}.fcpxml`, content: xml, encoding: "utf8" }],
      mediaCopies,
      subtitles: srtLines.join("\n"),
    };
  },
};
