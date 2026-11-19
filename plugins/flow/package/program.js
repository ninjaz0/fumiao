export default {
  request({ input, descriptor }) {
    const content = [
      { type: "text", text: input.prompt },
      ...input.references.map((r) => ({
        type: "image_url",
        image_url: { url: r.url },
      })),
    ];
    if (input.params.source_media_id)
      content.push({
        type: "image_url",
        image_url: { url: "extend://" + input.params.source_media_id },
      });
    return {
      path: "/v1/chat/completions",
      body: {
        model: descriptor.upstream,
        messages: [{ role: "user", content }],
        stream: true,
      },
    };
  },
};
