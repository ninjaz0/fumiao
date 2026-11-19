export default {
  request({ kind, model, input, remoteId }) {
    const path = kind === "video" ? "/v1/videos" : "/v1/images/tasks";
    if (remoteId) return { path: path + "/" + remoteId };
    return {
      path,
      body: {
        model,
        prompt: input.prompt.replace(/<Picture (\p{Nd}+)>/gu, "[图$1]"),
        aspect_ratio: input.params.ratio,
        images: input.references.map((r) => r.url),
        timeout: 600,
        ...(kind === "video"
          ? { duration: input.params.seconds }
          : { response_format: "url" }),
      },
    };
  },
};
