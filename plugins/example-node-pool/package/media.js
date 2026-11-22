export default {
  view() {
    const source = {
      name: "asset",
      type: "text",
      label: "素材 ID",
      required: true,
      maxLength: 32,
    };
    const format = {
      name: "format",
      type: "select",
      label: "输出格式",
      value: "mp4",
      options: [
        { value: "mp4", label: "MP4 视频" },
        { value: "wav", label: "WAV 音频" },
      ],
    };
    const form = (id, title, fields) => ({
      type: "form",
      id,
      title,
      fields,
      submit: { action: id, label: title },
    });
    return {
      schema: 1,
      title: "素材处理示例",
      description:
        "使用当前工作区素材地址末尾的 32 位 ID。生成的素材保存在同一工作区。",
      blocks: [
        form("probe", "读取媒体信息", [source]),
        form("transcode", "转码", [source, format]),
        form("concat", "拼接", [
          {
            name: "assets",
            type: "textarea",
            label: "素材 ID，按拼接顺序每行一个",
            required: true,
          },
          format,
        ]),
        form("frame", "提取视频帧", [
          source,
          {
            name: "seconds",
            type: "number",
            label: "时间（秒）",
            value: 0,
            min: 0,
            max: 120,
          },
        ]),
      ],
    };
  },
  async action(id, payload, _input, host) {
    if (id === "probe") {
      const m = await host.media.probe(payload.asset);
      return {
        notice: [
          m.mime,
          m.width && m.width + " × " + m.height,
          m.seconds + " 秒",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
    const m =
      id === "transcode"
        ? await host.media.transcode(payload.asset, { format: payload.format })
        : id === "concat"
          ? await host.media.concat(payload.assets.trim().split(/\s+/), {
              format: payload.format,
            })
          : await host.media.extractFrame(payload.asset, {
              seconds: Number(payload.seconds),
            });
    return { notice: "已生成素材 " + m.id };
  },
};
