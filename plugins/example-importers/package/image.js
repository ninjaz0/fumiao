export default {
  plan({ source }) {
    return {
      target: "assets",
      assets: [{ key: "cover", kind: "image", url: source }],
    };
  },
};
