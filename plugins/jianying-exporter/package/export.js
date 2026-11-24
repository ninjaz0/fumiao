export default {
  export({ project, shots }) {
    const PLACEHOLDER =
      "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";
    // 1x1 black JPEG fallback cover (base64)
    const FALLBACK_COVER_B64 =
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
    const DIRECTORIES = [
      "qr_upload",
      "matting",
      "common_attachment",
      "Resources/audioAlg",
      "Resources/digitalHuman",
      "Resources/restore_lut",
      "Resources/videoAlg",
      "subdraft",
      "adjust_mask",
      "assets/audio",
      "assets/video",
      "smart_crop",
    ];
    const MATERIAL_KEYS = [
      "ai_translates",
      "audio_balances",
      "audio_effects",
      "audio_fades",
      "audio_track_indexes",
      "audios",
      "beats",
      "canvases",
      "chromas",
      "color_curves",
      "common_mask",
      "digital_human_model_dressing",
      "digital_humans",
      "drafts",
      "effects",
      "flowers",
      "green_screens",
      "handwrites",
      "hsl",
      "images",
      "log_color_wheels",
      "loudnesses",
      "manual_beautys",
      "manual_deformations",
      "material_animations",
      "material_colors",
      "multi_language_refs",
      "placeholder_infos",
      "placeholders",
      "plugin_effects",
      "primary_color_wheels",
      "realtime_denoises",
      "shapes",
      "smart_crops",
      "smart_relights",
      "sound_channel_mappings",
      "speeds",
      "stickers",
      "tail_leaders",
      "text_templates",
      "texts",
      "time_marks",
      "transitions",
      "video_effects",
      "video_trackings",
      "videos",
      "vocal_beautifys",
      "vocal_separations",
      "ai_avatar_materials",
      "audio_alg_materials",
      "digital_human_backgrounds",
      "matting_materials",
      "subtitle_fragments",
      "vector_graphics",
    ];
    const KEYFRAME_KEYS = [
      "adjusts",
      "audios",
      "effects",
      "filters",
      "handwrites",
      "stickers",
      "texts",
      "videos",
    ];

    let seq = 1;
    function hex32(tag) {
      const seed = `${project.id || "draft"}:${tag}:${seq++}`;
      let h1 = 0x811c9dc5;
      let h2 = 0x9e3779b1;
      let h3 = 0x85ebca6b;
      let h4 = 0xc2b2ae35;
      for (let i = 0; i < seed.length; i++) {
        const c = seed.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ (c + i), 0x27d4eb2d) >>> 0;
        h3 = Math.imul(h3 ^ (c * 31), 0x165667b1) >>> 0;
        h4 = Math.imul(h4 ^ (c + seq), 0x9e3779b9) >>> 0;
      }
      return (
        h1.toString(16).padStart(8, "0") +
        h2.toString(16).padStart(8, "0") +
        h3.toString(16).padStart(8, "0") +
        h4.toString(16).padStart(8, "0")
      );
    }
    function uuidUpper(tag) {
      const h = hex32(tag).toUpperCase();
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-A${h.slice(17, 20)}-${h.slice(20, 32)}`;
    }
    function safeStem(raw, fallback) {
      const cleaned = String(raw || "")
        .replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, "_")
        .replace(/^[._-]+|[._-]+$/g, "")
        .slice(0, 48);
      return cleaned || fallback;
    }

    const materials = {};
    for (const k of MATERIAL_KEYS) materials[k] = [];
    const keyframes = {};
    for (const k of KEYFRAME_KEYS) keyframes[k] = [];

    const mediaCopies = [];
    const copiedByAsset = {};
    const usedPaths = {};
    function registerAsset(assetId, folder, baseName, ext) {
      if (copiedByAsset[assetId]) return copiedByAsset[assetId];
      let candidate = `${folder}/${baseName}${ext}`;
      let suffix = 2;
      while (usedPaths[candidate.toLowerCase()]) {
        candidate = `${folder}/${baseName}_${suffix++}${ext}`;
      }
      usedPaths[candidate.toLowerCase()] = true;
      copiedByAsset[assetId] = candidate;
      mediaCopies.push({ assetId, archivePath: candidate });
      return candidate;
    }

    const videoSegments = [];
    const audioSegments = [];
    const textSegments = [];
    const srtLines = [];
    let srtIdx = 1;
    let cursorUs = 0;

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
      const vMs = Math.max(50, Math.floor(shot.videoDurationMs));
      const aMs = shot.voice ? Math.max(50, Math.floor(shot.voiceDurationMs)) : 0;
      const vUs = vMs * 1000;
      const aUs = aMs * 1000;
      const slotUs = Math.max(vUs, aUs);
      const stem = `shot_${String(i + 1).padStart(3, "0")}_${safeStem(shot.title, shot.node)}`;
      const vRel = registerAsset(shot.video, "assets/video", stem, shot.videoExt || ".mp4");
      const videoMatId = hex32("vmat");
      const speedId = hex32("vspd");
      const canvasId = hex32("vcanv");
      const soundMapId = hex32("vsmap");

      materials.videos.push({
        id: videoMatId,
        type: "video",
        material_name: vRel.split("/").pop(),
        path: `${PLACEHOLDER}/${vRel}`,
        duration: vUs,
        width: shot.videoWidth || project.width || 1920,
        height: shot.videoHeight || project.height || 1080,
        has_audio: !!shot.videoHasAudio,
        category_name: "local",
        check_flag: 63487,
        crop: {
          lower_left_x: 0.0,
          lower_left_y: 1.0,
          lower_right_x: 1.0,
          lower_right_y: 1.0,
          upper_left_x: 0.0,
          upper_left_y: 0.0,
          upper_right_x: 1.0,
          upper_right_y: 0.0,
        },
        crop_ratio: "free",
        crop_scale: 1.0,
        extra_type_option: 0,
        source_platform: 0,
      });
      materials.speeds.push({
        id: speedId,
        type: "speed",
        mode: 0,
        speed: 1.0,
        curve_speed: null,
      });
      materials.canvases.push({
        id: canvasId,
        type: "canvas_color",
        color: "",
        blur: 0.0,
        image: "",
        image_id: "",
        image_name: "",
        source_platform: 0,
        team_id: "",
      });
      materials.sound_channel_mappings.push({
        id: soundMapId,
        type: "",
        audio_channel_mapping: 0,
        is_config_open: false,
      });

      videoSegments.push({
        id: hex32("vseg"),
        material_id: videoMatId,
        extra_material_refs: [speedId, canvasId, soundMapId],
        source_timerange: { start: 0, duration: vUs },
        target_timerange: { start: cursorUs, duration: vUs },
        speed: 1.0,
        volume: shot.voice ? 0.0 : 1.0,
        visible: true,
        enable_adjust: true,
        enable_color_curves: true,
        enable_color_wheels: true,
        enable_lut: true,
        clip: {
          alpha: 1.0,
          flip: { horizontal: false, vertical: false },
          rotation: 0.0,
          scale: { x: 1.0, y: 1.0 },
          transform: { x: 0.0, y: 0.0 },
        },
        hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
        render_index: 0,
        track_attribute: 0,
        track_render_index: 0,
      });

      if (shot.voice && aUs > 0) {
        const aRel = registerAsset(
          shot.voice,
          "assets/audio",
          `${stem}_voice`,
          shot.voiceExt || ".wav",
        );
        const audioMatId = hex32("amat");
        const aSpeedId = hex32("aspd");
        const aFadeId = hex32("afade");
        const aLoudId = hex32("aloud");
        materials.audios.push({
          id: audioMatId,
          type: "extract_music",
          name: aRel.split("/").pop(),
          path: `${PLACEHOLDER}/${aRel}`,
          duration: aUs,
          category_name: "local",
          check_flag: 1,
          source_platform: 0,
        });
        materials.speeds.push({
          id: aSpeedId,
          type: "speed",
          mode: 0,
          speed: 1.0,
          curve_speed: null,
        });
        materials.audio_fades.push({
          id: aFadeId,
          type: "audio_fade",
          fade_in_duration: 0,
          fade_out_duration: 0,
          fade_type: 0,
        });
        materials.loudnesses.push({
          id: aLoudId,
          type: "loudness",
          enable: false,
          file_id: "",
          loudness_param: null,
          target_loudness: 0.0,
        });
        audioSegments.push({
          id: hex32("aseg"),
          material_id: audioMatId,
          extra_material_refs: [aSpeedId, aFadeId, aLoudId],
          source_timerange: { start: 0, duration: aUs },
          target_timerange: { start: cursorUs, duration: aUs },
          speed: 1.0,
          volume: 1.0,
          visible: true,
          render_index: 0,
          track_attribute: 0,
          track_render_index: 0,
        });
      }

      for (const cue of shot.subtitles || []) {
        const text = String(cue.text || "").trim();
        if (!text) continue;
        const relStartUs = Math.max(0, Math.floor(cue.startMs) * 1000);
        const relDurUs = Math.max(
          100000,
          Math.floor(cue.endMs - cue.startMs) * 1000,
        );
        const textMatId = hex32("tmat");
        materials.texts.push({
          id: textMatId,
          type: "subtitle",
          content: JSON.stringify({
            text,
            styles: [
              {
                fill: {
                  alpha: 1.0,
                  content: {
                    render_type: "solid",
                    solid: { alpha: 1.0, color: [1.0, 1.0, 1.0] },
                  },
                },
                range: [0, text.length],
                size: 8.0,
                bold: false,
                italic: false,
                underline: false,
              },
            ],
          }),
          font_size: 8.0,
          alignment: 1,
          letter_spacing: 0.0,
          line_spacing: 0.02,
        });
        textSegments.push({
          id: hex32("tseg"),
          material_id: textMatId,
          extra_material_refs: [],
          target_timerange: { start: relStartUs, duration: relDurUs },
          visible: true,
          clip: {
            alpha: 1.0,
            flip: { horizontal: false, vertical: false },
            rotation: 0.0,
            scale: { x: 1.0, y: 1.0 },
            transform: { x: 0.0, y: -0.78 },
          },
          render_index: 14000,
          track_attribute: 0,
          track_render_index: 0,
        });
        srtLines.push(
          `${srtIdx++}\n${fmtSrt(cue.startMs)} --> ${fmtSrt(cue.endMs)}\n${text}\n`,
        );
      }

      cursorUs += slotUs;
    }

    const tracks = [
      {
        id: hex32("vtrk"),
        type: "video",
        attribute: 0,
        flag: 0,
        is_default_name: true,
        name: "",
        segments: videoSegments,
      },
    ];
    if (audioSegments.length) {
      tracks.push({
        id: hex32("atrk"),
        type: "audio",
        attribute: 0,
        flag: 0,
        is_default_name: true,
        name: "",
        segments: audioSegments,
      });
    }
    if (textSegments.length) {
      tracks.push({
        id: hex32("ttrk"),
        type: "text",
        attribute: 0,
        flag: 0,
        is_default_name: true,
        name: "",
        segments: textSegments,
      });
    }

    const rootId = uuidUpper("root");
    const draftName = safeStem(project.title, "弗淼剪映草稿");
    const draftContent = {
      id: rootId,
      name: draftName,
      version: 360000,
      new_version: "169.0.0",
      fps: 30.0,
      duration: cursorUs,
      create_time: 0,
      update_time: 0,
      canvas_config: {
        width: project.width || 1920,
        height: project.height || 1080,
        ratio: "original",
      },
      color_space: 0,
      config: {
        adjust_max_index: 1,
        attachment_info: [],
        combination_max_index: 1,
        export_range: null,
        extract_audio_last_index: 1,
        lyrics_recognition_id: "",
        lyrics_sync: true,
        lyrics_taskinfo: [],
        maintrack_adsorb: true,
        material_save_mode: 0,
        multi_language_current: "none",
        multi_language_list: [],
        multi_language_main: "none",
        multi_language_mode: "none",
        original_sound_last_index: 1,
        record_audio_last_index: 1,
        sticker_max_index: 1,
        subtitle_keywords_config: null,
        subtitle_recognition_id: "",
        subtitle_sync: true,
        subtitle_taskinfo: [],
        system_font_list: [],
        video_mute: false,
        zoom_info_params: null,
      },
      cover: null,
      draft_type: "video",
      extra_info: null,
      keyframes,
      last_modified_platform: {
        app_id: 3704,
        app_source: "lv",
        app_version: "10.6.0",
        device_id: "",
        hard_disk_id: "",
        mac_address: "",
        os: "mac",
        os_version: "",
      },
      materials,
      mutable_config: null,
      platform: {
        app_id: 3704,
        app_source: "lv",
        app_version: "10.6.0",
        device_id: "",
        hard_disk_id: "",
        mac_address: "",
        os: "mac",
        os_version: "",
      },
      relationships: [],
      render_index_track_mode_on: false,
      retouch_cover: null,
      source: "default",
      static_cover_image_path: "",
      tracks,
    };

    const draftMeta = {
      cloud_package_completed_time: "",
      draft_cloud_capcut_purchase_info: "",
      draft_cloud_last_action_download: false,
      draft_cloud_materials: [],
      draft_cloud_purchase_info: "",
      draft_cloud_template_id: "",
      draft_cloud_tutorial_info: "",
      draft_cloud_videocut_purchase_info: "",
      draft_cover: "draft_cover.jpg",
      draft_deeplink_url: "",
      draft_enterprise_info: {
        draft_enterprise_extra: "",
        draft_enterprise_id: "",
        draft_enterprise_name: "",
        enterprise_material: [],
      },
      draft_fold_path: "",
      draft_id: rootId,
      draft_is_ai_packaging_used: false,
      draft_is_ai_shorts: false,
      draft_is_ai_translate: false,
      draft_is_article_video_draft: false,
      draft_is_from_deeplink: "false",
      draft_is_invisible: false,
      draft_materials: [],
      draft_materials_copied_info: [],
      draft_name: draftName,
      draft_new_version: "",
      draft_removable_storage_device: "",
      draft_root_path: "",
      draft_segment_extra_info: [],
      draft_timeline_materials_size_: 0,
      draft_type: "",
      tm_draft_cloud_completed: "",
      tm_draft_cloud_modified: 0,
      tm_draft_create: 0,
      tm_draft_modified: 0,
      tm_draft_removed: 0,
      tm_duration: cursorUs,
    };

    return {
      filename: `${draftName}-剪映草稿.zip`,
      format: "zip",
      directories: DIRECTORIES,
      files: [
        {
          path: "draft_content.json",
          content: JSON.stringify(draftContent),
          encoding: "utf8",
        },
        {
          path: "draft_meta_info.json",
          content: JSON.stringify(draftMeta),
          encoding: "utf8",
        },
        {
          path: "draft_cover.jpg",
          content: FALLBACK_COVER_B64,
          encoding: "base64",
        },
      ],
      mediaCopies,
      subtitles: srtLines.join("\n"),
    };
  },
};
