export default {
  async run(asset, values, host) {
    const label = await host.data.get("asset/" + asset.id);
    return { notice: label ? "素材分类：" + label : "暂无分类记录" };
  },
};
