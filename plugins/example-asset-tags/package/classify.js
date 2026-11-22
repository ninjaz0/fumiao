export default {
  async handle(event, host) {
    const type = event.resource.mime.split("/")[0];
    const category = { image: "图片", video: "视频", audio: "音频" }[type] || "其他";
    await host.data.put("asset/" + event.resource.id, category);
    return true;
  },
};
