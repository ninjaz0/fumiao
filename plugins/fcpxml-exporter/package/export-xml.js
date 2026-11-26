export default {
  export({ project, shots }) {
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

    const assetsById = {};
    const assetOrder = [];
    let nextRes = 2;
    function ensureAsset(assetId, kind, name, durationFrames, hasAudio) {
      let rec = assetsById[assetId];
      if (rec) {
        if (kind === "video") rec.hasVideo = true;
        if (hasAudio) rec.hasAudio = true;
        if (durationFrames > rec.durationFrames) rec.durationFrames = durationFrames;
        return rec;
      }
      rec = {
        resId: `r${nextRes++}`,
        uid: `id-${assetId}`,
        name,
        src: `file://./media/${encodeURI(name)}`,
        durationFrames,
        hasVideo: kind === "video",
        hasAudio: !!hasAudio,
      };
      assetsById[assetId] = rec;
      assetOrder.push(rec);
      return rec;
    }

    const spineClips = [];
    let offsetFrames = 0;
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const vFrames = msToFrames(shot.videoDurationMs);
      const aFrames = shot.voice ? msToFrames(shot.voiceDurationMs) : 0;
      const stem = `shot_${String(i + 1).padStart(3, "0")}_${safeStem(shot.title, shot.node)}`;
      const vAsset = ensureAsset(
        shot.video,
        "video",
        `${stem}${shot.videoExt || ".mp4"}`,
        vFrames,
        shot.videoHasAudio,
      );
      const children = [];
      if (shot.voice && aFrames > 0) {
        const aAsset = ensureAsset(
          shot.voice,
          "audio",
          `${stem}_voice${shot.voiceExt || ".wav"}`,
          aFrames,
          true,
        );
        children.push(
          `            <asset-clip name="${escAttr(aAsset.name)}" ref="${aAsset.resId}" lane="-1" offset="0s" duration="${rational(aFrames)}" start="0s" role="dialogue"/>`,
        );
      }
      const clipAttrs = `name="${escAttr(shot.title || stem)}" ref="${vAsset.resId}" offset="${rational(offsetFrames)}" duration="${rational(vFrames)}" start="0s"`;
      spineClips.push(
        children.length
          ? `          <asset-clip ${clipAttrs}>\n${children.join("\n")}\n          </asset-clip>`
          : `          <asset-clip ${clipAttrs}/>`,
      );
      offsetFrames += Math.max(vFrames, aFrames);
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
      filename: `${projTitle}.fcpxml`,
      format: "text",
      files: [{ path: `${projTitle}.fcpxml`, content: xml, encoding: "utf8" }],
    };
  },
};
